import assert from "node:assert/strict";

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
        throw new Error(`forced layout alarm rejection for ${name}`);
      }
      const scheduledTime = typeof info.when === "number"
        ? info.when
        : Date.now() + Math.max(0, info.delayInMinutes ?? 0) * 60_000;
      alarmState.set(name, { name, scheduledTime, ...(typeof info.periodInMinutes === "number" ? { periodInMinutes: info.periodInMinutes } : {}) });
    },
  },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const [settingsApi, runtimeApi, messagesApi] = await Promise.all([
  import("../src/lib/start-page-settings.js"),
  import("../src/lib/start-page-runtime.js"),
  import("../src/lib/messages.js"),
]);

const initial = await settingsApi.getStartPageSettings();
const timer = initial.layout.blocks.find((block) => block.type === "timer");
const note = initial.layout.blocks.find((block) => block.type === "note");
const links = initial.layout.blocks.find((block) => block.type === "links");
assert.ok(timer && note && links);
const initialRuntime = await runtimeApi.getStartPageRuntimeState(initial);
assert.equal(
  settingsApi.layoutReplacementRemovesUserData(initial, settingsApi.settingsWithLayoutPreset(initial, "focus"), initialRuntime),
  false,
  "Fresh built-in block defaults must not trigger a destructive-data warning during onboarding",
);

const customized = settingsApi.cloneSettings(initial);
const customizedTimer = customized.layout.blocks.find((block) => block.id === timer.id && block.type === "timer");
assert.ok(customizedTimer);
customizedTimer.config.durationSeconds = 777;
await settingsApi.setStartPageSettings(customized);
const current = await settingsApi.getStartPageSettings();
const restCandidate = settingsApi.settingsWithLayoutPreset(current, "rest");
assert.equal(
  settingsApi.layoutReplacementRemovesUserData(current, settingsApi.settingsWithLayoutPreset(current, "minimal"), initialRuntime),
  true,
  "Removing a customized block through a preset must require confirmation",
);
const reusedTimer = restCandidate.layout.blocks.find((block) => block.type === "timer");
const reusedLinks = restCandidate.layout.blocks.find((block) => block.type === "links");
assert.equal(reusedTimer?.id, timer.id, "Presets must preserve the first existing Timer instance id");
assert.equal(reusedLinks?.id, links.id, "Presets must preserve retained per-instance data identities");
assert.equal(reusedTimer?.type === "timer" ? reusedTimer.config.durationSeconds : 0, 777, "Presets must preserve retained block configuration");
assert.equal(restCandidate.layout.blocks.some((block) => block.id === note.id), false, "Blocks absent from a preset must be removed from its layout");

const runtime = await runtimeApi.getStartPageRuntimeState(current);
const now = Date.now();
const token = "round15-running-timer";
runtime.notes[note.id] = "orphan me only after a successful layout commit";
runtime.linkPages[links.id] = 3;
runtime.clocks[timer.id] = {
  ...runtimeApi.defaultClockForBlock(timer),
  running: true,
  startedAt: now,
  targetAt: now + 60_000,
  completionToken: token,
};
await runtimeApi.setStartPageRuntimeState(runtime);
const persistedRuntime = await runtimeApi.getStartPageRuntimeState(current);
alarmState.set(runtimeApi.clockAlarmName(timer.id, token), {
  name: runtimeApi.clockAlarmName(timer.id, token),
  scheduledTime: now + 60_000,
});

const beforeFailureStorage = structuredClone(localState);
const beforeFailureAlarms = structuredClone([...alarmState.values()]);
failNextAlarmCreate = true;
await assert.rejects(
  () => runtimeApi.replaceStartPageSettingsWithRuntime(restCandidate, current.updatedAt, persistedRuntime.updatedAt),
  /forced layout alarm rejection/,
  "A rejected durable alarm must reject the complete layout transaction",
);
assert.deepEqual(localState, beforeFailureStorage, "Failed layout replacement must restore exact settings/runtime/revision storage");
assert.deepEqual([...alarmState.values()], beforeFailureAlarms, "Failed layout replacement must restore the exact prior alarm set");

