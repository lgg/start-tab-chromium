import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = path.resolve(process.cwd());
const temporary = await mkdtemp(path.join(tmpdir(), "start-tab-round25-"));

const storage: Record<string, unknown> = {
  blockedSites: ["example.com"],
  startTabDataRevision: { version: 1, updatedAt: 100 },
};
let dynamicRules: chrome.declarativeNetRequest.Rule[] = [];
let dynamicRuleUpdates = 0;
let storageSetCalls = 0;
let storageRemoveCalls = 0;

function expectedRule(host = "example.com"): chrome.declarativeNetRequest.Rule {
  return {
    id: 1,
    priority: 1,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
      redirect: { url: `chrome-extension://round25/blocked.html?site=${encodeURIComponent(host)}` },
    },
    condition: {
      requestDomains: [host],
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
    },
  };
}

function selected(keys: string | string[] | null | undefined): Record<string, unknown> {
  if (keys === null || keys === undefined) return structuredClone(storage);
  const names = Array.isArray(keys) ? keys : [keys];
  return Object.fromEntries(names
    .filter((key) => Object.prototype.hasOwnProperty.call(storage, key))
    .map((key) => [key, structuredClone(storage[key])]));
}

const chromeMock = {
  runtime: {
    getURL: (relativePath: string) => `chrome-extension://round25/${relativePath}`,
    sendMessage: async () => ({ ok: true }),
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => selected(keys),
      set: async (items: Record<string, unknown>) => {
        storageSetCalls += 1;
        for (const [key, value] of Object.entries(items)) storage[key] = structuredClone(value);
      },
      remove: async (keys: string | string[]) => {
        storageRemoveCalls += 1;
        for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
      },
    },
  },
  declarativeNetRequest: {
    RuleActionType: { REDIRECT: "redirect" },
    ResourceType: { MAIN_FRAME: "main_frame" },
    getDynamicRules: async () => structuredClone(dynamicRules),
    updateDynamicRules: async ({ addRules = [] }: { removeRuleIds?: number[]; addRules?: chrome.declarativeNetRequest.Rule[] }) => {
      dynamicRuleUpdates += 1;
      dynamicRules = structuredClone(addRules);
    },
  },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const {
  blockHost,
  clearLastBlockedUrl,
  rememberBlockedNavigation,
} = await import("../src/lib/blocklist.js");

function resetCounters(): void {
  dynamicRuleUpdates = 0;
  storageSetCalls = 0;
  storageRemoveCalls = 0;
}

async function absent(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return false;
  } catch (error) {
    return Boolean(error) && typeof error === "object" && "code" in error && error.code === "ENOENT";
  }
}

