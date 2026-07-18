import assert from "node:assert/strict";

import { migrateBackup } from "../src/lib/backup.js";
import { normalizeBackupLastBlockedUrls } from "../src/lib/backup-blocked-urls.js";
import { gridBlocksOverlap, placeGridBlock, placeGridBlocks } from "../src/lib/grid-layout.js";
import {
  MAX_GRID_BLOCK_HEIGHT,
  MAX_GRID_ROW,
  MAX_LOCAL_TASK_TITLE_LENGTH,
  MAX_START_PAGE_BLOCKS,
} from "../src/lib/platform-limits.js";
import {
  cloneBlock,
  cloneSettings,
  DEFAULT_SETTINGS,
  normalizeStartPageSettings,
} from "../src/lib/start-page-settings.js";
import type { BlockInstance, StartPageSettings } from "../src/lib/start-page-types.js";

const source = DEFAULT_SETTINGS.layout.blocks.find((block) => block.type === "dateTime");
assert.ok(source, "Default settings must contain a repeatable date/time block");

function denseBlocks(count: number): BlockInstance[] {
  return Array.from({ length: count }, (_, index) => ({
    ...cloneBlock(source),
    id: `round20-grid-${index}`,
    column: 1,
    row: 1,
    width: 1,
    height: MAX_GRID_BLOCK_HEIGHT,
    order: index,
    enabled: true,
    zone: "contained",
  }));
}

const placed = placeGridBlocks(denseBlocks(MAX_START_PAGE_BLOCKS), 1);
assert.equal(placed.length, MAX_START_PAGE_BLOCKS);
assert.ok(placed.at(-1)?.row && placed.at(-1)!.row > 500,
  "Full-capacity Grid placement must not retain the former 500-row ceiling");
assert.ok(placed.at(-1)!.row <= MAX_GRID_ROW,
  "Full-capacity Grid placement must remain inside the documented geometry bound");
for (let index = 1; index < placed.length; index += 1) {
  assert.equal(gridBlocksOverlap(placed[index - 1]!, placed[index]!), false,
    `Dense Grid blocks ${index - 1} and ${index} must not overlap`);
}

const nearEnd = { ...cloneBlock(source), id: "near-end", row: MAX_GRID_ROW, height: MAX_GRID_BLOCK_HEIGHT };
const occupiedEnd = { ...cloneBlock(source), id: "occupied-end", row: MAX_GRID_ROW, height: MAX_GRID_BLOCK_HEIGHT };
const wrapped = placeGridBlock(nearEnd, [occupiedEnd], 12);
assert.equal(wrapped.row, 1,
  "Placement must search from the beginning when the requested tail range is occupied");

const rawSettings = cloneSettings(DEFAULT_SETTINGS);
rawSettings.layout.columns = 1;
rawSettings.layout.mode = "grid";
rawSettings.layout.blocks = denseBlocks(MAX_START_PAGE_BLOCKS);
const normalized = normalizeStartPageSettings(rawSettings);
assert.equal(normalized.layout.blocks.length, MAX_START_PAGE_BLOCKS);
assert.ok(normalized.layout.blocks.at(-1)!.row > 500);
for (let index = 1; index < normalized.layout.blocks.length; index += 1) {
  assert.equal(gridBlocksOverlap(normalized.layout.blocks[index - 1]!, normalized.layout.blocks[index]!), false);
}
const oversizedGeometry = cloneSettings(DEFAULT_SETTINGS);
oversizedGeometry.layout.blocks = [{ ...cloneBlock(source), height: 999_999, row: 999_999 }];
const boundedGeometry = normalizeStartPageSettings(oversizedGeometry);
assert.equal(boundedGeometry.layout.blocks[0]?.height, MAX_GRID_BLOCK_HEIGHT);
assert.equal(boundedGeometry.layout.blocks[0]?.row, MAX_GRID_ROW);

assert.equal(MAX_LOCAL_TASK_TITLE_LENGTH, 500,
  "UI and runtime task-title validation must share the existing 500-character contract");

const allowedSites = ["allowed.example", "constructor"];
const recoveredUrls = normalizeBackupLastBlockedUrls(JSON.parse(`{
  "stale.example":"https://stale.example/path",
  "allowed.example":"https://allowed.example/path",
  "constructor":"https://constructor/path"
}`), allowedSites, "local-recovery");
assert.deepEqual(Object.keys(recoveredUrls).sort(), ["allowed.example", "constructor"]);
assert.equal(recoveredUrls["stale.example"], undefined,
  "Recovery must remove return URLs that no longer belong to a blocked site");
assert.equal(recoveredUrls.constructor, "https://constructor/path",
  "Prototype-like blocked hosts must remain ordinary user data");

const tooManyUrls = Object.fromEntries(Array.from({ length: 5_001 }, (_, index) => [
  `blocked-${index}.example`,
  `https://blocked-${index}.example/path`,
]));
assert.throws(
  () => normalizeBackupLastBlockedUrls(tooManyUrls, [], "strict-import"),
  /more than 5000 last blocked URLs/,
  "Untrusted oversized return-URL maps must be rejected before import",
);

const migrated = migrateBackup({
  app: "Start Tab",
  version: 4,
  exportedAt: new Date().toISOString(),
  snapshotId: "round20-backup",
  storage: {
    blockedSites: ["allowed.example"],
    lastBlockedUrls: {
      "allowed.example": "https://allowed.example/return",
      "stale.example": "https://stale.example/return",
    },
    startPageSettings: DEFAULT_SETTINGS,
  },
});
const migratedUrls = migrated.storage.lastBlockedUrls as Record<string, string>;
assert.deepEqual(Object.keys(migratedUrls), ["allowed.example"]);
assert.equal(migratedUrls["allowed.example"], "https://allowed.example/return");

const migratedSettings = migrated.storage.startPageSettings as StartPageSettings;
assert.equal(migratedSettings.schemaVersion, DEFAULT_SETTINGS.schemaVersion);

console.log("Round 20 fixtures passed");
