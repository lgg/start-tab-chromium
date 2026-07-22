import assert from "node:assert/strict";

let localStorage: Record<string, unknown> = {};
let syncStorage: Record<string, unknown> = {};
let syncSetCalls = 0;
let replaceMetaAfterChunkRead: Record<string, unknown> | null = null;

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
    getURL: (relativePath: string) => `chrome-extension://round32/${relativePath}`,
    getManifest: () => ({ manifest_version: 3, name: "Round 32", version: "1" }),
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
      get: async (keys?: string | string[] | Record<string, unknown> | null) => {
        const output = selected(syncStorage, keys);
        const requested = keysFor(syncStorage, keys);
        if (replaceMetaAfterChunkRead && requested.some((key) => key.startsWith("startTabSyncChunk"))) {
          syncStorage.startTabSyncMeta = clone(replaceMetaAfterChunkRead);
          replaceMetaAfterChunkRead = null;
        }
        return output;
      },
      set: async (items: Record<string, unknown>) => {
        syncSetCalls += 1;
        setItems(syncStorage, items);
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

await chromeSync.uploadChromeSyncBackup();
assert.equal(syncSetCalls, 1, "Initial upload must commit one complete Browser Sync frame");
const validChunk = syncStorage.startTabSyncChunk0;
assert.equal(typeof validChunk, "string");

syncStorage.startTabSyncChunk0 = `${validChunk}corrupted`;
syncSetCalls = 0;
assert.equal(
  await chromeSync.syncChromeSyncBackup(),
  "uploaded",
  "Matching metadata must not hide a corrupt remote Browser Sync frame",
);
assert.equal(syncSetCalls, 1, "A corrupt matching frame must be replaced exactly once");
assert.notEqual(syncStorage.startTabSyncChunk0, `${validChunk}corrupted`);
for (let index = 0; index < 12; index += 1) {
  assert.equal(typeof syncStorage[`startTabSyncChunk${index}`], "string",
    "Repair upload must preserve the complete fixed-size chunk frame");
}

syncSetCalls = 0;
assert.equal(
  await chromeSync.syncChromeSyncBackup(),
  "unchanged",
  "An intact matching Browser Sync frame must remain a no-op",
);
assert.equal(syncSetCalls, 0, "Intact matching Browser Sync content must not be rewritten");

syncStorage.startTabSyncChunk0 = `${String(syncStorage.startTabSyncChunk0)}corrupted-again`;
const currentMeta = clone(syncStorage.startTabSyncMeta as Record<string, unknown>);
replaceMetaAfterChunkRead = {
  ...currentMeta,
  updatedAt: "2035-01-01T00:00:00.000Z",
  snapshotId: "round32-concurrent-snapshot",
  checksum: "c".repeat(64),
  contentChecksum: "d".repeat(64),
};
syncSetCalls = 0;
await assert.rejects(
  () => chromeSync.syncChromeSyncBackup(),
  /changed concurrently/,
  "Corruption repair must not overwrite a snapshot replaced during verification",
);
assert.equal(syncSetCalls, 0, "A concurrently replaced remote snapshot must never be overwritten by repair");
assert.equal((syncStorage.startTabSyncMeta as Record<string, unknown>).snapshotId, "round32-concurrent-snapshot");

console.log("Round 32 fixtures passed");
