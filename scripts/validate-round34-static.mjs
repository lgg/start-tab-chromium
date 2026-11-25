import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const newtab = read("src/newtab/newtab.ts");
const notes = read("src/newtab/block-renderers-runtime.ts");
const noteDraft = read("src/newtab/note-draft.ts");
const storagePlan = read("src/newtab/storage-change-plan.ts");
const integrations = read("src/newtab/block-renderers-integrations.ts");
const staticWidgets = read("src/newtab/block-renderers-static.ts");
const network = read("src/newtab/widget-network.ts");
const google = read("src/lib/google-integration.ts");
const editor = read("src/lib/block-settings-editor.ts");
const options = read("src/options/options.ts");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");
const selfHosted = read("scripts/validate-self-hosted-ci.mjs");

assert.match(storagePlan, /jsonContentEqual/,
  "Runtime content comparison must ignore dictionary insertion order at every nesting level");
assert.match(storagePlan, /export function sameRuntimeContent/,
  "Runtime storage echoes need a semantic content comparator");
assert.match(newtab,
  /normalizeRuntimeState\(runtimeChange\.newValue, editor\.settings\)[\s\S]*sameRuntimeContent\(runtime, incomingRuntime\)[\s\S]*runtime = incomingRuntime;[\s\S]*runtimeNeedsRefresh = false/,
  "Equal runtime storage echoes must update the revision without rebuilding the page");
assert.match(newtab, /!isFutureRuntimeSchema\(runtimeChange\.newValue\)/,
  "Future runtime schemas must never be silently normalized while suppressing refresh");

assert.match(notes, /const noteSessions = new Map<string, NoteSession>\(\)/);
assert.match(notes, /session\.draft\.observeCanonical\(canonicalValue, context\.runtime\.updatedAt\)/);
assert.match(notes, /await session\.save\(attempt\.value, attempt\.expectedValue\)[\s\S]*session\.draft\.succeed\(attempt, revision\)[\s\S]*session\.draft\.fail\(attempt\)/);
assert.match(notes, /current !== session\.draft\.expectedValue[\s\S]*noteDraftOverwriteConfirm[\s\S]*rebaseForRetry\(current, currentRuntime\.updatedAt\)/);
assert.match(noteDraft, /if \(!this\.hasUnsaved\)/);
assert.match(noteDraft, /this\.baseline = attempt\.value/);
assert.match(newtab, /!editor\.hasUnsavedChanges && !hasUnsavedNoteDrafts\(\)/);
assert.match(newtab, /textarea\[data-note-id\][\s\S]*setSelectionRange/);

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

assert.match(integrations, /parseWeatherPayload\(await fetchWidgetJson\(url\.toString\(\)\)\)/);
assert.match(staticWidgets, /parseIpPayload\(await fetchWidgetJson\(candidate\)\)/);
assert.match(network, /signal: AbortSignal\.timeout\(timeoutMs\)/);
assert.match(google, /signal: AbortSignal\.timeout\(30_000\)/);
for (const renderer of [integrations, staticWidgets]) {
  assert.match(renderer, /const requestCache = new WidgetRequestCache\(\)/);
}

assert.match(editor, /export function providerSelectionIndexAfterEdit/,
  "Search provider selection preservation must be independently testable");
assert.match(editor,
  /const selectedId = provider\.value;[\s\S]*const selectedIndex = provider\.selectedIndex;[\s\S]*provider\.selectedIndex = providerSelectionIndexAfterEdit/,
  "Provider edits must preserve the selected row across ID changes and removals");

assert.match(options, /const settingsChanged = !jsonContentEqual\(next, baseSettings\)/,
  "Locale-only saves must not rewrite settings and runtime revisions");
assert.match(options,
  /if \(settingsChanged\) \{[\s\S]*await sendMessage\(\{[\s\S]*type: "replace-start-page-settings"[\s\S]*if \(localeChanged\) \{[\s\S]*await setLocalePreference[\s\S]*location\.reload\(\)/,
  "Settings must commit before locale persistence so a settings failure cannot leave a stale applied language");
assert.match(options, /catch \(error\) \{[\s\S]*await reloadState\(\);[\s\S]*render\(savingGeneral\);/,
  "A locale failure after a settings commit must refresh persisted state while retaining the failed general draft");

for (const command of ["node scripts/run-round34-fixtures.mjs", "node scripts/validate-round34-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test must include ${command}`);
  assert.ok(workflow.includes(command), `CI must include ${command}`);
  assert.ok(selfHosted.includes(command), `Self-hosted CI validation must include ${command}`);
}

console.log("Round 34 static validation passed");

assert.doesNotMatch(notes, /context\.runtime\.notes\[block\.id\] = session\.draft\.value/);
assert.match(notes, /textarea\.readOnly = session\.resolving/);
assert.match(noteDraft, /revision < this\.canonical\.revision/);
assert.match(newtab, /const next = refreshJob\.catch\(\(\) => undefined\)\.then/);
assert.match(newtab, /const latestSettings = await getStartPageSettings\(\);[\s\S]*editor\.replaceSavedSettings\(savedSettings\)/);
