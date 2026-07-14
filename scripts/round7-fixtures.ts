import assert from "node:assert/strict";

interface StorageAreaState { [key: string]: unknown }
type ChangeListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void;
type MessageListener = (message: unknown, sender: unknown, sendResponse: (response: { ok: boolean; error?: string }) => void) => boolean | void;

const localState: StorageAreaState = {};
const syncState: StorageAreaState = {};
const listeners = new Set<ChangeListener>();
const messageListeners: MessageListener[] = [];
const alarmNames = new Set<string>();
let dynamicRules: chrome.declarativeNetRequest.Rule[] = [];
let failNextDnrUpdate = false;

const lockTails = new Map<string, Promise<void>>();
const lockManager = {
  async request<T>(name: string, _options: unknown, callback: () => Promise<T>): Promise<T> {
    const previous = lockTails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    lockTails.set(name, tail);
    await previous.catch(() => undefined);
    try {
      return await callback();
    } finally {
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

function eventTarget() {
  return { addListener(): void {} };
}

const chromeMock = {
  storage: {
    local: storageArea(localState, "local"),
    sync: storageArea(syncState, "sync"),
    onChanged: {
      addListener(listener: ChangeListener): void { listeners.add(listener); },
      removeListener(listener: ChangeListener): void { listeners.delete(listener); },
    },
  },
  alarms: {
    onAlarm: eventTarget(),
    async getAll(): Promise<Array<{ name: string }>> { return [...alarmNames].map((name) => ({ name })); },
    async clear(name: string): Promise<boolean> { return alarmNames.delete(name); },
    create(name: string): void { alarmNames.add(name); },
  },
  declarativeNetRequest: {
    async getDynamicRules(): Promise<chrome.declarativeNetRequest.Rule[]> { return structuredClone(dynamicRules); },
    async updateDynamicRules(update: { removeRuleIds?: number[]; addRules?: chrome.declarativeNetRequest.Rule[] }): Promise<void> {
      if (failNextDnrUpdate) {
        failNextDnrUpdate = false;
        throw new Error("forced DNR failure");
      }
      const removals = new Set(update.removeRuleIds ?? []);
      dynamicRules = dynamicRules.filter((rule) => !removals.has(rule.id));
      dynamicRules.push(...structuredClone(update.addRules ?? []));
    },
    RuleActionType: { REDIRECT: "redirect" },
    ResourceType: { MAIN_FRAME: "main_frame" },
  },
  runtime: {
    onInstalled: eventTarget(),
    onStartup: eventTarget(),
    onMessage: { addListener(listener: MessageListener): void { messageListeners.push(listener); } },
    getURL(path: string): string { return `chrome-extension://fixture/${path}`; },
    getManifest(): chrome.runtime.Manifest { return { manifest_version: 3, name: "fixture", version: "3.0.0", chrome_url_overrides: { newtab: "newtab.html" } }; },
  },
  tabs: {
    onCreated: eventTarget(),
    onUpdated: eventTarget(),
    async create(): Promise<chrome.tabs.Tab> { return { id: 99, index: 0, pinned: false, highlighted: false, active: true, incognito: false, selected: true, discarded: false, autoDiscardable: true, groupId: -1, windowId: 1 }; },
    async update(): Promise<chrome.tabs.Tab> { return { id: 99, index: 0, pinned: false, highlighted: false, active: true, incognito: false, selected: true, discarded: false, autoDiscardable: true, groupId: -1, windowId: 1 }; },
  },
  webNavigation: { onBeforeNavigate: eventTarget() },
  notifications: { async create(): Promise<string> { return "notification"; } },
  i18n: { getMessage(key: string): string { return key; } },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const [settingsApi, runtimeApi, backupApi, blocklistApi, revisionApi] = await Promise.all([
  import("../src/lib/start-page-settings.js"),
  import("../src/lib/start-page-runtime.js"),
  import("../src/lib/backup.js"),
  import("../src/lib/blocklist.js"),
  import("../src/lib/data-revision.js"),
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
settingsA.layout.gap = 17;
settingsB.layout.gap = 29;
const settingsResults = await Promise.allSettled([
  settingsApi.setStartPageSettings(settingsA),
  settingsApi.setStartPageSettings(settingsB),
]);
assert.equal(settingsResults.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(settingsResults.filter((result) => result.status === "rejected").length, 1);
const persistedSettings = await settingsApi.getStartPageSettings();
assert.ok(persistedSettings.layout.gap === 17 || persistedSettings.layout.gap === 29);
const zeroTimestampSettings = settingsApi.cloneSettings(persistedSettings);
zeroTimestampSettings.updatedAt = 0;
await assert.rejects(() => settingsApi.setStartPageSettings(zeroTimestampSettings), /changed in another extension context/);

const baseRuntime = await runtimeApi.getStartPageRuntimeState(persistedSettings);
const runtimeA = structuredClone(baseRuntime);
const runtimeB = structuredClone(baseRuntime);
runtimeA.notes.fixture = "A";
runtimeB.notes.fixture = "B";
const runtimeResults = await Promise.allSettled([
  runtimeApi.setStartPageRuntimeState(runtimeA),
  runtimeApi.setStartPageRuntimeState(runtimeB),
]);
assert.equal(runtimeResults.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(runtimeResults.filter((result) => result.status === "rejected").length, 1);
const currentRuntime = await runtimeApi.getStartPageRuntimeState();
const zeroTimestampRuntime = structuredClone(currentRuntime);
zeroTimestampRuntime.updatedAt = 0;
await assert.rejects(() => runtimeApi.setStartPageRuntimeState(zeroTimestampRuntime), /changed in another extension context/);

const originalNow = Date.now;
Date.now = () => 5_000;
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

const currentSettingsForBackup = await settingsApi.getStartPageSettings();
const currentTasksBlock = currentSettingsForBackup.layout.blocks.find((block) => block.type === "localTasks");
assert.ok(currentTasksBlock);
delete localState.startPageRuntimeState;
localState.startTabInstanceState = {
  localTasks: {
    [currentTasksBlock.id]: [{ id: "legacy-task", title: "Legacy task", done: false, createdAt: 2, updatedAt: 2 }],
  },
};
const exported = await backupApi.exportBackup();
const exportedRuntime = exported.storage.startPageRuntimeState as { tasks: Record<string, Array<{ title: string }>> };
assert.equal(exportedRuntime.tasks[currentTasksBlock.id]?.[0]?.title, "Legacy task");
await backupApi.importBackup(exported);
assert.equal(Object.prototype.hasOwnProperty.call(localState, "startTabInstanceState"), false);

const exactBeforeFailure = structuredClone(localState);
localState.startTabPreImportBackup = { old: "recovery" };
const oldRecovery = structuredClone(localState.startTabPreImportBackup);
const failingBackup = structuredClone(await backupApi.exportBackup());
failingBackup.storage.blockedSites = ["replacement.example"];
failNextDnrUpdate = true;
await assert.rejects(() => backupApi.importBackup(failingBackup), /forced DNR failure/);
for (const key of Object.keys(exactBeforeFailure)) {
  if (key === "startTabPreImportBackup") continue;
  assert.deepEqual(localState[key], exactBeforeFailure[key], `Rollback must restore ${key}`);
}
assert.deepEqual(localState.startTabPreImportBackup, oldRecovery, "Rollback must preserve the prior recovery backup");

localState.startTabInstanceState = { localTasks: {} };
alarmNames.add(`${runtimeApi.CLOCK_ALARM_PREFIX}fixture:token`);
const resetAck = await workerMessage({ type: "reset-start-page" });
assert.deepEqual(resetAck, { ok: true });
assert.equal(Object.prototype.hasOwnProperty.call(localState, "startPageRuntimeState"), false);
assert.equal(Object.prototype.hasOwnProperty.call(localState, "startTabInstanceState"), false);
assert.equal(alarmNames.size, 0);
assert.equal((await settingsApi.getStartPageSettings()).schemaVersion, settingsApi.START_PAGE_SCHEMA_VERSION);

console.log("Round 7 fixtures passed");
