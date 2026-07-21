import assert from "node:assert/strict";

interface AlarmState {
  name: string;
  scheduledTime: number;
  periodInMinutes?: number;
}

let storage: Record<string, unknown> = {};
let dynamicRules: chrome.declarativeNetRequest.Rule[] = [];
const alarms = new Map<string, AlarmState>();
const clearAttempts: string[] = [];
const createAttempts: string[] = [];
const clearCounts = new Map<string, number>();
const failingClearNames = new Set<string>();
const failingCreateNames = new Set<string>();
let delayedFirstClearName: string | null = null;
let failSingleLegacyRemoval = false;
let runtimeSnapshotSetAttempted = false;

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

const chromeMock = {
  runtime: {
    getURL: (relativePath: string) => `chrome-extension://round28/${relativePath}`,
    sendMessage: async () => ({ ok: true }),
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | Record<string, unknown> | null) => selected(keys),
      set: async (items: Record<string, unknown>) => {
        if (Object.prototype.hasOwnProperty.call(items, "startPageRuntimeState")
          && Object.prototype.hasOwnProperty.call(items, "startTabDataRevision")) {
          runtimeSnapshotSetAttempted = true;
        }
        for (const [key, value] of Object.entries(items)) storage[key] = clone(value);
      },
      remove: async (keys: string | string[]) => {
        const names = Array.isArray(keys) ? keys : [keys];
        if (failSingleLegacyRemoval && names.length === 1 && names[0] === "startTabInstanceState") {
          failSingleLegacyRemoval = false;
          throw new Error("simulated rollback removal failure");
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
      const next = new Map(dynamicRules.map((rule) => [rule.id, clone(rule)]));
      for (const id of removeRuleIds) next.delete(id);
      for (const rule of addRules) next.set(rule.id, clone(rule));
      dynamicRules = [...next.values()].sort((left, right) => left.id - right.id);
    },
  },
  alarms: {
    getAll: async () => clone([...alarms.values()]),
    clear: async (name: string) => {
      clearAttempts.push(name);
      const count = (clearCounts.get(name) ?? 0) + 1;
      clearCounts.set(name, count);
      if (delayedFirstClearName === name && count === 1) {
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      if (failingClearNames.has(name)) throw new Error(`simulated clear failure for ${name}`);
      return alarms.delete(name);
    },
    create: async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
      createAttempts.push(name);
      if (failingCreateNames.has(name)) throw new Error(`simulated create failure for ${name}`);
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
const runtime = await import("../src/lib/start-page-runtime.js");

function resetState(): void {
  storage = {};
  dynamicRules = [];
  alarms.clear();
  clearAttempts.length = 0;
  createAttempts.length = 0;
  clearCounts.clear();
  failingClearNames.clear();
  failingCreateNames.clear();
  delayedFirstClearName = null;
  failSingleLegacyRemoval = false;
  runtimeSnapshotSetAttempted = false;
}

function redirectRule(id: number, host: string, priority: number): chrome.declarativeNetRequest.Rule {
  return {
    id,
    priority,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
      redirect: { url: `chrome-extension://round28/blocked.html?site=${encodeURIComponent(host)}` },
    },
    condition: {
      requestDomains: [host],
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
    },
  };
}

// The old max(1, depth - 1) formula tied one-label parents with their first
// child. DNR and JavaScript must agree for localhost-style/internal domains too.
resetState();
storage = {
  blockedSites: ["app.localhost", "localhost"],
  startTabDataRevision: { version: 1, updatedAt: 1 },
};
await blocklist.syncRules();
assert.deepEqual(dynamicRules, [
  redirectRule(1, "app.localhost", 2),
  redirectRule(2, "localhost", 1),
], "A two-label child must have strictly higher DNR priority than its one-label parent");
assert.equal(await blocklist.blockedSiteForUrl("https://deep.app.localhost/private"), "app.localhost");

// Reset rollback must restore storage and alarms independently. A failure while
// removing a key absent from the snapshot may not skip the snapshot set or the
// durable alarm restoration.
resetState();
const originalRuntime = { version: 2, updatedAt: 7, clocks: {}, notes: {}, tasks: {}, linkPages: {} };
const futureRevision = { version: 99, updatedAt: 900 };
storage = {
  startPageRuntimeState: originalRuntime,
  startTabDataRevision: futureRevision,
};
const originalAlarmName = `${runtime.CLOCK_ALARM_PREFIX}timer:token`;
alarms.set(originalAlarmName, { name: originalAlarmName, scheduledTime: Date.now() + 60_000 });
failSingleLegacyRemoval = true;
await assert.rejects(
  () => runtime.resetStartPageRuntimeState(),
  /Failed to reset Start Tab runtime and restore the previous state/,
  "Runtime reset must surface the primary future-revision failure and incomplete storage rollback",
);
assert.equal(runtimeSnapshotSetAttempted, true,
  "Snapshot set must still run after removal of an absent runtime key fails");
assert.deepEqual(storage.startPageRuntimeState, originalRuntime,
  "Runtime snapshot must be restored despite a sibling rollback failure");
assert.deepEqual(storage.startTabDataRevision, futureRevision,
  "The exact pre-reset data revision must be restored");
assert.ok(createAttempts.includes(originalAlarmName),
  "Alarm restoration must still run after storage rollback fails");
assert.ok(alarms.has(originalAlarmName),
  "The original durable clock alarm must be recreated");

// One broken alarm operation must not prevent attempts for the remaining alarm
// snapshot entries. Unrelated alarms must never be cleared.
resetState();
const alarmA = `${runtime.CLOCK_ALARM_PREFIX}a:one`;
const alarmB = `${runtime.CLOCK_ALARM_PREFIX}b:two`;
const alarmC = `${runtime.CLOCK_ALARM_PREFIX}c:three`;
const unrelated = "other-feature-alarm";
alarms.set(alarmA, { name: alarmA, scheduledTime: 10 });
alarms.set(alarmB, { name: alarmB, scheduledTime: 20 });
alarms.set(unrelated, { name: unrelated, scheduledTime: 30 });
failingClearNames.add(alarmA);
failingCreateNames.add(alarmA);
await assert.rejects(
  () => runtime.restoreClockAlarmSnapshot([
    { name: alarmA, scheduledTime: 100 },
    { name: alarmC, scheduledTime: 300, periodInMinutes: 5 },
  ]),
  /incomplete|failure/,
  "Alarm snapshot restore must report all failed clear/create work",
);
assert.deepEqual(clearAttempts.sort(), [alarmA, alarmB].sort(),
  "Every existing Start Tab alarm must receive a clear attempt");
assert.deepEqual(createAttempts.sort(), [alarmA, alarmC].sort(),
  "Every snapshot alarm must receive a create attempt even after an earlier failure");
assert.equal(clearAttempts.includes(unrelated), false,
  "Alarm rollback must not touch unrelated extension alarms");
assert.ok(alarms.has(unrelated), "Unrelated alarms must remain present");
assert.ok(alarms.has(alarmC), "Later snapshot alarms must still be recreated");

// Promise.all rejects before sibling clears settle. A delayed clear from the
// failed primary operation must not run after rollback and delete a recreated
// snapshot alarm.
resetState();
const raceAlarmA = `${runtime.CLOCK_ALARM_PREFIX}race-a:one`;
const raceAlarmB = `${runtime.CLOCK_ALARM_PREFIX}race-b:two`;
alarms.set(raceAlarmA, { name: raceAlarmA, scheduledTime: 1000 });
alarms.set(raceAlarmB, { name: raceAlarmB, scheduledTime: 2000 });
failingClearNames.add(raceAlarmA);
delayedFirstClearName = raceAlarmB;
await assert.rejects(
  () => runtime.resetStartPageRuntimeState(),
  /Failed to reset Start Tab runtime and restore the previous state/,
  "Failed alarm cleanup must enter rollback only after every primary clear settles",
);
await new Promise((resolve) => setTimeout(resolve, 90));
assert.ok((clearCounts.get(raceAlarmB) ?? 0) >= 2,
  "The delayed alarm must be cleared by the primary operation and again by exact rollback");
assert.ok(alarms.has(raceAlarmA) && alarms.has(raceAlarmB),
  "No late primary clear may delete alarms recreated by rollback");

console.log("Round 28 fixtures passed");