try {
  dynamicRules = [expectedRule()];
  resetCounters();
  const revisionBeforeCanonicalNoOp = structuredClone(storage.startTabDataRevision);
  await blockHost("example.com");
  assert.equal(storageSetCalls, 0, "A canonical block no-op must not rewrite storage");
  assert.equal(storageRemoveCalls, 0, "A canonical block no-op must not remove storage keys");
  assert.equal(dynamicRuleUpdates, 0, "A canonical block no-op with correct DNR must not rewrite rules");
  assert.deepEqual(storage.startTabDataRevision, revisionBeforeCanonicalNoOp,
    "A canonical block no-op must not advance the shared data revision");

  dynamicRules = [];
  resetCounters();
  const revisionBeforeDnrRepair = structuredClone(storage.startTabDataRevision);
  await blockHost("example.com");
  assert.equal(storageSetCalls, 0, "DNR-only repair must not rewrite canonical storage");
  assert.equal(storageRemoveCalls, 0, "DNR-only repair must not remove canonical storage keys");
  assert.equal(dynamicRuleUpdates, 1, "A missing DNR rule must be restored by a repeated block operation");
  assert.deepEqual(dynamicRules, [expectedRule()]);
  assert.deepEqual(storage.startTabDataRevision, revisionBeforeDnrRepair,
    "Repairing derived DNR state must not create a false data revision");

  storage.lastBlockedUrls = {
    "WWW.EXAMPLE.COM": "https://example.com/private",
    "not a host": "not a URL",
  };
  storage.startTabDataRevision = { version: 1, updatedAt: 200 };
  resetCounters();
  await rememberBlockedNavigation("https://example.com/private");
  assert.deepEqual(storage.lastBlockedUrls, { "example.com": "https://example.com/private" },
    "An identical normalized URL must still repair noncanonical raw storage");
  assert.ok((storage.startTabDataRevision as { updatedAt: number }).updatedAt > 200);

  const revisionAfterCanonicalRepair = structuredClone(storage.startTabDataRevision);
  resetCounters();
  await rememberBlockedNavigation("https://example.com/private");
  assert.equal(storageSetCalls, 0, "A truly canonical identical URL must remain a no-op");
  assert.equal(storageRemoveCalls, 0);
  assert.deepEqual(storage.startTabDataRevision, revisionAfterCanonicalRepair);

  resetCounters();
  await clearLastBlockedUrl("example.com");
  assert.equal(Object.prototype.hasOwnProperty.call(storage, "lastBlockedUrls"), false,
    "Removing the final remembered URL must delete the storage key instead of persisting an empty object");
  assert.ok(storageRemoveCalls >= 1);

  storage.lastBlockedUrls = {};
  const revisionBeforeEmptyRepair = (storage.startTabDataRevision as { updatedAt: number }).updatedAt;
  resetCounters();
  await clearLastBlockedUrl("missing.example");
  assert.equal(Object.prototype.hasOwnProperty.call(storage, "lastBlockedUrls"), false,
    "A stale empty metadata object must be canonicalized to an absent key");
  assert.ok((storage.startTabDataRevision as { updatedAt: number }).updatedAt > revisionBeforeEmptyRepair);

  const fakeWorkspace = path.join(temporary, "workspace");
  const fakeRunnerTemp = path.join(temporary, "runner-temp");
  const cacheRoot = path.join(fakeRunnerTemp, "start-tab-chromium-cache");
  const protectedDirectory = path.join(temporary, "protected");
  await Promise.all([
    mkdir(path.join(fakeWorkspace, "node_modules"), { recursive: true }),
    mkdir(path.join(fakeWorkspace, "build"), { recursive: true }),
    mkdir(cacheRoot, { recursive: true }),
    mkdir(protectedDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(fakeWorkspace, "node_modules", "stale.txt"), "remove", "utf8"),
    writeFile(path.join(fakeWorkspace, "build", "stale.txt"), "remove", "utf8"),
    writeFile(path.join(fakeWorkspace, "keep.txt"), "keep", "utf8"),
    writeFile(path.join(fakeWorkspace, "locale-parity-report.json"), "{}", "utf8"),
    writeFile(path.join(cacheRoot, "cache.txt"), "remove", "utf8"),
    writeFile(path.join(protectedDirectory, "sentinel.txt"), "external data must survive", "utf8"),
  ]);
  const cleanupLink = path.join(fakeWorkspace, "build-round24-link");
  await symlink(protectedDirectory, cleanupLink, process.platform === "win32" ? "junction" : "dir");

  await execute(process.execPath, [path.join(root, "scripts", "clean-ci.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      GITHUB_WORKSPACE: fakeWorkspace,
      RUNNER_TEMP: fakeRunnerTemp,
      CI_CACHE_ROOT: cacheRoot,
    },
    maxBuffer: 20 * 1024 * 1024,
  });

  assert.equal(await absent(path.join(fakeWorkspace, "node_modules")), true);
  assert.equal(await absent(path.join(fakeWorkspace, "build")), true);
  assert.equal(await absent(path.join(fakeWorkspace, "locale-parity-report.json")), true);
  assert.equal(await absent(cacheRoot), true);
  assert.equal(await absent(cleanupLink), true, "CI cleanup must remove the final junction itself");
  assert.equal(await readFile(path.join(protectedDirectory, "sentinel.txt"), "utf8"), "external data must survive",
    "CI cleanup must never recurse through a junction into external data");
  assert.equal(await readFile(path.join(fakeWorkspace, "keep.txt"), "utf8"), "keep",
    "CI cleanup must preserve unrelated workspace files");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log("Round 25 fixtures passed");
