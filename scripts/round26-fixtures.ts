import assert from "node:assert/strict";

const storage: Record<string, unknown> = {
  blockedSites: [],
  startTabDataRevision: { version: 1, updatedAt: 100 },
};
let dynamicRules: chrome.declarativeNetRequest.Rule[] = [];
let dynamicRuleUpdates = 0;
let storageSetCalls = 0;
let storageRemoveCalls = 0;
let failNextDynamicUpdate = false;
let failNextStorageRemove = false;

function expectedRule(host: string): chrome.declarativeNetRequest.Rule {
  return {
    id: 1,
    priority: 1,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
      redirect: { url: `chrome-extension://round26/blocked.html?site=${encodeURIComponent(host)}` },
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
    getURL: (relativePath: string) => `chrome-extension://round26/${relativePath}`,
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
        if (failNextStorageRemove) {
          failNextStorageRemove = false;
          throw new Error("simulated storage remove failure");
        }
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
      if (failNextDynamicUpdate) {
        failNextDynamicUpdate = false;
        throw new Error("simulated DNR repair failure");
      }
      dynamicRules = structuredClone(addRules);
    },
  },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const {
  clearLastBlockedUrl,
  getBlockedSites,
  rememberBlockedNavigation,
  unblockHost,
} = await import("../src/lib/blocklist.js");

function resetCounters(): void {
  dynamicRuleUpdates = 0;
  storageSetCalls = 0;
  storageRemoveCalls = 0;
}

// A stale derived rule must be repairable even when durable storage already says
// that the host is unblocked. A failed repair must not be reported as success.
dynamicRules = [expectedRule("stale.example")];
const revisionBeforeFailedDnrRepair = structuredClone(storage.startTabDataRevision);
failNextDynamicUpdate = true;
resetCounters();
await assert.rejects(
  () => unblockHost("stale.example"),
  /simulated DNR repair failure/,
  "A failed stale-rule repair must propagate to the caller",
);
assert.deepEqual(dynamicRules, [expectedRule("stale.example")]);
assert.deepEqual(storage.startTabDataRevision, revisionBeforeFailedDnrRepair);
assert.equal(storageSetCalls, 0, "DNR-only failure must not rewrite storage");
assert.equal(storageRemoveCalls, 0, "DNR-only failure must not remove storage keys");

resetCounters();
const changedByStaleRuleRepair = await unblockHost("stale.example");
assert.equal(changedByStaleRuleRepair, false,
  "Removing only a stale derived DNR rule must not claim a durable blocklist change");
assert.deepEqual(dynamicRules, []);
assert.equal(dynamicRuleUpdates, 1, "A no-op unblock must remove an extra stale DNR rule");
assert.equal(storageSetCalls, 0);
assert.equal(storageRemoveCalls, 0);
assert.deepEqual(storage.startTabDataRevision, revisionBeforeFailedDnrRepair,
  "DNR-only unblock repair must not advance the shared data revision");

// Legacy migration must be rollback-safe and retryable after transient failure.
storage.blockedSites = [];
storage.blocked = ["Later.Example"];
storage.startTabDataRevision = { version: 1, updatedAt: 200 };
const beforeFailedMigration = structuredClone(storage);
failNextStorageRemove = true;
resetCounters();
await assert.rejects(
  () => getBlockedSites(),
  /simulated storage remove failure/,
  "Legacy migration must surface a failed legacy-key removal",
);
assert.deepEqual(storage, beforeFailedMigration,
  "Failed legacy migration must restore the exact blocklist and revision snapshot");

resetCounters();
assert.deepEqual(await getBlockedSites(), ["later.example"]);
assert.equal(Object.prototype.hasOwnProperty.call(storage, "blocked"), false);
assert.ok((storage.startTabDataRevision as { updatedAt: number }).updatedAt > 200,
  "Successful legacy migration must advance the revision");

// A successful migration pass must not permanently disable future migration.
const revisionBeforeReintroducedLegacy = (storage.startTabDataRevision as { updatedAt: number }).updatedAt;
storage.blocked = ["Second.Example"];
resetCounters();
assert.deepEqual(await getBlockedSites(), ["later.example", "second.example"]);
assert.equal(Object.prototype.hasOwnProperty.call(storage, "blocked"), false,
  "A legacy key introduced after an earlier successful pass must still be migrated");
assert.ok((storage.startTabDataRevision as { updatedAt: number }).updatedAt > revisionBeforeReintroducedLegacy);

// Empty legacy containers are stale schema state too and must be removed.
const revisionBeforeEmptyLegacyRepair = (storage.startTabDataRevision as { updatedAt: number }).updatedAt;
storage.blocked = [];
resetCounters();
assert.deepEqual(await getBlockedSites(), ["later.example", "second.example"]);
assert.equal(Object.prototype.hasOwnProperty.call(storage, "blocked"), false,
  "An empty legacy blocklist key must be removed instead of cached forever");
assert.ok((storage.startTabDataRevision as { updatedAt: number }).updatedAt > revisionBeforeEmptyLegacyRepair);

// Remembered navigation metadata must remain correlated with the active sites.
storage.blockedSites = ["example.com"];
storage.lastBlockedUrls = {
  "example.com": "https://example.com/private",
  "stale.example": "https://stale.example/old",
};
storage.startTabDataRevision = { version: 1, updatedAt: 500 };
dynamicRules = [expectedRule("example.com")];
resetCounters();
await rememberBlockedNavigation("https://example.com/private");
assert.deepEqual(storage.lastBlockedUrls, { "example.com": "https://example.com/private" },
  "An identical remembered URL must still remove metadata for no-longer-blocked sites");
assert.equal(dynamicRuleUpdates, 0, "Auxiliary URL repair must not churn DNR rules");
assert.ok((storage.startTabDataRevision as { updatedAt: number }).updatedAt > 500);

storage.lastBlockedUrls = { "stale.example": "https://stale.example/old" };
const revisionBeforeStaleUrlClear = (storage.startTabDataRevision as { updatedAt: number }).updatedAt;
resetCounters();
await clearLastBlockedUrl("missing.example");
assert.equal(Object.prototype.hasOwnProperty.call(storage, "lastBlockedUrls"), false,
  "Clearing metadata must remove stale URLs unrelated to the active blocklist");
assert.ok((storage.startTabDataRevision as { updatedAt: number }).updatedAt > revisionBeforeStaleUrlClear);

console.log("Round 26 fixtures passed");