const committed = await runtimeApi.replaceStartPageSettingsWithRuntime(restCandidate, current.updatedAt, persistedRuntime.updatedAt);
assert.equal(committed.layout.profile, "rest");
const committedRuntime = await runtimeApi.getStartPageRuntimeState(committed);
assert.equal(committedRuntime.notes[note.id], undefined, "Successful layout replacement must remove orphan note runtime");
assert.equal(committedRuntime.linkPages[links.id], 3, "Retained block runtime must survive a preset layout change");
assert.equal(committedRuntime.clocks[timer.id]?.running, true, "A retained running timer must survive a preset layout change");
assert.equal(alarmState.has(runtimeApi.clockAlarmName(timer.id, token)), true, "A retained running timer must keep a durable alarm");

const beforeStaleStorage = structuredClone(localState);
const beforeStaleAlarms = structuredClone([...alarmState.values()]);
await assert.rejects(
  () => runtimeApi.replaceStartPageSettingsWithRuntime(
    settingsApi.settingsWithLayoutPreset(committed, "minimal"),
    current.updatedAt,
    committedRuntime.updatedAt,
  ),
  /changed in another extension context/,
  "Stale layout snapshots must not replace newer settings",
);
assert.deepEqual(localState, beforeStaleStorage);
assert.deepEqual([...alarmState.values()], beforeStaleAlarms);

const minimalCandidate = settingsApi.settingsWithLayoutPreset(committed, "minimal");
const staleRuntimeUpdatedAt = committedRuntime.updatedAt;
await runtimeApi.mutateStartPageRuntimeStateWithAlarms((state) => {
  state.linkPages[links.id] = 4;
  return { state, result: undefined };
});
const concurrentRuntime = await runtimeApi.getStartPageRuntimeState(committed);
assert.ok(concurrentRuntime.updatedAt > staleRuntimeUpdatedAt);
const beforeRuntimeConflictStorage = structuredClone(localState);
const beforeRuntimeConflictAlarms = structuredClone([...alarmState.values()]);
await assert.rejects(
  () => runtimeApi.replaceStartPageSettingsWithRuntime(
    minimalCandidate,
    committed.updatedAt,
    staleRuntimeUpdatedAt,
  ),
  /runtime changed in another extension context/,
  "A destructive layout must reject when runtime changed after the UI confirmation snapshot",
);
assert.deepEqual(localState, beforeRuntimeConflictStorage, "Runtime conflicts must not change settings, runtime, or revision storage");
assert.deepEqual([...alarmState.values()], beforeRuntimeConflictAlarms, "Runtime conflicts must not change alarms");

const minimal = await runtimeApi.replaceStartPageSettingsWithRuntime(
  minimalCandidate,
  committed.updatedAt,
  concurrentRuntime.updatedAt,
);
const minimalRuntime = await runtimeApi.getStartPageRuntimeState(minimal);
assert.equal(minimalRuntime.clocks[timer.id], undefined, "Removing a clock block must remove its runtime");
assert.equal(alarmState.has(runtimeApi.clockAlarmName(timer.id, token)), false, "Removing a clock block must remove its durable alarm");

assert.equal(messagesApi.isMessage({
  type: "replace-start-page-settings",
  settings: minimalCandidate,
  expectedSettingsUpdatedAt: committed.updatedAt,
  expectedRuntimeUpdatedAt: concurrentRuntime.updatedAt,
}), true);
assert.equal(messagesApi.isMessage({
  type: "replace-start-page-settings",
  settings: { layout: { blocks: [] }, themes: { customThemes: [] } },
  expectedSettingsUpdatedAt: -1,
  expectedRuntimeUpdatedAt: 0,
}), false);
assert.equal(messagesApi.isMessage({
  type: "replace-start-page-settings",
  settings: { layout: { blocks: new Array(1001).fill({}) }, themes: { customThemes: [] } },
  expectedSettingsUpdatedAt: 0,
  expectedRuntimeUpdatedAt: 0,
}), false);

assert.equal(messagesApi.isMessage({
  type: "replace-start-page-settings",
  settings: { layout: { blocks: [] }, themes: { customThemes: [] } },
  expectedSettingsUpdatedAt: 0,
}), false);

console.log("Round 15 fixtures passed");
