import assert from "node:assert/strict";

interface AlarmState {
  name: string;
  scheduledTime: number;
  periodInMinutes?: number;
}

let storage: Record<string, unknown> = {};
let dynamicRules: chrome.declarativeNetRequest.Rule[] = [];
const alarms = new Map<string, AlarmState>();
let dynamicRuleUpdates = 0;
let failOriginalStorageRestore = false;
let failRemoveKey: string | null = null;
let alarmCreateCalls = 0;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requestedKeys(keys?: string | string[] | Record<string, unknown> | null): string[] {
  if (keys == null) return Object.keys(storage);
  if (typeof keys === "string") return [keys];
  if (Array.isArray(keys)) return keys;
  return Object.keys(keys);
}

function selected(keys?: string | string[] | Record<string, unknown> | null): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of requestedKeys(keys)) {
    if (Object.prototype.hasOwnProperty.call(storage, key)) output[key] = clone(storage[key]);
    else if (keys && typeof keys === "object" && !Array.isArray(keys)) output[key] = clone(keys[key]);
  }
  return output;
}

function redirectRule(id: number, host: string, priority = 1): chrome.declarativeNetRequest.Rule {
  return {
    id,
    priority,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
      redirect: { url: `chrome-extension://round27/blocked.html?site=${encodeURIComponent(host)}` },
    },
    condition: {
      requestDomains: [host],
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
    },
  };
}

const unrelatedRule = {
  id: 99,
  priority: 7,
  action: { type: "block" },
  condition: { urlFilter: "||unrelated.example^", resourceTypes: ["main_frame"] },
} as unknown as chrome.declarativeNetRequest.Rule;

const chromeMock = {
  runtime: {
    getURL: (relativePath: string) => `chrome-extension://round27/${relativePath}`,
    sendMessage: async () => ({ ok: true }),
    getManifest: () => ({}),
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | Record<string, unknown> | null) => selected(keys),
      set: async (items: Record<string, unknown>) => {
        const restoringOriginal = Array.isArray(items.blockedSites)
          && (items.blockedSites as unknown[]).length === 1
          && items.blockedSites[0] === "example.com"
          && typeof items.startTabDataRevision === "object";
        if (failOriginalStorageRestore && restoringOriginal) {
          failOriginalStorageRestore = false;
          throw new Error("simulated original storage restore failure");
        }
        for (const [key, value] of Object.entries(items)) storage[key] = clone(value);
      },
      remove: async (keys: string | string[]) => {
        const names = Array.isArray(keys) ? keys : [keys];
        if (failRemoveKey && names.includes(failRemoveKey)) {
          const failed = failRemoveKey;
          failRemoveKey = null;
          throw new Error(`simulated remove failure for ${failed}`);
        }
        for (const key of names) delete storage[key];
      },
    },
  },
  declarativeNetRequest: {
    RuleActionType: { REDIRECT: "redirect" },
    ResourceType: { MAIN_FRAME: "main_frame" },
    getDynamicRules: async () => clone(dynamicRules),
    updateDynamicRules: async ({ removeRuleIds = [], addRules = [] }: {
      removeRuleIds?: number[];
      addRules?: chrome.declarativeNetRequest.Rule[];
    }) => {
      dynamicRuleUpdates += 1;
      const next = new Map(dynamicRules.map((rule) => [rule.id, clone(rule)]));
      for (const id of removeRuleIds) next.delete(id);
      for (const rule of addRules) next.set(rule.id, clone(rule));
      dynamicRules = [...next.values()].sort((left, right) => left.id - right.id);
    },
  },
  alarms: {
    getAll: async () => clone([...alarms.values()]),
    clear: async (name: string) => alarms.delete(name),
    create: async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
      alarmCreateCalls += 1;
      alarms.set(name, {
        name,
        scheduledTime: typeof info.when === "number" ? info.when : Date.now(),
        ...(typeof info.periodInMinutes === "number" ? { periodInMinutes: info.periodInMinutes } : {}),
      });
    },
  },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const blocklist = await import("../src/lib/blocklist.js");
const revision = await import("../src/lib/data-revision.js");
const backup = await import("../src/lib/backup.js");

function resetState(): void {
  storage = {};
  dynamicRules = [];
  alarms.clear();
  dynamicRuleUpdates = 0;
  failOriginalStorageRestore = false;
  failRemoveKey = null;
  alarmCreateCalls = 0;
}

