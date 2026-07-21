import assert from "node:assert/strict";

let localStorage: Record<string, unknown> = {};
let dynamicRules: chrome.declarativeNetRequest.Rule[] = [];
let dynamicRuleReads = 0;
let dynamicRuleUpdates = 0;
let injectForeignCollisionOnSecondRead = false;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requestedKeys(keys?: string | string[] | Record<string, unknown> | null): string[] {
  if (keys == null) return Object.keys(localStorage);
  if (typeof keys === "string") return [keys];
  if (Array.isArray(keys)) return keys;
  return Object.keys(keys);
}

function selected(keys?: string | string[] | Record<string, unknown> | null): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of requestedKeys(keys)) {
    if (Object.prototype.hasOwnProperty.call(localStorage, key)) output[key] = clone(localStorage[key]);
    else if (keys && typeof keys === "object" && !Array.isArray(keys)) output[key] = clone(keys[key]);
  }
  return output;
}

function foreignRule(id: number, redirectUrl = "chrome-extension://round31/another-feature.html"): chrome.declarativeNetRequest.Rule {
  return {
    id,
    priority: 1,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
      redirect: { url: redirectUrl },
    },
    condition: {
      requestDomains: ["foreign.example"],
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
    },
  };
}

function legacyBlocklistRule(id: number, host: string): chrome.declarativeNetRequest.Rule {
  return {
    id,
    priority: host.split(".").length,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
      redirect: { url: `chrome-extension://round31/blocked.html?site=${encodeURIComponent(host)}` },
    },
    condition: {
      requestDomains: [host],
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
    },
  };
}

const chromeMock = {
  runtime: {
    getURL: (relativePath: string) => `chrome-extension://round31/${relativePath}`,
    getManifest: () => ({ oauth2: { client_id: "round31.apps.googleusercontent.com" } }),
    sendMessage: async () => ({ ok: true }),
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | Record<string, unknown> | null) => selected(keys),
      set: async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) localStorage[key] = clone(value);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete localStorage[key];
      },
    },
    sync: {
      QUOTA_BYTES_PER_ITEM: 8192,
      QUOTA_BYTES: 102_400,
      get: async () => ({}),
      set: async () => undefined,
      remove: async () => undefined,
    },
  },
  declarativeNetRequest: {
    RuleActionType: {
      ALLOW: "allow",
      ALLOW_ALL_REQUESTS: "allowAllRequests",
      BLOCK: "block",
      MODIFY_HEADERS: "modifyHeaders",
      REDIRECT: "redirect",
      UPGRADE_SCHEME: "upgradeScheme",
    },
    ResourceType: { MAIN_FRAME: "main_frame" },
    MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES: 5_000,
    MAX_NUMBER_OF_DYNAMIC_RULES: 30_000,
    getDynamicRules: async () => {
      dynamicRuleReads += 1;
      if (injectForeignCollisionOnSecondRead && dynamicRuleReads === 2) {
        dynamicRules.push(foreignRule(1));
      }
      return clone(dynamicRules);
    },
    updateDynamicRules: async ({ removeRuleIds = [], addRules = [] }: {
      removeRuleIds?: number[];
      addRules?: chrome.declarativeNetRequest.Rule[];
    }) => {
      dynamicRuleUpdates += 1;
      const next = new Map(dynamicRules.map((rule) => [rule.id, clone(rule)]));
      for (const id of removeRuleIds) next.delete(id);
      for (const rule of addRules) {
        if (next.has(rule.id)) throw new Error(`duplicate dynamic rule ID ${rule.id}`);
        next.set(rule.id, clone(rule));
      }
      dynamicRules = [...next.values()].sort((left, right) => left.id - right.id);
    },
  },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const blocklist = await import("../src/lib/blocklist.js");
const chromeSync = await import("../src/lib/chrome-sync.js");

