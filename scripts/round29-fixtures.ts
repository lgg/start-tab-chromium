import assert from "node:assert/strict";

interface AlarmState {
  name: string;
  scheduledTime: number;
  periodInMinutes?: number;
}

let storage: Record<string, unknown> = {};
let dynamicRules: chrome.declarativeNetRequest.Rule[] = [];
const alarms = new Map<string, AlarmState>();
const createAttempts: string[] = [];
const failClearOnceNames = new Set<string>();
let failNextStorageSet = false;

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
    getURL: (relativePath: string) => `chrome-extension://round29/${relativePath}`,
    getManifest: () => ({ oauth2: { client_id: "round29.apps.googleusercontent.com" } }),
    sendMessage: async () => ({ ok: true }),
  },
  identity: {
    getAuthToken: async () => ({ token: "round29-token" }),
    removeCachedAuthToken: async () => undefined,
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | Record<string, unknown> | null) => selected(keys),
      set: async (items: Record<string, unknown>) => {
        if (failNextStorageSet) {
          failNextStorageSet = false;
          throw new Error("simulated instance storage rollback failure");
        }
        for (const [key, value] of Object.entries(items)) storage[key] = clone(value);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
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
      if (failClearOnceNames.delete(name)) {
        failNextStorageSet = true;
        throw new Error(`simulated primary alarm clear failure for ${name}`);
      }
      return alarms.delete(name);
    },
    create: async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
      createAttempts.push(name);
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
const settingsLibrary = await import("../src/lib/start-page-settings.js");
const google = await import("../src/lib/google-integration.js");

function resetState(): void {
  storage = {};
  dynamicRules = [];
  alarms.clear();
  createAttempts.length = 0;
  failClearOnceNames.clear();
  failNextStorageSet = false;
}

function foreignRedirectRule(id: number): chrome.declarativeNetRequest.Rule {
  return {
    id,
    priority: 1,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
      redirect: { url: "chrome-extension://round29/another-feature.html" },
    },
    condition: {
      urlFilter: "|https://foreign.example/",
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
    },
  };
}

// Blocklist synchronization owns only redirects to blocked.html. Rules from a
// different Start Tab feature must survive both ordinary sync and rollback.
resetState();
storage = {
  blockedSites: ["example.com"],
  startTabDataRevision: { version: 1, updatedAt: 1 },
};
const foreignRule = foreignRedirectRule(9001);
dynamicRules = [foreignRule];
await blocklist.syncRules();
assert.deepEqual(dynamicRules.find((rule) => rule.id === foreignRule.id), foreignRule,
  "Blocklist synchronization must preserve unrelated dynamic rules");
assert.ok(dynamicRules.some((rule) => rule.action.redirect?.url?.includes("blocked.html?site=example.com")),
  "Blocklist synchronization must still install its owned redirect rule");

// A foreign rule that occupies a blocklist rule ID must cause a safe failure,
// never silent deletion or replacement of the foreign rule.
resetState();
storage = {
  blockedSites: ["example.com"],
  startTabDataRevision: { version: 1, updatedAt: 2 },
};
const collidingRule = foreignRedirectRule(1);
dynamicRules = [collidingRule];
await assert.rejects(
  () => blocklist.syncRules(),
  /conflicts with a dynamic rule owned by another Start Tab feature/,
  "DNR ownership collisions must fail before any foreign rule is removed",
);
assert.deepEqual(dynamicRules, [collidingRule], "A DNR ownership collision must leave the complete rule set untouched");

// Instance deletion must attempt alarm restoration even when storage rollback
// itself fails. This is a separate path from the reset transactions covered by
// Round 28.
resetState();
const settings = settingsLibrary.createDefaultStartPageSettings(100);
const timerBlock = settings.layout.blocks.find((block) => block.id === "timer-main");
assert.ok(timerBlock && timerBlock.type === "timer", "Default settings must contain timer-main for the fixture");
const runtimeState = runtime.normalizeRuntimeState(undefined, settings);
const runningClock = runtime.startClockState(runtime.defaultClockForBlock(timerBlock), Date.now());
runtimeState.updatedAt = 200;
runtimeState.clocks[timerBlock.id] = runningClock;
storage = {
  startPageSettings: settings,
  startPageRuntimeState: runtimeState,
  startTabDataRevision: { version: 1, updatedAt: 200 },
};
assert.ok(runningClock.completionToken, "Running timer must have a completion token");
const timerAlarm = runtime.clockAlarmName(timerBlock.id, runningClock.completionToken);
alarms.set(timerAlarm, { name: timerAlarm, scheduledTime: runningClock.targetAt ?? Date.now() + 60_000 });
failClearOnceNames.add(timerAlarm);
await assert.rejects(
  () => runtime.deleteInstanceRuntime(timerBlock.id),
  /Failed to delete instance runtime and restore the previous state/,
  "Instance deletion must report the primary failure and incomplete storage rollback",
);
assert.ok(createAttempts.includes(timerAlarm),
  "Alarm rollback must still run after instance storage rollback fails");

// Calendar pagination tokens are valid only with the same query parameters.
// Delay page one so a per-page new Date() call would produce a different timeMin.
const originalFetch = globalThis.fetch;
const requestedCalendarUrls: URL[] = [];
let calendarPage = 0;
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  writable: true,
  value: async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    requestedCalendarUrls.push(url);
    calendarPage += 1;
    if (calendarPage === 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return new Response(JSON.stringify({
        items: [{ id: "description-only", summary: "Other title", start: { dateTime: "2030-01-01T10:00:00Z" }, end: { dateTime: "2030-01-01T11:00:00Z" } }],
        nextPageToken: "page-two",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      items: [{ id: "match", summary: "Needle planning", start: { dateTime: "2030-01-02T10:00:00Z" }, end: { dateTime: "2030-01-02T11:00:00Z" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  },
});
try {
  const events = await google.listCalendarEvents("primary", 1, "needle");
  assert.equal(events[0]?.id, "match", "Calendar title filtering must continue to the next page");
  assert.equal(requestedCalendarUrls.length, 2, "Calendar fixture must exercise a paginated request");
  assert.equal(requestedCalendarUrls[1]?.searchParams.get("pageToken"), "page-two");
  assert.equal(
    requestedCalendarUrls[0]?.searchParams.get("timeMin"),
    requestedCalendarUrls[1]?.searchParams.get("timeMin"),
    "Every page of one Calendar query must reuse the exact same timeMin",
  );
} finally {
  Object.defineProperty(globalThis, "fetch", { value: originalFetch, configurable: true, writable: true });
}

console.log("Round 29 fixtures passed");
