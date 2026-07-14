import assert from "node:assert/strict";

interface StorageAreaState { [key: string]: unknown }
type ChangeListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void;

const localState: StorageAreaState = {};
const syncState: StorageAreaState = {};
const listeners = new Set<ChangeListener>();
let failSetAfterApplyForKey: string | null = null;
let failNextDnrUpdateAfterApply = false;

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
        throw new Error(`simulated storage failure after writing ${key}`);
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
    async clear(): Promise<void> {
      await this.remove(Object.keys(state));
    },
  };
}

const lockTails = new Map<string, Promise<void>>();
const lockActive = new Map<string, number>();
const lockMaxActive = new Map<string, number>();
const lockManager = {
  async request<T>(name: string, _options: LockOptions, callback: () => Promise<T>): Promise<T> {
    const previous = lockTails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    lockTails.set(name, tail);
    await previous.catch(() => undefined);
    const active = (lockActive.get(name) ?? 0) + 1;
    lockActive.set(name, active);
    lockMaxActive.set(name, Math.max(lockMaxActive.get(name) ?? 0, active));
    try {
      return await callback();
    } finally {
      lockActive.set(name, active - 1);
      release();
      if (lockTails.get(name) === tail) lockTails.delete(name);
    }
  },
};
Object.defineProperty(globalThis, "navigator", { value: { locks: lockManager }, configurable: true });

const alarmNames = new Set<string>();
let dynamicRules: chrome.declarativeNetRequest.Rule[] = [];
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
    async getDynamicRules(): Promise<chrome.declarativeNetRequest.Rule[]> { return structuredClone(dynamicRules); },
    async updateDynamicRules(update: chrome.declarativeNetRequest.UpdateRuleOptions): Promise<void> {
      const removed = new Set(update.removeRuleIds ?? []);
      dynamicRules = dynamicRules.filter((rule) => !removed.has(rule.id));
      dynamicRules.push(...structuredClone(update.addRules ?? []));
      if (failNextDnrUpdateAfterApply) {
        failNextDnrUpdateAfterApply = false;
        throw new Error("simulated DNR failure after applying rules");
      }
    },
    RuleActionType: { REDIRECT: "redirect" },
    ResourceType: { MAIN_FRAME: "main_frame" },
  },
  runtime: {
    getURL(path: string): string { return `chrome-extension://fixture/${path}`; },
    onMessage: { addListener(): void {} },
  },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const [storageLockApi, revisionApi, defaults, settingsApi, runtimeApi, backupApi, resetApi, syncApi, blocklistApi] = await Promise.all([
  import("../../src/lib/storage-lock.js"),
  import("../../src/lib/data-revision.js"),
  import("../../src/lib/start-page-defaults.js"),
  import("../../src/lib/start-page-settings.js"),
  import("../../src/lib/start-page-runtime.js"),
  import("../../src/lib/backup.js"),
  import("../../src/lib/start-page-reset.js"),
  import("../../src/lib/chrome-sync.js"),
  import("../../src/lib/blocklist.js"),
]);

export function failNextSetAfterApply(key: string): void { failSetAfterApplyForKey = key; }
export function failNextDnrAfterApply(): void { failNextDnrUpdateAfterApply = true; }
export function currentDynamicRules(): chrome.declarativeNetRequest.Rule[] { return structuredClone(dynamicRules); }
export function replaceDynamicRules(rules: chrome.declarativeNetRequest.Rule[]): void { dynamicRules = structuredClone(rules); }
export { localState, syncState, lockMaxActive, alarmNames, storageLockApi, revisionApi, defaults, settingsApi, runtimeApi, backupApi, resetApi, syncApi, blocklistApi };
