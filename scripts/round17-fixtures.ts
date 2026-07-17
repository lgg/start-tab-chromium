import assert from "node:assert/strict";

const localState: Record<string, unknown> = {};
interface AlarmState { name: string; scheduledTime: number; periodInMinutes?: number }
const alarmState = new Map<string, AlarmState>();
let failNextFocusStatsWrite = false;

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
        if (failNextFocusStatsWrite && Object.prototype.hasOwnProperty.call(items, "focusStats")) {
          failNextFocusStatsWrite = false;
          throw new Error("forced focus statistics rejection");
        }
        for (const [key, value] of Object.entries(items)) localState[key] = structuredClone(value);
      },
      async remove(keys: string | string[]): Promise<void> {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete localState[key];
      },
    },
  },
  alarms: {
    async getAll(): Promise<AlarmState[]> { return structuredClone([...alarmState.values()]); },
    async clear(name: string): Promise<boolean> { return alarmState.delete(name); },
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
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const [settingsApi, runtimeApi, focusApi] = await Promise.all([
  import("../src/lib/start-page-settings.js"),
  import("../src/lib/start-page-runtime.js"),
  import("../src/lib/focus-stats.js"),
]);

const initialSettings = await settingsApi.getStartPageSettings();
const configured = settingsApi.cloneSettings(initialSettings);
const configuredPomodoro = configured.layout.blocks.find((block) => block.type === "pomodoro");
assert.ok(configuredPomodoro, "Default settings must contain a Pomodoro block");
configuredPomodoro.config.workSeconds = 60;
configuredPomodoro.config.breakSeconds = 30;
configuredPomodoro.config.autoStartNextPhase = true;
await settingsApi.setStartPageSettings(configured);
const settings = await settingsApi.getStartPageSettings();
const pomodoro = settings.layout.blocks.find((block) => block.type === "pomodoro");
const timer = settings.layout.blocks.find((block) => block.type === "timer");
assert.ok(pomodoro && timer);

await focusApi.resetFocusStats();
const delayedNow = 2_000_000;
const workStartedAt = delayedNow - 11 * 60_000;
const workTargetAt = workStartedAt + 60_000;
const workToken = "round17-delayed-work";
let runtime = await runtimeApi.getStartPageRuntimeState(settings);
runtime.clocks[pomodoro.id] = {
  ...runtimeApi.defaultClockForBlock(pomodoro),
  running: true,
  startedAt: workStartedAt,
  accumulatedMs: 0,
  targetAt: workTargetAt,
  phase: "work",
  focusSessionStartedAt: workStartedAt,
  completionToken: workToken,
};
await runtimeApi.setStartPageRuntimeState(runtime);
alarmState.set(runtimeApi.clockAlarmName(pomodoro.id, workToken), {
  name: runtimeApi.clockAlarmName(pomodoro.id, workToken),
  scheduledTime: workTargetAt,
});

const delayedCompletion = await runtimeApi.completeClockInstance(pomodoro.id, workToken, delayedNow);
assert.equal(delayedCompletion.completed, true);
assert.equal(delayedCompletion.focusTimeMs, 60_000,
  "Delayed alarm delivery must not count time after the configured Pomodoro deadline as focus time");
assert.equal(delayedCompletion.startedWork, false, "Work completion auto-starts a break, not a new work session");
let stats = await focusApi.getFocusStats();
assert.equal(stats.totals.focusSessionsCompleted, 1);
assert.equal(stats.totals.focusTimeMs, 60_000,
  "Committed focus statistics must use the deadline-capped Pomodoro duration");

const breakNow = delayedNow + 30_000;
const breakToken = "round17-break-complete";
runtime = await runtimeApi.getStartPageRuntimeState(settings);
runtime.clocks[pomodoro.id] = {
  ...runtimeApi.defaultClockForBlock(pomodoro),
  running: true,
  startedAt: breakNow - 30_000,
  accumulatedMs: 0,
  durationMs: 30_000,
  targetAt: breakNow,
  phase: "break",
  focusSessionStartedAt: null,
  completionToken: breakToken,
};
await runtimeApi.setStartPageRuntimeState(runtime);
alarmState.clear();
alarmState.set(runtimeApi.clockAlarmName(pomodoro.id, breakToken), {
  name: runtimeApi.clockAlarmName(pomodoro.id, breakToken),
  scheduledTime: breakNow,
});
const breakCompletion = await runtimeApi.completeClockInstance(pomodoro.id, breakToken, breakNow);
assert.equal(breakCompletion.completed, true);
assert.equal(breakCompletion.startedWork, true, "Auto-started break-to-work transition must be reported");
stats = await focusApi.getFocusStats();
assert.equal(stats.totals.focusSessionsStarted, 1,
  "Automatically started Pomodoro work phases must increment focusSessionsStarted exactly once");
assert.equal(stats.totals.focusSessionsCompleted, 1, "Break completion must not increment completed work sessions");

const failureNow = breakNow + 120_000;
const failureStartedAt = failureNow - 60_000;
const failureToken = "round17-atomic-failure";
runtime = await runtimeApi.getStartPageRuntimeState(settings);
runtime.clocks[pomodoro.id] = {
  ...runtimeApi.defaultClockForBlock(pomodoro),
  running: true,
  startedAt: failureStartedAt,
  accumulatedMs: 0,
  targetAt: failureNow,
  phase: "work",
  focusSessionStartedAt: failureStartedAt,
  completionToken: failureToken,
};
await runtimeApi.setStartPageRuntimeState(runtime);
alarmState.clear();
alarmState.set(runtimeApi.clockAlarmName(pomodoro.id, failureToken), {
  name: runtimeApi.clockAlarmName(pomodoro.id, failureToken),
  scheduledTime: failureNow,
});
const beforeFailureStorage = structuredClone(localState);
const beforeFailureAlarms = structuredClone([...alarmState.values()]);
failNextFocusStatsWrite = true;
await assert.rejects(
  () => runtimeApi.completeClockInstance(pomodoro.id, failureToken, failureNow),
  /forced focus statistics rejection/,
  "A focus-statistics write failure must reject the complete clock transition",
);
assert.deepEqual(localState, beforeFailureStorage,
  "Failed clock statistics must restore exact runtime, focus statistics, and data revision storage");
assert.deepEqual([...alarmState.values()], beforeFailureAlarms,
  "Failed clock statistics must restore the exact previous durable alarm set");

const resetNow = failureNow + 10 * 60_000;
runtime = await runtimeApi.getStartPageRuntimeState(settings);
runtime.clocks[pomodoro.id] = {
  ...runtimeApi.defaultClockForBlock(pomodoro),
  running: true,
  startedAt: resetNow - 11 * 60_000,
  accumulatedMs: 0,
  targetAt: resetNow - 10 * 60_000,
  phase: "work",
  focusSessionStartedAt: resetNow - 11 * 60_000,
  completionToken: "round17-overdue-reset",
};
await runtimeApi.setStartPageRuntimeState(runtime);
alarmState.clear();
const interrupted = await runtimeApi.resetAllClockRuntimeWithAlarms(resetNow);
assert.deepEqual(interrupted, [60_000],
  "Resetting an overdue Pomodoro must cap interrupted focus time at its original deadline");
stats = await focusApi.getFocusStats();
assert.equal(stats.totals.focusSessionsInterrupted, 1,
  "Reset-all must commit interruption statistics in the same transaction as clock state");
assert.equal(stats.totals.focusTimeMs, 120_000,
  "Completed and interrupted focus totals must remain deadline-capped");

const futureStats = { version: 99, preserved: "newer-extension-data" };
localState.focusStats = structuredClone(futureStats);
const timerNow = resetNow + 120_000;
const timerToken = "round17-timer-future-stats";
runtime = await runtimeApi.getStartPageRuntimeState(settings);
runtime.clocks[timer.id] = {
  ...runtimeApi.defaultClockForBlock(timer),
  running: true,
  startedAt: timerNow - timer.config.durationSeconds * 1000,
  accumulatedMs: 0,
  targetAt: timerNow,
  completionToken: timerToken,
};
await runtimeApi.setStartPageRuntimeState(runtime);
alarmState.clear();
alarmState.set(runtimeApi.clockAlarmName(timer.id, timerToken), {
  name: runtimeApi.clockAlarmName(timer.id, timerToken),
  scheduledTime: timerNow,
});
const timerCompletion = await runtimeApi.completeClockInstance(timer.id, timerToken, timerNow);
assert.equal(timerCompletion.completed, true,
  "Timer completion must remain independent of an unrelated future focus-statistics schema");
assert.deepEqual(localState.focusStats, futureStats,
  "Timer completion must not read, downgrade, or rewrite unrelated future focus statistics");

console.log("Round 17 fixtures passed");
