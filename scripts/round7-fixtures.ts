import assert from "node:assert/strict";

interface StorageAreaState { [key: string]: unknown }
type ChangeListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void;
type MessageListener = (message: unknown, sender: unknown, sendResponse: (response: { ok: boolean; error?: string }) => void) => boolean | void;

const localState: StorageAreaState = {};
const syncState: StorageAreaState = {};
const listeners = new Set<ChangeListener>();
const messageListeners: MessageListener[] = [];
interface AlarmState { name: string; scheduledTime: number; periodInMinutes?: number }
const alarmState = new Map<string, AlarmState>();
function setAlarm(name: string, scheduledTime = Date.now() + 60_000, periodInMinutes?: number): void {
  alarmState.set(name, { name, scheduledTime, ...(typeof periodInMinutes === "number" ? { periodInMinutes } : {}) });
}
let dynamicRules: chrome.declarativeNetRequest.Rule[] = [];
let failNextDnrUpdate = false;
let failSetAfterApplyForKey: string | null = null;
let failAlarmCreateAfterApplyForName: string | null = null;

const lockTails = new Map<string, Promise<void>>();
const lockManager = {
  async request<T>(name: string, _options: unknown, callback: () => Promise<T>): Promise<T> {
    const previous = lockTails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    lockTails.set(name, tail);
    await previous.catch(() => undefined);
    try { return await callback(); } finally {
      release();
      if (lockTails.get(name) === tail) lockTails.delete(name);
    }
  },
};
Object.defineProperty(globalThis, "navigator", { value: { locks: lockManager }, configurable: true });

function requestedKeys(keys?: string | string[] | Record<string, unknown> | null): string[] {
  if (keys == null) return [];
  if (typeof keys === "string") return [keys];
  if (Array.isArray(keys)) return keys;
  return Object.keys(keys);
}

function storageArea(state: StorageAreaState, areaName: "local" | "sync") {
  return {
    async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
      if (keys == null) return structuredClone(state);
      const output: Record<string, unknown> = {};
      for (const key of requestedKeys(keys)) {
        if (Object.prototype.hasOwnProperty.call(state, key)) output[key] = structuredClone(state[key]);
        else if (typeof keys === "object" && !Array.isArray(keys) && keys !== null) output[key] = structuredClone(keys[key]);
      }
      return output;
    },
    async set(items: Record<string, unknown>): Promise<void> {
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const [key, value] of Object.entries(items)) {
        assert.notEqual(value, undefined, `storage.set must not receive undefined for ${key}`);
        changes[key] = { oldValue: structuredClone(state[key]), newValue: structuredClone(value) };
        state[key] = structuredClone(value);
      }
      for (const listener of listeners) listener(changes, areaName);
      if (areaName === "local" && failSetAfterApplyForKey && Object.prototype.hasOwnProperty.call(items, failSetAfterApplyForKey)) {
        const key = failSetAfterApplyForKey;
        failSetAfterApplyForKey = null;
        throw new Error(`forced storage failure after writing ${key}`);
      }
    },
    async remove(keys: string | string[]): Promise<void> {
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (!Object.prototype.hasOwnProperty.call(state, key)) continue;
        changes[key] = { oldValue: structuredClone(state[key]), newValue: undefined };
        delete state[key];
      }
      for (const listener of listeners) listener(changes, areaName);
    },
    async clear(): Promise<void> { await this.remove(Object.keys(state)); },
  };
}

function eventTarget() { return { addListener(): void {} }; }

