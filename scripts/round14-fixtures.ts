import assert from "node:assert/strict";
import { runIndependentEffects } from "../src/lib/independent-effects.js";
import { recoverRuntimeMutation } from "../src/newtab/runtime-mutation-recovery.js";

const localState: Record<string, unknown> = {};
interface AlarmState { name: string; scheduledTime: number; periodInMinutes?: number }
const alarmState = new Map<string, AlarmState>();
let failNextAlarmCreate = false;

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
    async clear(name: string): Promise<boolean> { return alarmState.delete(name); },
    async create(name: string, info: chrome.alarms.AlarmCreateInfo): Promise<void> {
      if (failNextAlarmCreate) {
        failNextAlarmCreate = false;
        throw new Error(`forced asynchronous alarm rejection for ${name}`);
      }
      const scheduledTime = typeof info.when === "number"
        ? info.when
        : Date.now() + Math.max(0, info.delayInMinutes ?? 0) * 60_000;
      alarmState.set(name, { name, scheduledTime, ...(typeof info.periodInMinutes === "number" ? { periodInMinutes: info.periodInMinutes } : {}) });
    },
  },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const [settingsApi, runtimeApi] = await Promise.all([
  import("../src/lib/start-page-settings.js"),
  import("../src/lib/start-page-runtime.js"),
]);

const settings = await settingsApi.getStartPageSettings();
const timer = settings.layout.blocks.find((block) => block.type === "timer");
const pomodoro = settings.layout.blocks.find((block) => block.type === "pomodoro");
assert.ok(timer && pomodoro);

const baselineRuntime = await runtimeApi.getStartPageRuntimeState(settings);
await runtimeApi.setStartPageRuntimeState(baselineRuntime);
const storageBeforeAction = structuredClone(localState);
const alarmsBeforeAction = structuredClone([...alarmState.values()]);
failNextAlarmCreate = true;
await assert.rejects(
  () => runtimeApi.mutateStartPageRuntimeStateWithAlarms((runtime) => {
    runtime.clocks[timer.id] = runtimeApi.startClockState(runtime.clocks[timer.id] ?? runtimeApi.defaultClockForBlock(timer), Date.now());
    return { state: runtime, result: undefined };
  }),
  /forced asynchronous alarm rejection/,
  "A rejected alarm Promise must reject the clock transaction",
);
assert.deepEqual(localState, storageBeforeAction, "Rejected clock actions must restore exact runtime and revision storage");
assert.deepEqual([...alarmState.values()], alarmsBeforeAction, "Rejected clock actions must restore the exact prior alarm set");

const nextSettings = settingsApi.cloneSettings(await settingsApi.getStartPageSettings());
const nextPomodoro = nextSettings.layout.blocks.find((block) => block.id === pomodoro.id && block.type === "pomodoro");
assert.ok(nextPomodoro);
nextPomodoro.config.autoStartNextPhase = true;
await settingsApi.setStartPageSettings(nextSettings);
const dueRuntime = await runtimeApi.getStartPageRuntimeState(nextSettings);
const now = Date.now();
const token = "round14-completion-token";
dueRuntime.clocks[pomodoro.id] = {
  ...runtimeApi.defaultClockForBlock(nextPomodoro),
  running: true,
  startedAt: now - nextPomodoro.config.workSeconds * 1000,
  targetAt: now,
  focusSessionStartedAt: now - nextPomodoro.config.workSeconds * 1000,
  completionToken: token,
};
await runtimeApi.setStartPageRuntimeState(dueRuntime);
alarmState.set(runtimeApi.clockAlarmName(pomodoro.id, token), {
  name: runtimeApi.clockAlarmName(pomodoro.id, token),
  scheduledTime: now,
});
const storageBeforeCompletion = structuredClone(localState);
const alarmsBeforeCompletion = structuredClone([...alarmState.values()]);
failNextAlarmCreate = true;
await assert.rejects(
  () => runtimeApi.completeClockInstance(pomodoro.id, token, now),
  /forced asynchronous alarm rejection/,
  "An auto-start completion must reject when its next durable alarm cannot be created",
);
assert.deepEqual(localState, storageBeforeCompletion, "Rejected completion must restore exact runtime and revision storage");
assert.deepEqual([...alarmState.values()], alarmsBeforeCompletion, "Rejected completion must restore the exact prior alarm set");

const effectEvents: string[] = [];
const effectError = new Error("statistics failed");
await assert.rejects(
  () => runIndependentEffects([
    async () => { effectEvents.push("statistics"); throw effectError; },
    async () => { effectEvents.push("notification"); },
  ], "secondary effects failed"),
  (error: unknown) => error === effectError,
);
assert.deepEqual(effectEvents, ["statistics", "notification"], "One secondary failure must not skip the next completion effect");

const mutationError = new Error("mutation failed");
const recoveredEvents: string[] = [];
await assert.rejects(
  () => recoverRuntimeMutation(mutationError, {
    refresh: async () => { recoveredEvents.push("refresh"); },
    announceConflict: () => { recoveredEvents.push("announce"); },
    queueRender: () => { recoveredEvents.push("render"); },
    queueRefresh: () => { recoveredEvents.push("refresh-queue"); },
  }),
  (error: unknown) => error === mutationError,
);
assert.deepEqual(recoveredEvents, ["refresh", "announce", "render"]);

const recoveryError = new Error("refresh failed");
const failedRecoveryEvents: string[] = [];
await assert.rejects(
  () => recoverRuntimeMutation(mutationError, {
    refresh: async () => { failedRecoveryEvents.push("refresh"); throw recoveryError; },
    announceConflict: () => { failedRecoveryEvents.push("announce"); },
    queueRender: () => { failedRecoveryEvents.push("render"); },
    queueRefresh: () => { failedRecoveryEvents.push("refresh-queue"); },
  }),
  (error: unknown) => error instanceof AggregateError
    && error.errors[0] === mutationError
    && error.errors[1] === recoveryError,
);
assert.deepEqual(failedRecoveryEvents, ["refresh", "announce", "refresh-queue"]);

console.log("Round 14 fixtures passed");
