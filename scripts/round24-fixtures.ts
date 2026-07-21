import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { isValidGoogleOAuthClientId, requireGoogleOAuthClientId } from "./google-oauth-client.mjs";

const execute = promisify(execFile);
const root = path.resolve(process.cwd());
const temporary = await mkdtemp(path.join(tmpdir(), "start-tab-round24-"));
const linkedOutput = path.join(root, "build-round24-link");

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
    priority: host.split(".").length,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
      redirect: { url: `chrome-extension://round24/blocked.html?site=${encodeURIComponent(host)}` },
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
    getURL: (relativePath: string) => `chrome-extension://round24/${relativePath}`,
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
  clearAll,
  rememberBlockedNavigation,
  replaceBlockedSites,
} = await import("../src/lib/blocklist.js");

function resetCounters(): void {
  dynamicRuleUpdates = 0;
  storageSetCalls = 0;
  storageRemoveCalls = 0;
}

try {
  dynamicRules = [expectedRule()];
  const revisionBeforeNoOps = structuredClone(storage.startTabDataRevision);
  await blockHost("example.com");
  await replaceBlockedSites(["example.com"]);
  assert.equal(storageSetCalls, 0, "Canonical duplicate block operations must not rewrite storage");
  assert.equal(storageRemoveCalls, 0, "Canonical duplicate block operations must not remove storage keys");
  assert.equal(dynamicRuleUpdates, 0, "Canonical duplicate block operations must not rewrite DNR rules");
  assert.deepEqual(storage.startTabDataRevision, revisionBeforeNoOps,
    "Canonical duplicate block operations must not advance the sync revision");

  storage.blockedSites = [];
  delete storage.lastBlockedUrls;
  dynamicRules = [];
  resetCounters();
  const revisionBeforeClear = structuredClone(storage.startTabDataRevision);
  await clearAll();
  assert.equal(storageSetCalls, 0, "Clearing an already-empty canonical blocklist must not rewrite storage");
  assert.equal(storageRemoveCalls, 0, "Clearing an already-empty canonical blocklist must not remove absent keys");
  assert.equal(dynamicRuleUpdates, 0, "Clearing an already-empty canonical blocklist must not rewrite DNR rules");
  assert.deepEqual(storage.startTabDataRevision, revisionBeforeClear,
    "Clearing an already-empty canonical blocklist must not advance the sync revision");

  storage.blockedSites = ["example.com"];
  delete storage.lastBlockedUrls;
  storage.startTabDataRevision = { version: 1, updatedAt: 200 };
  resetCounters();
  const blockedUrl = "https://example.com/private";
  await rememberBlockedNavigation(blockedUrl);
  assert.equal(storage.lastBlockedUrls && (storage.lastBlockedUrls as Record<string, string>)["example.com"], blockedUrl);
  assert.ok((storage.startTabDataRevision as { updatedAt: number }).updatedAt > 200);
  const revisionAfterFirstRemember = structuredClone(storage.startTabDataRevision);
  resetCounters();
  await rememberBlockedNavigation(blockedUrl);
  assert.equal(storageSetCalls, 0, "Remembering the identical blocked URL twice must not rewrite storage");
  assert.equal(storageRemoveCalls, 0, "Remembering the identical blocked URL twice must not remove keys");
  assert.equal(dynamicRuleUpdates, 0, "Remembering a URL must not touch DNR rules");
  assert.deepEqual(storage.startTabDataRevision, revisionAfterFirstRemember,
    "Remembering the identical blocked URL twice must not advance the sync revision");

  for (const invalid of [
    "1234567890-example.apps.googleusercontent.com",
    "YOUR_CLIENT_ID.apps.googleusercontent.com",
    "changeme.apps.googleusercontent.com",
    "placeholder.apps.googleusercontent.com",
  ]) {
    assert.equal(isValidGoogleOAuthClientId(invalid), false, `Common placeholder must be rejected: ${invalid}`);
    assert.throws(() => requireGoogleOAuthClientId(invalid), /non-placeholder Chrome OAuth client/);
  }
  assert.equal(isValidGoogleOAuthClientId("1234567890-ci-validation.apps.googleusercontent.com"), true);

  const placeholderOutput = path.join(temporary, "placeholder-output");
  await mkdir(placeholderOutput, { recursive: true });
  const placeholderSentinel = path.join(placeholderOutput, "keep.txt");
  await writeFile(placeholderSentinel, "preserve output before placeholder rejection", "utf8");
  await assert.rejects(
    () => execute(process.execPath, [path.join(root, "build.mjs"), "--google", `--outdir=${placeholderOutput}`], {
      cwd: root,
      env: { ...process.env, GOOGLE_OAUTH_CLIENT_ID: "1234567890-example.apps.googleusercontent.com" },
      maxBuffer: 20 * 1024 * 1024,
    }),
    (error) => String((error as { stderr?: unknown }).stderr ?? error).includes("non-placeholder Chrome OAuth client"),
    "The copyable historical example OAuth ID must fail before cleanup",
  );
  await access(placeholderSentinel);
  assert.equal(await readFile(placeholderSentinel, "utf8"), "preserve output before placeholder rejection");

  const protectedDirectory = path.join(temporary, "protected");
  const protectedNested = path.join(protectedDirectory, "nested");
  await mkdir(protectedNested, { recursive: true });
  const linkSentinel = path.join(protectedNested, "keep.txt");
  await writeFile(linkSentinel, "recursive cleanup must not cross this link", "utf8");
  await rm(linkedOutput, { recursive: true, force: true });
  await symlink(protectedDirectory, linkedOutput, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    () => execute(process.execPath, [path.join(root, "build.mjs"), "--outdir=build-round24-link/nested"], {
      cwd: root,
      env: { ...process.env },
      maxBuffer: 20 * 1024 * 1024,
    }),
    (error) => /symbolic link or junction/.test(String((error as { stderr?: unknown }).stderr ?? error)),
    "Builder must reject an intermediate symlink or Windows junction before recursive cleanup",
  );
  await access(linkSentinel);
  assert.equal(await readFile(linkSentinel, "utf8"), "recursive cleanup must not cross this link");
} finally {
  await rm(linkedOutput, { recursive: true, force: true });
  await rm(temporary, { recursive: true, force: true });
}

console.log("Round 24 fixtures passed");