const chromeMock = {
  storage: {
    local: storageArea(localState, "local"), sync: storageArea(syncState, "sync"),
    onChanged: { addListener(listener: ChangeListener): void { listeners.add(listener); }, removeListener(listener: ChangeListener): void { listeners.delete(listener); } },
  },
  alarms: {
    onAlarm: eventTarget(),
    async getAll(): Promise<AlarmState[]> { return structuredClone([...alarmState.values()]); },
    async clear(name: string): Promise<boolean> { return alarmState.delete(name); },
    create(name: string, info: chrome.alarms.AlarmCreateInfo): void {
      const scheduledTime = typeof info.when === "number" ? info.when : Date.now() + Math.max(0, info.delayInMinutes ?? 0) * 60_000;
      setAlarm(name, scheduledTime, info.periodInMinutes);
      if (failAlarmCreateAfterApplyForName === name) { failAlarmCreateAfterApplyForName = null; throw new Error(`forced alarm failure after creating ${name}`); }
    },
  },
  declarativeNetRequest: {
    async getDynamicRules(): Promise<chrome.declarativeNetRequest.Rule[]> { return structuredClone(dynamicRules); },
    async updateDynamicRules(update: { removeRuleIds?: number[]; addRules?: chrome.declarativeNetRequest.Rule[] }): Promise<void> {
      if (failNextDnrUpdate) { failNextDnrUpdate = false; throw new Error("forced DNR failure"); }
      const removals = new Set(update.removeRuleIds ?? []);
      dynamicRules = dynamicRules.filter((rule) => !removals.has(rule.id));
      dynamicRules.push(...structuredClone(update.addRules ?? []));
    },
    RuleActionType: { REDIRECT: "redirect" }, ResourceType: { MAIN_FRAME: "main_frame" },
  },
  runtime: {
    onInstalled: eventTarget(), onStartup: eventTarget(),
    onMessage: { addListener(listener: MessageListener): void { messageListeners.push(listener); } },
    getURL(path: string): string { return `chrome-extension://fixture/${path}`; },
    getManifest(): chrome.runtime.Manifest { return { manifest_version: 3, name: "fixture", version: "3.0.0", chrome_url_overrides: { newtab: "newtab.html" } }; },
  },
  tabs: {
    onCreated: eventTarget(), onUpdated: eventTarget(),
    async create(): Promise<chrome.tabs.Tab> { return { id: 99, index: 0, pinned: false, highlighted: false, active: true, incognito: false, selected: true, discarded: false, autoDiscardable: true, groupId: -1, windowId: 1 }; },
    async update(): Promise<chrome.tabs.Tab> { return { id: 99, index: 0, pinned: false, highlighted: false, active: true, incognito: false, selected: true, discarded: false, autoDiscardable: true, groupId: -1, windowId: 1 }; },
  },
  webNavigation: { onBeforeNavigate: eventTarget() },
  notifications: { async create(): Promise<string> { return "notification"; } },
  i18n: { getMessage(key: string): string { return key; } },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const [settingsApi, runtimeApi, backupApi, blocklistApi, revisionApi] = await Promise.all([
  import("../src/lib/start-page-settings.js"), import("../src/lib/start-page-runtime.js"), import("../src/lib/backup.js"), import("../src/lib/blocklist.js"), import("../src/lib/data-revision.js"),
]);
await import("../src/service-worker.js");

async function workerMessage(message: unknown): Promise<{ ok: boolean; error?: string }> {
  assert.equal(messageListeners.length, 1, "Exactly one service-worker message listener must be registered");
  return new Promise((resolve, reject) => {
    const keepAlive = messageListeners[0](message, {}, resolve);
    if (keepAlive !== true) reject(new Error("Service worker did not keep the response channel open"));
  });
}

const baseSettings = await settingsApi.getStartPageSettings();
const settingsA = settingsApi.cloneSettings(baseSettings);
const settingsB = settingsApi.cloneSettings(baseSettings);
settingsA.layout.gap = 17; settingsB.layout.gap = 29;
const settingsResults = await Promise.allSettled([settingsApi.setStartPageSettings(settingsA), settingsApi.setStartPageSettings(settingsB)]);
assert.equal(settingsResults.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(settingsResults.filter((result) => result.status === "rejected").length, 1);
const persistedSettings = await settingsApi.getStartPageSettings();
assert.ok(persistedSettings.layout.gap === 17 || persistedSettings.layout.gap === 29);
const zeroTimestampSettings = settingsApi.cloneSettings(persistedSettings); zeroTimestampSettings.updatedAt = 0;
await assert.rejects(() => settingsApi.setStartPageSettings(zeroTimestampSettings), /changed in another extension context/);

const baseRuntime = await runtimeApi.getStartPageRuntimeState(persistedSettings);
const runtimeA = structuredClone(baseRuntime); const runtimeB = structuredClone(baseRuntime);
runtimeA.notes.fixture = "A"; runtimeB.notes.fixture = "B";
const runtimeResults = await Promise.allSettled([runtimeApi.setStartPageRuntimeState(runtimeA), runtimeApi.setStartPageRuntimeState(runtimeB)]);
assert.equal(runtimeResults.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(runtimeResults.filter((result) => result.status === "rejected").length, 1);
const currentRuntime = await runtimeApi.getStartPageRuntimeState();
const zeroTimestampRuntime = structuredClone(currentRuntime); zeroTimestampRuntime.updatedAt = 0;
await assert.rejects(() => runtimeApi.setStartPageRuntimeState(zeroTimestampRuntime), /changed in another extension context/);

const originalNow = Date.now; Date.now = () => 5_000;
const revisionBefore = await revisionApi.readStartTabDataRevision();
const revisions = await Promise.all(Array.from({ length: 12 }, () => revisionApi.markStartTabDataChanged()));
Date.now = originalNow;
assert.equal(new Set(revisions).size, revisions.length);
assert.ok(Math.min(...revisions) > revisionBefore);

const noteBlock = persistedSettings.layout.blocks.find((block) => block.type === "note");
const tasksBlock = persistedSettings.layout.blocks.find((block) => block.type === "localTasks");
const linksBlock = persistedSettings.layout.blocks.find((block) => block.type === "links");
assert.ok(noteBlock && tasksBlock && linksBlock);
assert.deepEqual(await workerMessage({ type: "runtime-note", instanceId: noteBlock.id, value: "first", expectedValue: "" }), { ok: true });
const staleNoteAck = await workerMessage({ type: "runtime-note", instanceId: noteBlock.id, value: "stale", expectedValue: "" });
assert.equal(staleNoteAck.ok, false);
assert.equal((await runtimeApi.getStartPageRuntimeState()).notes[noteBlock.id], "first");
const task = { id: "task-1", title: "Keep", done: false, createdAt: 1, updatedAt: 1 };
assert.deepEqual(await workerMessage({ type: "runtime-tasks", instanceId: tasksBlock.id, tasks: [task], expectedTasks: [] }), { ok: true });
const staleTasksAck = await workerMessage({ type: "runtime-tasks", instanceId: tasksBlock.id, tasks: [], expectedTasks: [] });
assert.equal(staleTasksAck.ok, false);
assert.equal((await runtimeApi.getStartPageRuntimeState()).tasks[tasksBlock.id]?.[0]?.title, "Keep");
assert.deepEqual(await workerMessage({ type: "runtime-link-page", instanceId: linksBlock.id, page: 1, expectedPage: 0 }), { ok: true });
const stalePageAck = await workerMessage({ type: "runtime-link-page", instanceId: linksBlock.id, page: 2, expectedPage: 0 });
assert.equal(stalePageAck.ok, false);
assert.equal((await runtimeApi.getStartPageRuntimeState()).linkPages[linksBlock.id], 1);

await blocklistApi.replaceBlockedSites(["original.example"]);
const rulesBeforeFailure = structuredClone(dynamicRules);
const revisionBeforeFailure = await revisionApi.readStartTabDataRevision();
failNextDnrUpdate = true;
await assert.rejects(() => blocklistApi.blockHost("new.example"), /forced DNR failure/);
assert.deepEqual(localState.blockedSites, ["original.example"]);
assert.deepEqual(dynamicRules, rulesBeforeFailure);
assert.equal(await revisionApi.readStartTabDataRevision(), revisionBeforeFailure);
const blocklistBeforeRevisionFailure = structuredClone(localState);
const rulesBeforeRevisionFailure = structuredClone(dynamicRules);
failSetAfterApplyForKey = revisionApi.DATA_REVISION_KEY;
await assert.rejects(() => blocklistApi.blockHost("revision-failure.example"), /forced storage failure/);
assert.deepEqual(localState, blocklistBeforeRevisionFailure, "Blocklist rollback must restore the exact data revision after a revision write failure");
assert.deepEqual(dynamicRules, rulesBeforeRevisionFailure, "Blocklist rollback must restore DNR after a revision write failure");

const currentSettingsForBackup = await settingsApi.getStartPageSettings();
const currentTasksBlock = currentSettingsForBackup.layout.blocks.find((block) => block.type === "localTasks");
assert.ok(currentTasksBlock);
delete localState.startPageRuntimeState;
localState.startTabInstanceState = { localTasks: { [currentTasksBlock.id]: [{ id: "legacy-task", title: "Legacy task", done: false, createdAt: 2, updatedAt: 2 }] } };
const exported = await backupApi.exportBackup();
const exportedRuntime = exported.storage.startPageRuntimeState as { tasks: Record<string, Array<{ title: string }>> };
assert.equal(exportedRuntime.tasks[currentTasksBlock.id]?.[0]?.title, "Legacy task");
await backupApi.importBackup(exported);
assert.equal(Object.prototype.hasOwnProperty.call(localState, "startTabInstanceState"), false);

const activeClockBackup = structuredClone(await backupApi.exportBackup());
const activeClockSettings = activeClockBackup.storage.startPageSettings as typeof persistedSettings;
const activeClockTimer = activeClockSettings.layout.blocks.find((block) => block.type === "timer");
assert.ok(activeClockTimer);
const activeClockRuntime = activeClockBackup.storage.startPageRuntimeState as Awaited<ReturnType<typeof runtimeApi.getStartPageRuntimeState>>;
const activeClockNow = Date.now();
activeClockRuntime.clocks[activeClockTimer.id] = { ...runtimeApi.defaultClockForBlock(activeClockTimer), running: true, startedAt: activeClockNow, targetAt: activeClockNow + 90_000, completionToken: "imported-active-token" };
setAlarm(`${runtimeApi.CLOCK_ALARM_PREFIX}stale-before-import`, activeClockNow + 10_000);
await backupApi.importBackup(activeClockBackup);
const importedAlarmName = runtimeApi.clockAlarmName(activeClockTimer.id, "imported-active-token");
assert.equal(alarmState.has(importedAlarmName), true, "Backup import must schedule durable alarms for active countdowns");
assert.equal(alarmState.has(`${runtimeApi.CLOCK_ALARM_PREFIX}stale-before-import`), false, "Backup import must remove stale pre-import clock alarms");

const exactBeforeFailure = structuredClone(localState);
localState.startTabPreImportBackup = { old: "recovery" };
const oldRecovery = structuredClone(localState.startTabPreImportBackup);
const failingBackup = structuredClone(await backupApi.exportBackup()); failingBackup.storage.blockedSites = ["replacement.example"];
failNextDnrUpdate = true;
await assert.rejects(() => backupApi.importBackup(failingBackup), /forced DNR failure/);
for (const key of Object.keys(exactBeforeFailure)) { if (key === "startTabPreImportBackup") continue; assert.deepEqual(localState[key], exactBeforeFailure[key], `Rollback must restore ${key}`); }
assert.deepEqual(localState.startTabPreImportBackup, oldRecovery, "Rollback must preserve the prior recovery backup");

const stateBeforeAlarmFailure = structuredClone(localState);
const rulesBeforeAlarmFailure = structuredClone(dynamicRules);
const alarmsBeforeAlarmFailure = structuredClone([...alarmState.values()].sort((left, right) => left.name.localeCompare(right.name)));
const alarmFailingBackup = structuredClone(await backupApi.exportBackup());
const alarmFailingRuntime = alarmFailingBackup.storage.startPageRuntimeState as Awaited<ReturnType<typeof runtimeApi.getStartPageRuntimeState>>;
const alarmFailureToken = "alarm-failure-token";
alarmFailingRuntime.clocks[activeClockTimer.id] = { ...runtimeApi.defaultClockForBlock(activeClockTimer), running: true, startedAt: activeClockNow, targetAt: activeClockNow + 180_000, completionToken: alarmFailureToken };
const alarmFailureName = runtimeApi.clockAlarmName(activeClockTimer.id, alarmFailureToken);
failAlarmCreateAfterApplyForName = alarmFailureName;
await assert.rejects(() => backupApi.importBackup(alarmFailingBackup), /forced alarm failure/);
assert.deepEqual(localState, stateBeforeAlarmFailure, "Alarm reconciliation failure must roll imported storage back exactly");
assert.deepEqual(dynamicRules, rulesBeforeAlarmFailure, "Alarm reconciliation failure must restore DNR rules");
assert.deepEqual([...alarmState.values()].sort((left, right) => left.name.localeCompare(right.name)), alarmsBeforeAlarmFailure, "Alarm reconciliation failure must restore exact prior alarms");

const stateBeforeRevisionImportFailure = structuredClone(localState);
const rulesBeforeRevisionImportFailure = structuredClone(dynamicRules);
const alarmsBeforeRevisionImportFailure = structuredClone([...alarmState.values()].sort((left, right) => left.name.localeCompare(right.name)));
const revisionFailingBackup = structuredClone(await backupApi.exportBackup()); revisionFailingBackup.storage.blockedSites = ["revision-import.example"];
failSetAfterApplyForKey = revisionApi.DATA_REVISION_KEY;
await assert.rejects(() => backupApi.importBackup(revisionFailingBackup), /forced storage failure/);
assert.deepEqual(localState, stateBeforeRevisionImportFailure, "Backup rollback must restore the exact data revision after a revision write failure");
assert.deepEqual(dynamicRules, rulesBeforeRevisionImportFailure, "Backup rollback must restore DNR after a revision write failure");
assert.deepEqual([...alarmState.values()].sort((left, right) => left.name.localeCompare(right.name)), alarmsBeforeRevisionImportFailure, "Backup rollback must restore alarms after a revision write failure");

const timerBlock = persistedSettings.layout.blocks.find((block) => block.type === "timer");
assert.ok(timerBlock);
const legacyClockSource = { version: 1, updatedAt: 1, clocks: { timer: { type: "timer", running: true, startedAt: 1_000, accumulatedMs: 5_000, durationMs: 60_000, targetAt: 56_000 } }, notes: {}, tasks: {}, linkPages: {} };
const normalizedLegacyClockA = runtimeApi.normalizeRuntimeState(legacyClockSource, persistedSettings).clocks[timerBlock.id];
const normalizedLegacyClockB = runtimeApi.normalizeRuntimeState(legacyClockSource, persistedSettings).clocks[timerBlock.id];
assert.ok(normalizedLegacyClockA.completionToken?.startsWith("legacy-timer-"), "Running legacy countdowns must receive a completion token");
assert.equal(normalizedLegacyClockA.completionToken, normalizedLegacyClockB.completionToken, "Legacy completion token migration must be deterministic");

const pomodoroSettings = settingsApi.cloneSettings(await settingsApi.getStartPageSettings());
const pomodoroBlock = pomodoroSettings.layout.blocks.find((block) => block.type === "pomodoro");
assert.ok(pomodoroBlock);
pomodoroBlock.config.autoStartNextPhase = true; pomodoroBlock.config.notifyOnComplete = false;
await settingsApi.setStartPageSettings(pomodoroSettings);
const pomodoroRuntime = await runtimeApi.getStartPageRuntimeState();
const pomodoroNow = Date.now();
pomodoroRuntime.clocks[pomodoroBlock.id] = { ...runtimeApi.defaultClockForBlock(pomodoroBlock), running: true, startedAt: pomodoroNow - pomodoroBlock.config.workSeconds * 1000, targetAt: pomodoroNow, focusSessionStartedAt: pomodoroNow - pomodoroBlock.config.workSeconds * 1000, completionToken: "work-complete-token" };
await runtimeApi.setStartPageRuntimeState(pomodoroRuntime);
assert.deepEqual(await workerMessage({ type: "complete-clock", instanceId: pomodoroBlock.id, token: "work-complete-token" }), { ok: true });
const nextPomodoro = (await runtimeApi.getStartPageRuntimeState()).clocks[pomodoroBlock.id];
assert.equal(nextPomodoro.running, true); assert.equal(nextPomodoro.phase, "break");
assert.ok(nextPomodoro.completionToken && nextPomodoro.completionToken !== "work-complete-token");
assert.ok(alarmState.has(runtimeApi.clockAlarmName(pomodoroBlock.id, nextPomodoro.completionToken!)), "Auto-started Pomodoro phase must receive a durable alarm");

const scheduleRaceRuntime = await runtimeApi.getStartPageRuntimeState();
const scheduleRaceNow = Date.now();
const currentScheduleToken = "current-schedule-token";
scheduleRaceRuntime.clocks[timerBlock.id] = {
  ...runtimeApi.defaultClockForBlock(timerBlock),
  running: true,
  startedAt: scheduleRaceNow,
  targetAt: scheduleRaceNow + 75_000,
  completionToken: currentScheduleToken,
};
await runtimeApi.setStartPageRuntimeState(scheduleRaceRuntime);
const staleScheduleClock = {
  ...scheduleRaceRuntime.clocks[timerBlock.id],
  targetAt: scheduleRaceNow + 30_000,
  completionToken: "stale-schedule-token",
};
setAlarm(runtimeApi.clockAlarmName(timerBlock.id, "stale-schedule-token"), scheduleRaceNow + 30_000);
await runtimeApi.scheduleClockAlarm(timerBlock.id, staleScheduleClock);
assert.equal(alarmState.has(runtimeApi.clockAlarmName(timerBlock.id, "stale-schedule-token")), false, "A delayed scheduling call must not preserve its stale alarm");
assert.equal(alarmState.has(runtimeApi.clockAlarmName(timerBlock.id, currentScheduleToken)), true, "A delayed scheduling call must align alarms to the current persisted clock");

const resetRuntime = await runtimeApi.getStartPageRuntimeState();
const resetNow = Date.now(); const resetToken = "reset-rollback-token";
resetRuntime.clocks[timerBlock.id] = { ...runtimeApi.defaultClockForBlock(timerBlock), running: true, startedAt: resetNow, targetAt: resetNow + 60_000, completionToken: resetToken };
await runtimeApi.setStartPageRuntimeState(resetRuntime);
const resetAlarmName = runtimeApi.clockAlarmName(timerBlock.id, resetToken);
setAlarm(resetAlarmName, resetNow + 60_000);
setAlarm(`${runtimeApi.CLOCK_ALARM_PREFIX}periodic-fixture`, resetNow + 120_000, 5);
localState.startPageOnboarding = { onboarded: true };
localState.startPageMigrationReport = { marker: "preserve-on-rollback" };
const beforeFailedReset = structuredClone(localState);
const alarmsBeforeFailedReset = structuredClone([...alarmState.values()].sort((left, right) => left.name.localeCompare(right.name)));
failSetAfterApplyForKey = "startPageSettings";
const failedResetAck = await workerMessage({ type: "reset-start-page" });
assert.equal(failedResetAck.ok, false);
assert.deepEqual(localState, beforeFailedReset, "Failed reset must restore every storage key");
assert.deepEqual([...alarmState.values()].sort((left, right) => left.name.localeCompare(right.name)), alarmsBeforeFailedReset, "Failed reset must restore exact durable clock alarm metadata");

localState.startTabInstanceState = { localTasks: {} };
const resetAck = await workerMessage({ type: "reset-start-page" });
assert.deepEqual(resetAck, { ok: true });
assert.equal(Object.prototype.hasOwnProperty.call(localState, "startPageRuntimeState"), false);
assert.equal(Object.prototype.hasOwnProperty.call(localState, "startTabInstanceState"), false);
assert.equal(Object.prototype.hasOwnProperty.call(localState, "startPageMigrationReport"), false);
assert.equal(Object.prototype.hasOwnProperty.call(localState, "startPageOnboarding"), false);
assert.equal(alarmState.size, 0);
assert.equal((await settingsApi.getStartPageSettings()).schemaVersion, settingsApi.START_PAGE_SCHEMA_VERSION);

console.log("Round 7 fixtures passed");
