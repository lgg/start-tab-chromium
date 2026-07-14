import assert from "node:assert/strict";

interface StorageAreaState { [key: string]: unknown }
type ChangeListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void;

const localState: StorageAreaState = {};
const syncState: StorageAreaState = {};
const listeners = new Set<ChangeListener>();
let failNextLocalGet = false;

function requestedKeys(keys?: string | string[] | Record<string, unknown> | null): string[] {
  if (keys == null) return [];
  if (typeof keys === "string") return [keys];
  if (Array.isArray(keys)) return keys;
  return Object.keys(keys);
}

function storageArea(state: StorageAreaState, areaName: "local" | "sync") {
  return {
    async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
      if (areaName === "local" && failNextLocalGet) {
        failNextLocalGet = false;
        throw new Error("transient local storage failure");
      }
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
    async clear(): Promise<void> {
      const keys = Object.keys(state);
      await this.remove(keys);
    },
  };
}

const alarmNames = new Set<string>();
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
    async getAll(): Promise<Array<{ name: string }>> { return [...alarmNames].map((name) => ({ name })); },
    async clear(name: string): Promise<boolean> { return alarmNames.delete(name); },
    create(name: string): void { alarmNames.add(name); },
  },
  declarativeNetRequest: {
    async getDynamicRules(): Promise<chrome.declarativeNetRequest.Rule[]> { return []; },
    async updateDynamicRules(): Promise<void> {},
    RuleActionType: { REDIRECT: "redirect" },
    ResourceType: { MAIN_FRAME: "main_frame" },
  },
  runtime: {
    getURL(path: string): string { return `chrome-extension://fixture/${path}`; },
    onMessage: { addListener(): void {} },
  },
  tabs: {
    async create(): Promise<chrome.tabs.Tab> { return { id: 99, index: 0, pinned: false, highlighted: false, active: true, incognito: false, selected: true, discarded: false, autoDiscardable: true, groupId: -1, windowId: 1 }; },
    async update(): Promise<chrome.tabs.Tab> { return { id: 99, index: 0, pinned: false, highlighted: false, active: true, incognito: false, selected: true, discarded: false, autoDiscardable: true, groupId: -1, windowId: 1 }; },
  },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const [{ markStartTabDataChanged, readStartTabDataRevision }, defaults, settingsApi, runtimeApi, syncApi, blocklistApi, messagesApi] = await Promise.all([
  import("../src/lib/data-revision.js"),
  import("../src/lib/start-page-defaults.js"),
  import("../src/lib/start-page-settings.js"),
  import("../src/lib/start-page-runtime.js"),
  import("../src/lib/chrome-sync.js"),
  import("../src/lib/blocklist.js"),
  import("../src/lib/messages.js"),
]);

// Revisions must strictly increase even when the wall clock does not.
const originalNow = Date.now;
Date.now = () => 1_000;
await markStartTabDataChanged();
const firstRevision = await readStartTabDataRevision();
await markStartTabDataChanged();
const secondRevision = await readStartTabDataRevision();
assert.ok(secondRevision > firstRevision, "Data revisions must increase within the same millisecond");
Date.now = originalNow;

// Settings writes must reject a stale snapshot rather than silently overwriting another context.
const initialSettings = await settingsApi.getStartPageSettings();
const staleSettings = settingsApi.cloneSettings(initialSettings);
const changedSettings = settingsApi.cloneSettings(initialSettings);
changedSettings.layout.gap += 1;
await settingsApi.setStartPageSettings(changedSettings);
await assert.rejects(() => settingsApi.setStartPageSettings(staleSettings), /changed in another extension context/);

// Runtime writes must provide the same lost-update protection.
const currentSettings = await settingsApi.getStartPageSettings();
const initialRuntime = await runtimeApi.getStartPageRuntimeState(currentSettings);
const staleRuntime = structuredClone(initialRuntime);
const changedRuntime = structuredClone(initialRuntime);
changedRuntime.notes.fixture = "newer";
await runtimeApi.setStartPageRuntimeState(changedRuntime);
staleRuntime.notes.fixture = "stale";
await assert.rejects(() => runtimeApi.setStartPageRuntimeState(staleRuntime), /changed in another extension context/);

// A transient migration read failure must not poison all future blocklist reads.
localState.blocked = ["https://example.com/path"];
failNextLocalGet = true;
await assert.rejects(() => blocklistApi.migrateLegacyStorage(), /transient/);
await blocklistApi.migrateLegacyStorage();
assert.deepEqual(await blocklistApi.getBlockedSites(), ["example.com"]);

// Upload a real remote snapshot, then simulate a brand-new pristine device. Remote data must win.
const remoteSettings = settingsApi.cloneSettings(await settingsApi.getStartPageSettings());
remoteSettings.layout.gap = 31;
await settingsApi.setStartPageSettings(remoteSettings);
await syncApi.uploadChromeSyncBackup();
const remoteMeta = structuredClone(syncState.startTabSyncMeta);
assert.ok(remoteMeta, "Remote sync metadata must be written");
for (const key of Object.keys(localState)) delete localState[key];
const result = await syncApi.syncChromeSyncBackup();
assert.equal(result, "restored", "A pristine device must restore existing remote data");
assert.equal((await settingsApi.getStartPageSettings()).layout.gap, 31);

// New worker-owned operations must be validated explicitly.
assert.equal(messagesApi.isMessage({ type: "replace-blocked-sites", sites: ["example.com"] }), true);
assert.equal(messagesApi.isMessage({ type: "open-native-new-tab" }), true);
assert.equal(messagesApi.isMessage({ type: "reset-start-page" }), true);
assert.equal(messagesApi.isMessage({ type: "replace-blocked-sites", sites: [42] }), false);

// A complete runtime reset clears both runtime generations and durable clock alarms.
localState.startPageRuntimeState = runtimeApi.normalizeRuntimeState(undefined, await settingsApi.getStartPageSettings());
localState.startTabInstanceState = { legacy: true };
alarmNames.add(`${runtimeApi.CLOCK_ALARM_PREFIX}timer:token`);
await runtimeApi.resetStartPageRuntimeState();
assert.equal(Object.prototype.hasOwnProperty.call(localState, "startPageRuntimeState"), false);
assert.equal(Object.prototype.hasOwnProperty.call(localState, "startTabInstanceState"), false);
assert.equal(alarmNames.size, 0);

// Defaults remain valid after all migration and reset paths.
assert.equal(settingsApi.normalizeStartPageSettings(defaults.DEFAULT_SETTINGS).schemaVersion, settingsApi.START_PAGE_SCHEMA_VERSION);

console.log("Round 6 fixtures passed");