function resetDnrState(): void {
  localStorage = {};
  dynamicRules = [];
  dynamicRuleReads = 0;
  dynamicRuleUpdates = 0;
  injectForeignCollisionOnSecondRead = false;
}

// A rule owned by another Start Tab feature may intentionally use the same
// blocked page. Ownership must require the exact marker/legacy shape instead of
// deleting every redirect whose URL merely starts with blocked.html?site=.
resetDnrState();
localStorage = {
  blockedSites: ["blocked.example"],
  startTabDataRevision: { version: 1, updatedAt: 1 },
};
const samePageForeign = foreignRule(
  1,
  "chrome-extension://round31/blocked.html?site=foreign.example&owner=another-feature",
);
dynamicRules = [samePageForeign];
await blocklist.syncRules();
assert.deepEqual(dynamicRules.find((rule) => rule.id === samePageForeign.id), samePageForeign,
  "A same-page foreign redirect must survive blocklist synchronization");
const ownedRule = dynamicRules.find((rule) => rule.id !== samePageForeign.id);
assert.ok(ownedRule?.action.redirect?.url?.includes("owner=start-tab-blocklist-v1"),
  "Current blocklist rules must carry an explicit ownership marker");

// Exact pre-marker rules remain recognized as bounded legacy ownership and are
// migrated to the marker on the next reconciliation.
resetDnrState();
localStorage = {
  blockedSites: ["example.com"],
  startTabDataRevision: { version: 1, updatedAt: 2 },
};
dynamicRules = [legacyBlocklistRule(1, "example.com")];
await blocklist.syncRules();
assert.equal(dynamicRules.length, 1);
assert.ok(dynamicRules[0]?.action.redirect?.url?.includes("owner=start-tab-blocklist-v1"),
  "Exact legacy blocklist rules must migrate to explicit ownership");

// A foreign rule can appear between allocation and the final ownership check.
// Reconciliation must re-read and allocate the next free ID instead of failing
// a safe operation that has a valid collision-free solution.
resetDnrState();
localStorage = {
  blockedSites: ["example.com"],
  startTabDataRevision: { version: 1, updatedAt: 3 },
};
injectForeignCollisionOnSecondRead = true;
await blocklist.syncRules();
assert.equal(dynamicRuleUpdates, 1, "A transient foreign-ID collision must be retried before the DNR update");
assert.ok(dynamicRules.some((rule) => rule.id === 1
  && rule.action.redirect?.url === "chrome-extension://round31/another-feature.html"),
"The concurrently added foreign rule must remain untouched");
assert.ok(dynamicRules.some((rule) => rule.id === 2
  && rule.action.redirect?.url?.includes("blocked.html?site=example.com")),
"Retry must install the blocklist rule at the newly free ID");

// Every Browser Sync upload must write one complete fixed-size chunk frame.
// Empty inactive slots replace stale values in the same set operation, so no
// later remove can erase chunks from a competing device upload.
const meta: chromeSync.SyncMeta = {
  version: 3,
  updatedAt: "2030-01-01T00:00:00.000Z",
  contentUpdatedAt: 123,
  deviceId: "round31-device",
  snapshotId: "round31-snapshot",
  checksum: "a".repeat(64),
  contentChecksum: "b".repeat(64),
  chunks: 2,
  backupVersion: 4,
};
const payload = chromeSync.completeChromeSyncPayload(meta, ["first", "second"]);
assert.equal(payload.startTabSyncMeta, meta);
assert.equal(payload.startTabSyncChunk0, "first");
assert.equal(payload.startTabSyncChunk1, "second");
for (let index = 2; index < 12; index += 1) {
  assert.equal(payload[`startTabSyncChunk${index}`], "",
    "Inactive Browser Sync chunk slots must be cleared inside the committed frame");
}
assert.equal(
  Object.keys(payload).filter((key) => key.startsWith("startTabSyncChunk")).length,
  12,
  "Every Browser Sync upload must contain all canonical chunk slots",
);

console.log("Round 31 fixtures passed");
