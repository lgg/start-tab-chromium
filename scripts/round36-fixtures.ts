import assert from "node:assert/strict";
import {
  createDefaultStartPageSettings,
  layoutMatchesPreset,
  settingsWithLayoutPreset,
} from "../src/lib/start-page-settings.js";

const original = createDefaultStartPageSettings(1);
original.layout.mode = "free";
original.layout.columns = 7;
const minimal = settingsWithLayoutPreset(original, "minimal");
assert.equal(minimal.layout.mode, "grid", "Applying a grid preset from free layout must visibly switch to grid mode");
assert.equal(minimal.layout.columns, 12, "Applying a preset must restore its declared column count");
assert.equal(layoutMatchesPreset(minimal, "minimal"), true, "Exact preset geometry must retain its preset profile");
minimal.layout.columns = 11;
assert.equal(layoutMatchesPreset(minimal, "minimal"), false, "Manual column changes must invalidate the preset profile");
minimal.layout.columns = 12;
minimal.layout.mode = "free";
assert.equal(layoutMatchesPreset(minimal, "minimal"), false, "Free layout must never be labelled as an active grid preset");

let localStorage: Record<string, unknown> = {};
let syncStorage: Record<string, unknown> = {};
let corruptCommittedChunk = true;

function clone<T>(value: T): T { return structuredClone(value); }
function keysFor(area: Record<string, unknown>, keys?: string | string[] | Record<string, unknown> | null): string[] {
  if (keys == null) return Object.keys(area);
  if (typeof keys === "string") return [keys];
  if (Array.isArray(keys)) return keys;
  return Object.keys(keys);
}
function selected(area: Record<string, unknown>, keys?: string | string[] | Record<string, unknown> | null): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of keysFor(area, keys)) {
    if (Object.prototype.hasOwnProperty.call(area, key)) output[key] = clone(area[key]);
    else if (keys && typeof keys === "object" && !Array.isArray(keys)) output[key] = clone(keys[key]);
  }
  return output;
}
function setItems(area: Record<string, unknown>, items: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(items)) area[key] = clone(value);
}
function removeItems(area: Record<string, unknown>, keys: string | string[]): void {
  for (const key of Array.isArray(keys) ? keys : [keys]) delete area[key];
}

const chromeMock = {
  runtime: {
    getURL: (relativePath: string) => `chrome-extension://round36/${relativePath}`,
    getManifest: () => ({ manifest_version: 3, name: "Round 36", version: "1" }),
    sendMessage: async () => ({ ok: true }),
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | Record<string, unknown> | null) => selected(localStorage, keys),
      set: async (items: Record<string, unknown>) => setItems(localStorage, items),
      remove: async (keys: string | string[]) => removeItems(localStorage, keys),
    },
    sync: {
      QUOTA_BYTES_PER_ITEM: 8192,
      QUOTA_BYTES: 102_400,
      get: async (keys?: string | string[] | Record<string, unknown> | null) => selected(syncStorage, keys),
      set: async (items: Record<string, unknown>) => {
        setItems(syncStorage, items);
        if (corruptCommittedChunk && typeof items.startTabSyncChunk0 === "string") {
          syncStorage.startTabSyncChunk0 = `${items.startTabSyncChunk0}corrupted-after-set`;
        }
      },
      remove: async (keys: string | string[]) => removeItems(syncStorage, keys),
    },
  },
  declarativeNetRequest: {
    RuleActionType: { REDIRECT: "redirect" },
    ResourceType: { MAIN_FRAME: "main_frame" },
    getDynamicRules: async () => [],
    updateDynamicRules: async () => undefined,
  },
  alarms: {
    getAll: async () => [],
    clear: async () => true,
    create: async () => undefined,
  },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const chromeSync = await import("../src/lib/chrome-sync.js");
await assert.rejects(
  () => chromeSync.uploadChromeSyncBackup(),
  /checksum mismatch|changed concurrently|incomplete/,
  "An upload must reject a remote frame whose chunks changed after chrome.storage.sync.set",
);
assert.equal(
  Object.prototype.hasOwnProperty.call(localStorage, "startTabLocalSyncMeta"),
  false,
  "A failed Browser Sync read-back must not advance the local sync baseline",
);

corruptCommittedChunk = false;
await chromeSync.uploadChromeSyncBackup();
assert.equal(typeof localStorage.startTabLocalSyncMeta, "object", "A fully verified upload must commit local sync metadata");
assert.deepEqual(localStorage.startTabLocalSyncMeta, syncStorage.startTabSyncMeta,
  "The local Browser Sync baseline must describe the exact verified remote frame");

console.log("Round 36 fixtures passed");
