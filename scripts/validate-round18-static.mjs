import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const limits = read("src/lib/platform-limits.ts");
const messages = read("src/lib/messages.ts");
const settings = read("src/lib/start-page-settings.ts");
const settingsValidation = read("src/lib/start-page-settings-validation.ts");
const themeValidation = read("src/lib/start-page-theme-validation.ts");
const runtime = read("src/lib/start-page-runtime.ts");
const backup = read("src/lib/backup.ts");
const editor = read("src/newtab/layout-editor.ts");

assert.match(limits, /MAX_START_PAGE_BLOCKS = 1_000/);
assert.match(limits, /MAX_CUSTOM_THEMES = 1_000/);
assert.match(limits, /MAX_LOCAL_TASKS_PER_INSTANCE = 10_000/);
assert.match(messages, /blocks\.length <= MAX_START_PAGE_BLOCKS/,
  "Settings messages must use the shared block capacity");
assert.match(messages, /customThemes\.length <= MAX_CUSTOM_THEMES/,
  "Settings messages must use the shared theme capacity");
assert.match(messages, /tasks\.length <= MAX_LOCAL_TASKS_PER_INSTANCE/,
  "Runtime task messages must use the shared task capacity");
assert.match(settings, /assertStartPageSettingsCapacity\(value\)[\s\S]*validateStartPageSettings/,
  "Direct settings writes must reject unsupported collection sizes before normalization");
assert.match(settings, /settings\.layout\.blocks\.length >= MAX_START_PAGE_BLOCKS/,
  "Programmatic block creation must stop at the shared capacity");
assert.match(settingsValidation, /value\.slice\(0, MAX_START_PAGE_BLOCKS\)/,
  "Corrupted local block collections must normalize to an editable count");
assert.match(themeValidation, /value\.slice\(0, MAX_CUSTOM_THEMES\)/,
  "Corrupted local custom-theme collections must normalize to an editable count");
assert.match(runtime, /value\.slice\(0, MAX_LOCAL_TASKS_PER_INSTANCE\)/,
  "Corrupted local task collections must normalize to an editable count");
assert.match(backup, /assertCollectionCapacity\(source\)[\s\S]*normalizeStartPageSettings/,
  "Backup migration must reject oversized collections before normalization can discard data");
assert.match(backup, /assertTaskCollectionCapacity\(runtime\.tasks/,
  "Current runtime task collections must be checked during backup migration");
assert.match(backup, /assertTaskCollectionCapacity\(legacyRuntime\.localTasks/,
  "Legacy per-instance task collections must be checked during backup migration");
assert.match(editor, /this\.draft\.layout\.blocks\.length >= MAX_START_PAGE_BLOCKS/,
  "Layout Editor duplication must respect the same block capacity");

console.log("Round 18 static validation passed");
