import assert from "node:assert/strict";
import { chromeSyncItemBytes, chromeSyncStorageBytes } from "../src/lib/chrome-sync.js";
import { driveBackupListUrl } from "../src/lib/google-integration.js";
import { planStartPageStorageChange } from "../src/newtab/storage-change-plan.js";

const mixed = planStartPageStorageChange(true, { settings: true, runtime: true, focusStats: false });
assert.deepEqual(mixed, { announceIgnoredSettings: true, refreshState: true },
  "Runtime updates in a mixed storage event must not be lost behind an unsaved layout draft");
assert.deepEqual(
  planStartPageStorageChange(true, { settings: true, runtime: false, focusStats: false }),
  { announceIgnoredSettings: true, refreshState: false },
  "A settings-only event must preserve an unsaved layout draft",
);
assert.deepEqual(
  planStartPageStorageChange(false, { settings: true, runtime: false, focusStats: false }),
  { announceIgnoredSettings: false, refreshState: true },
  "Persisted settings must refresh when no draft is active",
);
assert.deepEqual(
  planStartPageStorageChange(true, { settings: false, runtime: false, focusStats: true }),
  { announceIgnoredSettings: false, refreshState: true },
  "Focus statistics must refresh independently from layout settings",
);

const driveUrl = new URL(driveBackupListUrl());
assert.equal(driveUrl.searchParams.get("spaces"), "appDataFolder");
assert.equal(driveUrl.searchParams.get("orderBy"), "modifiedTime desc",
  "Drive backup lookup must deterministically select the newest duplicate");
assert.equal(driveUrl.searchParams.get("pageSize"), "1");
assert.match(driveUrl.searchParams.get("fields") ?? "", /modifiedTime/);

const syncItems = {
  startTabSyncMeta: { version: 3, chunks: 2 },
  startTabSyncChunk0: "quoted \" value",
  startTabSyncChunk1: "🧭\nline",
};
const expectedBytes = Object.entries(syncItems).reduce((total, [key, value]) => {
  return total + new TextEncoder().encode(key).byteLength
    + new TextEncoder().encode(JSON.stringify(value)).byteLength;
}, 0);
assert.equal(chromeSyncStorageBytes(syncItems), expectedBytes,
  "Total browser-sync quota accounting must include every key and JSON-stringified value");
assert.equal(
  chromeSyncItemBytes("startTabSyncChunk0", syncItems.startTabSyncChunk0),
  new TextEncoder().encode("startTabSyncChunk0").byteLength
    + new TextEncoder().encode(JSON.stringify(syncItems.startTabSyncChunk0)).byteLength,
);

console.log("Round 13 fixtures passed");
