import assert from "node:assert/strict";

const localState: Record<string, unknown> = {};
interface AlarmState { name: string; scheduledTime: number; periodInMinutes?: number }
const alarmState = new Map<string, AlarmState>();
let failClearName: string | null = null;
let nextTabId = 40;
const removedTabs: number[] = [];
const updatedUrls: string[] = [];
let rejectNativeUpdates = false;
let consumeBypassOnUpdate = false;

function requestedKeys(keys?: string | string[] | Record<string, unknown> | null): string[] {
  if (keys == null) return [];
  if (typeof keys === "string") return [keys];
  return Array.isArray(keys) ? keys : Object.keys(keys);
}

const chromeMock = {
  storage: {
    local: {
      async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
        if (keys == null) return structuredClone(localState);
        const output: Record<string, unknown> = {};
        for (const key of requestedKeys(keys)) {
          if (Object.prototype.hasOwnProperty.call(localState, key)) output[key] = structuredClone(localState[key]);
          else if (typeof keys === "object" && !Array.isArray(keys) && keys !== null) output[key] = structuredClone(keys[key]);
        }
        return output;
      },
      async set(items: Record<string, unknown>): Promise<void> {
        for (const [key, value] of Object.entries(items)) localState[key] = structuredClone(value);
      },
      async remove(keys: string | string[]): Promise<void> {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete localState[key];
      },
    },
  },
  alarms: {
    async getAll(): Promise<AlarmState[]> { return structuredClone([...alarmState.values()]); },
    async clear(name: string): Promise<boolean> {
      if (failClearName === name) {
        failClearName = null;
        throw new Error(`forced alarm clear rejection for ${name}`);
      }
      return alarmState.delete(name);
    },
    async create(name: string, info: chrome.alarms.AlarmCreateInfo): Promise<void> {
      const scheduledTime = typeof info.when === "number"
        ? info.when
        : Date.now() + Math.max(0, info.delayInMinutes ?? 0) * 60_000;
      alarmState.set(name, {
        name,
        scheduledTime,
        ...(typeof info.periodInMinutes === "number" ? { periodInMinutes: info.periodInMinutes } : {}),
      });
    },
  },
  tabs: {
    async create(): Promise<chrome.tabs.Tab> {
      nextTabId += 1;
      return { id: nextTabId } as chrome.tabs.Tab;
    },
    async update(tabId: number, update: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab> {
      updatedUrls.push(String(update.url ?? ""));
      if (rejectNativeUpdates) throw new Error(`forced native URL rejection for ${update.url ?? ""}`);
      if (consumeBypassOnUpdate) delete localState.startTabNativeNewTabBypass;
      return { id: tabId, url: update.url } as chrome.tabs.Tab;
    },
    async remove(tabId: number): Promise<void> { removedTabs.push(tabId); },
  },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const [settingsApi, runtimeApi, focusApi, nativeTabApi, blocklistApi, messagesApi, backupApi, limitsApi] = await Promise.all([
  import("../src/lib/start-page-settings.js"),
  import("../src/lib/start-page-runtime.js"),
  import("../src/lib/focus-stats.js"),
  import("../src/lib/native-new-tab.js"),
  import("../src/lib/blocklist.js"),
  import("../src/lib/messages.js"),
  import("../src/lib/backup.js"),
  import("../src/lib/platform-limits.js"),
]);


const maximumSites = Array.from({ length: limitsApi.MAX_BLOCKED_SITES }, (_, index) => `site-${index}.example`);
const tooManySites = [...maximumSites, "overflow.example"];
assert.doesNotThrow(() => blocklistApi.assertBlockedSiteCapacity(maximumSites));
assert.throws(
  () => blocklistApi.assertBlockedSiteCapacity(tooManySites),
  /at most 5000 blocked sites/,
  "The persisted blocklist must reject redirect-rule counts above Chrome's unsafe dynamic-rule quota",
);
assert.equal(messagesApi.isMessage({ type: "replace-blocked-sites", sites: maximumSites }), true);
assert.equal(messagesApi.isMessage({ type: "replace-blocked-sites", sites: tooManySites }), false);
assert.throws(
  () => backupApi.migrateBackup({
    app: "Start Tab",
    version: 4,
    exportedAt: new Date().toISOString(),
    snapshotId: "round16-overflow",
    storage: { blockedSites: tooManySites },
  }),
  /at most 5000 blocked sites/,
  "Oversized blocklists must fail before backup import changes local storage or DNR rules",
);

const settings = await settingsApi.getStartPageSettings();
const timer = settings.layout.blocks.find((block) => block.type === "timer");
const pomodoro = settings.layout.blocks.find((block) => block.type === "pomodoro");
const note = settings.layout.blocks.find((block) => block.type === "note");
assert.ok(timer && pomodoro && note, "Default settings must contain Timer, Pomodoro, and Note blocks");

const now = Date.now();
const runtime = await runtimeApi.getStartPageRuntimeState(settings);
runtime.notes[note.id] = "preserve unrelated runtime";
runtime.clocks[timer.id] = {
  ...runtimeApi.defaultClockForBlock(timer),
  running: true,
  startedAt: now - 5_000,
  accumulatedMs: 0,
  targetAt: now + 55_000,
  completionToken: "round16-timer",
};
runtime.clocks[pomodoro.id] = {
  ...runtimeApi.defaultClockForBlock(pomodoro),
  running: true,
  startedAt: now - 15_000,
  accumulatedMs: 0,
  targetAt: now + 45_000,
  completionToken: "round16-pomodoro",
  phase: "work",
  focusSessionStartedAt: now - 15_000,
};
await runtimeApi.setStartPageRuntimeState(runtime);
const timerAlarm = runtimeApi.clockAlarmName(timer.id, "round16-timer");
const pomodoroAlarm = runtimeApi.clockAlarmName(pomodoro.id, "round16-pomodoro");
alarmState.set(timerAlarm, { name: timerAlarm, scheduledTime: now + 55_000 });
alarmState.set(pomodoroAlarm, { name: pomodoroAlarm, scheduledTime: now + 45_000 });

const beforeFailureStorage = structuredClone(localState);
const beforeFailureAlarms = structuredClone([...alarmState.values()]);
failClearName = pomodoroAlarm;
await assert.rejects(
  () => runtimeApi.resetAllClockRuntimeWithAlarms(now),
  /forced alarm clear rejection/,
  "A partial alarm-clear failure must reject the complete reset-all transaction",
);
assert.deepEqual(localState, beforeFailureStorage, "Failed reset-all must restore exact runtime and revision storage");
assert.deepEqual([...alarmState.values()], beforeFailureAlarms, "Failed reset-all must restore the exact complete alarm set");

const interrupted = await runtimeApi.resetAllClockRuntimeWithAlarms(now);
assert.deepEqual(interrupted, [15_000], "Reset-all must report every interrupted active Pomodoro work session");
const resetRuntime = await runtimeApi.getStartPageRuntimeState(settings);
assert.equal(resetRuntime.notes[note.id], "preserve unrelated runtime", "Reset-all must preserve unrelated per-instance runtime");
assert.equal(resetRuntime.clocks[timer.id]?.running, false);
assert.equal(resetRuntime.clocks[timer.id]?.accumulatedMs, 0);
assert.equal(resetRuntime.clocks[pomodoro.id]?.running, false);
assert.equal(resetRuntime.clocks[pomodoro.id]?.phase, "work");
assert.equal(resetRuntime.clocks[pomodoro.id]?.accumulatedMs, 0);
assert.deepEqual([...alarmState.values()], [], "Successful reset-all must clear every durable clock alarm");

await focusApi.resetFocusStats();
await focusApi.recordFocusSessionsInterrupted([1_000, 2_000, Number.NaN, 0]);
const focusStats = await focusApi.getFocusStats();
assert.equal(focusStats.totals.focusSessionsInterrupted, 2, "Batch interruption accounting must count each valid session once");
assert.equal(focusStats.totals.focusTimeMs, 3_000, "Batch interruption accounting must sum valid focus durations atomically");

rejectNativeUpdates = true;
consumeBypassOnUpdate = false;
const failedTabId = nextTabId + 1;
await assert.rejects(
  () => nativeTabApi.openNativeNewTab({ consumptionTimeoutMs: 1, pollIntervalMs: 1 }),
  /rejected every native new-tab URL/,
  "Rejected browser-native URLs must surface a failure",
);
assert.deepEqual(updatedUrls.slice(-3), [
  "chrome://new-tab-page/",
  "chrome-search://local-ntp/local-ntp.html",
  "about:newtab",
]);
assert.equal(removedTabs.includes(failedTabId), true, "A failed native-new-tab attempt must close its temporary about:blank tab");
assert.equal(localState.startTabNativeNewTabBypass, undefined, "A failed native-new-tab attempt must remove its owned bypass marker");

rejectNativeUpdates = false;
consumeBypassOnUpdate = true;
const successfulTabId = nextTabId + 1;
await nativeTabApi.openNativeNewTab({ consumptionTimeoutMs: 5, pollIntervalMs: 1 });
assert.equal(removedTabs.includes(successfulTabId), false, "A successfully opened native tab must remain open");
assert.equal(updatedUrls.at(-1), "chrome://new-tab-page/", "Successful bypass consumption must stop trying fallback URLs");

console.log("Round 16 fixtures passed");
