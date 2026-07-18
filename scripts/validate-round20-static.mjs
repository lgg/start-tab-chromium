import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const limits = read("src/lib/platform-limits.ts");
const grid = read("src/lib/grid-layout.ts");
const settingsValidation = read("src/lib/start-page-settings-validation.ts");
const editor = read("src/newtab/layout-editor.ts");
const tasks = read("src/newtab/block-renderers-runtime.ts");
const backupUrls = read("src/lib/backup-blocked-urls.ts");
const backup = read("src/lib/backup.ts");

assert.match(limits, /MAX_GRID_BLOCK_HEIGHT = 80/);
assert.match(limits, /MAX_GRID_ROW = MAX_START_PAGE_BLOCKS \* MAX_GRID_BLOCK_HEIGHT \+ 1/);
assert.match(grid, /export function placeGridBlock/);
assert.match(grid, /firstAvailableRow/);
assert.doesNotMatch(grid, /attempts\s*<\s*500/,
  "Shared Grid placement must not regress to an arbitrary retry ceiling");
assert.match(settingsValidation, /placeGridBlocks\(blocks, columns\)/,
  "Persistence normalization must use the same full-capacity placement algorithm");
assert.match(settingsValidation, /MAX_GRID_BLOCK_HEIGHT/);
assert.match(settingsValidation, /MAX_GRID_ROW/);
assert.match(editor, /import \{ placeGridBlock, placeGridBlocks \} from "\.\.\/lib\/grid-layout\.js"/,
  "The inline editor must preview the same placement that persistence will save");
assert.doesNotMatch(editor, /attempts\s*<\s*500/);
assert.match(editor, /mode === "grid"[\s\S]*placeGridBlocks/,
  "Switching to Grid mode must resolve the complete draft immediately");
assert.match(editor, /replacement\.enabled[\s\S]*placeGridBlock/,
  "Re-enabling a Grid block must avoid overlap before save");

assert.match(tasks, /input\.maxLength = MAX_LOCAL_TASK_TITLE_LENGTH/,
  "Local task titles must be bounded before a runtime message is sent");
assert.match(tasks, /allTasks\.length >= MAX_LOCAL_TASKS_PER_INSTANCE/,
  "Local task controls must disable at the same capacity as runtime validation");
assert.match(tasks, /currentTasks\.length >= MAX_LOCAL_TASKS_PER_INSTANCE/,
  "Task submit must recheck capacity to prevent stale-UI overflows");
assert.match(tasks, /saveTasks\([\s\S]*\.then\(\(\) => \{[\s\S]*input\.value = ""/,
  "Task input must clear only after persistence succeeds");

assert.match(backupUrls, /mode === "strict-import" && entries\.length > MAX_BLOCKED_SITES/,
  "External return-URL maps must be rejected at the shared blocklist capacity");
assert.match(backupUrls, /if \(!allowed\.has\(host\)\) continue/,
  "Backup return URLs must remain correlated with the normalized blocklist");
assert.match(backup, /const blockedSites = normalizeBackupBlockedSites\(source, mode\)/);
assert.match(backup, /normalizeBackupLastBlockedUrls\(source\.lastBlockedUrls, blockedSites, mode\)/);

console.log("Round 20 static validation passed");
