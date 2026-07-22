import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const newtab = read("src/newtab/newtab.ts");
const storagePlan = read("src/newtab/storage-change-plan.ts");
const integrations = read("src/newtab/block-renderers-integrations.ts");
const editor = read("src/lib/block-settings-editor.ts");
const options = read("src/options/options.ts");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");
const selfHosted = read("scripts/validate-self-hosted-ci.mjs");

assert.match(storagePlan, /function sortedEntries/,
  "Runtime content comparison must ignore dictionary insertion order");
assert.match(storagePlan, /export function sameRuntimeContent/,
  "Runtime storage echoes need a semantic content comparator");
assert.match(newtab,
  /normalizeRuntimeState\(runtimeChange\.newValue, editor\.settings\)[\s\S]*sameRuntimeContent\(runtime, incomingRuntime\)[\s\S]*runtime = incomingRuntime;[\s\S]*runtimeNeedsRefresh = false/,
  "Equal runtime storage echoes must update the revision without rebuilding the page");
assert.match(newtab, /!isFutureRuntimeSchema\(runtimeChange\.newValue\)/,
  "Future runtime schemas must never be silently normalized while suppressing refresh");

assert.match(integrations, /export function visibleWebUrlItems/,
  "Browser-derived URLs need one bounded safe filtering helper");
assert.match(integrations,
  /maxResults: recentHistorySearchLimit\(maxResults\)[\s\S]*visibleWebUrlItems\(items, maxResults\)/,
  "Recent history must overscan before applying its visible result limit");
assert.match(integrations, /requested === 0 \? 0 : Math\.min\(500, Math\.max\(100, requested \* 10\)\)/,
  "History overscan must reject invalid limits and remain bounded");
assert.match(integrations, /item\.title\?\.trim\(\) \|\| url/,
  "Whitespace-only browser titles must fall back to the safe URL");
assert.match(integrations, /export function validatedWeatherCoordinates/,
  "Custom geocoding responses need bounded finite coordinates");
assert.match(integrations, /latitude >= -90[\s\S]*latitude <= 90[\s\S]*longitude >= -180[\s\S]*longitude <= 180/,
  "Geocoded latitude and longitude must be range checked");
assert.match(integrations, /const city = block\.config\.city\.trim\(\)/,
  "Weather labels must use the same normalized city value as geocoding mode detection");

assert.match(editor, /export function providerSelectionIndexAfterEdit/,
  "Search provider selection preservation must be independently testable");
assert.match(editor,
  /const selectedId = provider\.value;[\s\S]*const selectedIndex = provider\.selectedIndex;[\s\S]*provider\.selectedIndex = providerSelectionIndexAfterEdit/,
  "Provider edits must preserve the selected row across ID changes and removals");

assert.match(options, /const settingsChanged = JSON\.stringify\(next\) !== JSON\.stringify\(settings\)/,
  "Locale-only saves must not rewrite settings and runtime revisions");
assert.match(options,
  /if \(settingsChanged\) \{[\s\S]*await sendMessage\(\{[\s\S]*type: "replace-start-page-settings"[\s\S]*settingsPersisted = true;[\s\S]*if \(localeChanged\) \{[\s\S]*await setLocalePreference[\s\S]*location\.reload\(\)/,
  "Settings must commit before locale persistence so a settings failure cannot leave a stale applied language");
assert.match(options, /catch \(error\) \{[\s\S]*if \(settingsPersisted\) \{[\s\S]*await reloadState\(\);[\s\S]*render\(\);/,
  "A locale failure after a settings commit must refresh the in-memory settings revision");

for (const command of ["node scripts/run-round34-fixtures.mjs", "node scripts/validate-round34-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test must include ${command}`);
  assert.ok(workflow.includes(command), `CI must include ${command}`);
  assert.ok(selfHosted.includes(command), `Self-hosted CI validation must include ${command}`);
}

console.log("Round 34 static validation passed");
