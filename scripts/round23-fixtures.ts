import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { resolveSafeBuildOutput } from "./build-output-path.mjs";
import { isValidGoogleOAuthClientId, requireGoogleOAuthClientId } from "./google-oauth-client.mjs";

const execute = promisify(execFile);
const root = path.resolve(process.cwd());
const temporary = await mkdtemp(path.join(tmpdir(), "start-tab-round23-"));

const storage: Record<string, unknown> = {
  blockedSites: ["example.com"],
  lastBlockedUrls: { "example.com": "https://example.com/private" },
};
let dynamicRules: chrome.declarativeNetRequest.Rule[] = [];
let dynamicRuleUpdates = 0;

function selected(keys: string | string[] | null | undefined): Record<string, unknown> {
  if (keys === null || keys === undefined) return structuredClone(storage);
  const names = Array.isArray(keys) ? keys : [keys];
  return Object.fromEntries(names.filter((key) => Object.prototype.hasOwnProperty.call(storage, key)).map((key) => [key, structuredClone(storage[key])]));
}

const chromeMock = {
  runtime: {
    getURL: (relativePath: string) => `chrome-extension://round23/${relativePath}`,
    sendMessage: async () => ({ ok: true }),
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => selected(keys),
      set: async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) storage[key] = structuredClone(value);
      },
      remove: async (keys: string | string[]) => {
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

const { unblockHost } = await import("../src/lib/blocklist.js");

try {
  const [first, second] = await Promise.all([
    unblockHost("example.com"),
    unblockHost("example.com"),
  ]);
  assert.deepEqual([first, second], [true, false], "Only the serialized operation that removes the active site may report changed=true");
  assert.deepEqual(storage.blockedSites, []);
  assert.equal(Object.prototype.hasOwnProperty.call(storage, "lastBlockedUrls"), false);
  assert.equal(dynamicRuleUpdates, 1, "An unchanged unblock must not rewrite DNR rules or the data revision");
  const revisionAfterRemoval = structuredClone(storage.startTabDataRevision);
  assert.equal(await unblockHost("example.com"), false);
  assert.deepEqual(storage.startTabDataRevision, revisionAfterRemoval, "Repeated stale unblocks must remain true no-ops");

  const repositoryBuild = resolveSafeBuildOutput(root, tmpdir(), "build-round23");
  assert.equal(repositoryBuild, path.join(root, "build-round23"));
  const externalBuild = resolveSafeBuildOutput(root, tmpdir(), path.join(temporary, "external-build"));
  assert.equal(externalBuild, path.join(temporary, "external-build"));
  for (const dangerous of [".", "src", "scripts", "..", path.parse(root).root, tmpdir()]) {
    assert.throws(() => resolveSafeBuildOutput(root, tmpdir(), dangerous), /Refusing|must use|must be inside/,
      `Dangerous build output must be rejected: ${dangerous}`);
  }

  assert.equal(isValidGoogleOAuthClientId("round23.apps.googleusercontent.com"), true);
  for (const invalid of [
    "REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com",
    "todo.apps.googleusercontent.com",
    "not-a-client.example.com",
  ]) {
    assert.equal(isValidGoogleOAuthClientId(invalid), false, `Placeholder or malformed OAuth ID must be rejected: ${invalid}`);
    assert.throws(() => requireGoogleOAuthClientId(invalid), /non-placeholder Chrome OAuth client/);
  }

  const preservedOutput = path.join(temporary, "placeholder-output");
  await mkdir(preservedOutput, { recursive: true });
  const sentinel = path.join(preservedOutput, "keep.txt");
  await writeFile(sentinel, "preserve existing output until profile validation succeeds", "utf8");
  await assert.rejects(
    () => execute(process.execPath, [path.join(root, "build.mjs"), "--google", `--outdir=${preservedOutput}`], {
      cwd: root,
      env: { ...process.env, GOOGLE_OAUTH_CLIENT_ID: "REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com" },
      maxBuffer: 20 * 1024 * 1024,
    }),
    (error) => String((error as { stderr?: unknown }).stderr ?? error).includes("non-placeholder Chrome OAuth client"),
    "Explicit Google builds must reject placeholder credentials",
  );
  await access(sentinel);
  assert.equal(await readFile(sentinel, "utf8"), "preserve existing output until profile validation succeeds");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log("Round 23 fixtures passed");