// Parent and child block entries overlap in requestDomains. The child rule must
// have strictly higher priority, and JavaScript matching must choose the same
// child deterministically.
resetState();
storage = {
  blockedSites: ["app.example.com", "example.com"],
  startTabDataRevision: { version: 1, updatedAt: 100 },
};
await blocklist.syncRules();
assert.deepEqual(dynamicRules, [
  redirectRule(1, "app.example.com", 2),
  redirectRule(2, "example.com", 1),
], "A blocked child domain must have higher DNR priority than its blocked parent");
assert.equal(
  await blocklist.blockedSiteForUrl("https://deep.app.example.com/private"),
  "app.example.com",
  "The most-specific blocked suffix must own an overlapping navigation",
);
const rememberedHost = await blocklist.rememberBlockedNavigation("https://deep.app.example.com/private");
assert.equal(rememberedHost, "app.example.com",
  "Remembered navigation must return the exact site selected from its locked snapshot");
assert.deepEqual(storage.lastBlockedUrls, {
  "app.example.com": "https://deep.app.example.com/private",
});

// A failed durable mutation after DNR changed must restore the exact original
// DNR snapshot, including rules not derivable from blockedSites.
resetState();
storage = {
  blockedSites: ["example.com"],
  startTabDataRevision: { version: 2, updatedAt: 900 },
};
dynamicRules = [redirectRule(1, "example.com"), clone(unrelatedRule)];
const storageBeforeBlockFailure = clone(storage);
const rulesBeforeBlockFailure = clone(dynamicRules);
await assert.rejects(
  () => blocklist.blockHost("new.example"),
  /newer extension version/,
  "Future revision rejection must fail after exercising mutation rollback",
);
assert.deepEqual(storage, storageBeforeBlockFailure,
  "Failed blocklist mutation must restore the exact storage snapshot");
assert.deepEqual(dynamicRules, rulesBeforeBlockFailure,
  "Failed blocklist mutation must restore the exact original DNR snapshot");
assert.equal(dynamicRuleUpdates, 2, "DNR must be updated once and restored once");

// A storage rollback failure must not skip the independent DNR rollback.
resetState();
storage = {
  blockedSites: ["example.com"],
  startTabDataRevision: { version: 2, updatedAt: 901 },
};
dynamicRules = [redirectRule(1, "example.com"), clone(unrelatedRule)];
const rulesBeforeIndependentRollback = clone(dynamicRules);
failOriginalStorageRestore = true;
await assert.rejects(
  () => blocklist.blockHost("new.example"),
  (error: unknown) => error instanceof AggregateError,
  "Incomplete storage rollback must surface an aggregate failure",
);
assert.deepEqual(dynamicRules, rulesBeforeIndependentRollback,
  "DNR rollback must still run after storage rollback fails");

// The generic revision helper must attempt snapshot restoration even when
// removal of newly-created keys fails.
resetState();
storage = {
  alpha: "before",
  startTabDataRevision: { version: 1, updatedAt: 50 },
};
failRemoveKey = "beta";
await assert.rejects(
  () => revision.commitStorageMutationWithRevision(["alpha", "beta"], async () => {
    await chrome.storage.local.set({ alpha: "after", beta: "temporary" });
    throw new Error("simulated mutation failure");
  }),
  (error: unknown) => error instanceof AggregateError,
  "A failed key removal during rollback must be aggregated",
);
assert.equal(storage.alpha, "before",
  "Snapshot set must still run when removal of an absent-at-snapshot key fails");
assert.equal(storage.beta, "temporary",
  "The failed removal remains visible so incomplete rollback is never hidden");

// Backup rollback must restore exact storage, exact DNR, and durable alarms.
resetState();
const existingAlarm: AlarmState = {
  name: "start-tab-clock:round27:token",
  scheduledTime: Date.now() + 60_000,
};
storage = {
  blockedSites: ["example.com"],
  localeOverride: "ru",
  startTabDataRevision: { version: 2, updatedAt: 1_000 },
};
dynamicRules = [redirectRule(1, "example.com"), clone(unrelatedRule)];
alarms.set(existingAlarm.name, clone(existingAlarm));
const storageBeforeImport = clone(storage);
const rulesBeforeImport = clone(dynamicRules);
const alarmsBeforeImport = clone([...alarms.values()]);
const importValue = {
  app: "Start Tab",
  version: 4,
  exportedAt: new Date().toISOString(),
  snapshotId: "round27-import",
  storage: { blockedSites: ["imported.example"] },
};
await assert.rejects(
  () => backup.importBackup(importValue),
  /newer extension version/,
  "Future revision rejection must exercise complete backup rollback",
);
assert.deepEqual(storage, storageBeforeImport, "Backup failure must restore exact storage");
assert.deepEqual(dynamicRules, rulesBeforeImport, "Backup failure must restore exact original DNR rules");
assert.deepEqual([...alarms.values()], alarmsBeforeImport, "Backup failure must restore exact durable alarms");
assert.ok(alarmCreateCalls > 0, "Backup rollback must recreate the prior durable alarm snapshot");

console.log("Round 27 fixtures passed");
