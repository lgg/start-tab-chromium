import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const settings = read("src/lib/start-page-settings.ts");
const defaults = read("src/lib/start-page-defaults.ts");
const runtime = read("src/lib/start-page-runtime.ts");
const json = read("src/lib/json-content.ts");
const storagePlan = read("src/newtab/storage-change-plan.ts");
const sync = read("src/lib/chrome-sync.ts");
const backupUrls = read("src/lib/backup-blocked-urls.ts");
const blocklist = read("src/lib/blocklist.ts");
const options = read("src/options/options.ts");
const optionsHtml = read("src/options/options.html");
const editor = read("src/lib/block-settings-editor.ts");
const layoutEditor = read("src/newtab/layout-editor.ts");
const newtab = read("src/newtab/newtab.ts");
const runtimeRenderer = read("src/newtab/block-renderers-runtime.ts");
const gate = read("src/newtab/newtab-gate.js");
const popup = read("src/popup/popup.ts");
const blocked = read("src/blocked/blocked.ts");
const worker = read("src/service-worker.ts");
const localeReport = read("scripts/report-locale-parity.mjs");
const readme = read("README.md");
const manualQa = read("docs/manual-qa-3.0.0.md");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");
const selfHosted = read("scripts/validate-self-hosted-ci.mjs");

assert.match(json, /export function canonicalJsonValue/);
assert.match(json, /left < right \? -1 : left > right \? 1 : 0/,
  "Canonical JSON keys must use locale-independent code-unit ordering");
for (const source of [settings, runtime, worker, storagePlan, options]) {
  assert.ok(source.includes("jsonContentEqual"), "Every semantic storage comparison must use canonical JSON content equality");
}
assert.doesNotMatch(settings, /function jsonEqual/);
assert.doesNotMatch(runtime, /function jsonEqual/);
assert.match(storagePlan, /jsonContentEqual\([\s\S]*clocks: left\.clocks[\s\S]*tasks: left\.tasks/,
  "Runtime comparison must canonicalize nested clocks and task objects, not only outer IDs");

assert.match(defaults, /export function blockTitleKey/);
assert.match(defaults, /export function blockUsesDefaultTitle/);
assert.match(defaults, /block\.title === blockTitleKey\(block\.type\)/,
  "Only the exact default locale key may be treated as an internal block title");
for (const source of [editor, layoutEditor, newtab, runtimeRenderer, options, worker]) {
  assert.ok(source.includes("blockUsesDefaultTitle"), "Every user-visible block-title surface must resolve default keys consistently");
  assert.doesNotMatch(source, /startsWith\("blockTitle"\)/,
    "Custom titles beginning with blockTitle must remain visible as custom titles");
}
assert.match(layoutEditor, /title: blockTitleKey\(type\)/,
  "Blocks added from the Start Tab palette must keep locale-adaptive default title keys");
assert.match(worker, /title: blockUsesDefaultTitle\(block\) \? await workerMessage\(blockTitleKey\(block\.type\)\) : block\.title/,
  "Clock notifications must never expose raw internal title keys");

assert.match(settings, /export function createBlockInstanceDraft/);
assert.match(settings, /export async function saveNewBlockInstance/);
assert.match(settings, /saveNewBlockInstance[\s\S]*updateStartPageSettings/,
  "Confirmed block creation must append atomically against the latest settings snapshot");
assert.match(settings, /saveNewBlockInstance[\s\S]*\.\.\.nextGridPosition\(current\)/,
  "A block confirmed after another layout change must recompute its free grid row from the latest settings");
assert.match(options,
  /createBlockInstanceDraft\(settings,[\s\S]*editBlockInstance\(created, i18n\)[\s\S]*if \(!configured\) return;[\s\S]*saveNewBlockInstance\(configured\)/,
  "Cancelling the Add Block dialog must not persist a block");
for (const functionName of [
  "updateBlockInstance", "duplicateBlockInstance", "setLayoutMode", "setLayoutZone",
  "saveNewCustomTheme", "updateCustomTheme", "duplicateTheme", "deleteCustomTheme", "selectTheme", "importCustomTheme",
]) {
  const start = settings.indexOf(`export async function ${functionName}`);
  assert.ok(start >= 0, `Missing settings mutation: ${functionName}`);
  const next = settings.indexOf("\nexport ", start + 1);
  const body = settings.slice(start, next < 0 ? settings.length : next);
  assert.ok(body.includes("updateStartPageSettings"), `${functionName} must mutate the latest locked settings snapshot`);
}

assert.match(gate, /function webTab/);
assert.match(gate, /parsed\.protocol !== "http:" && parsed\.protocol !== "https:"/);
assert.match(gate, /\.map\(webTab\)[\s\S]*\.filter\(Boolean\)/,
  "Split View may offer only validated HTTP(S) targets");
assert.match(gate, /setAttribute\("inert", ""\)/);
assert.match(gate, /role", "dialog"/);
assert.match(gate, /aria-modal/);
assert.match(gate, /\(firstAction \|\| native\)\.focus\(\)/,
  "Split/disabled overlays must move focus into their modal controls");

assert.match(popup, /clearBlocklistConfirm/,
  "Popup must confirm destructive full-blocklist clearing");
assert.match(popup, /languageEl\.value = localePreference/,
  "Popup language selection must roll back visually after persistence failure");
assert.match(blocked, /remaining <= 0[\s\S]*cancelEl\.disabled = true[\s\S]*finishUnblock/,
  "The countdown cancel action must not race an unblock already being committed");

assert.match(localeReport, /readdir\(directory\)/);
assert.match(localeReport, /filter\(\(file\) => file\.endsWith\("\.json"\)\)/,
  "Locale parity must cover every catalog loaded by the runtime");
assert.match(localeReport, /duplicateEnglishKeys/);
assert.match(localeReport, /duplicateRussianKeys/);
assert.doesNotMatch(optionsHtml, /aria-label="Settings sections"/);
assert.match(options, /nav\.setAttribute\("aria-label", i18n\.t\("settingsSections"\)\)/);

for (const source of [sync, backupUrls, blocklist]) {
  assert.doesNotMatch(source, /localeCompare/,
    "Checksums, recovery ordering, and canonical rules must not depend on host locale collation");
}
assert.match(sync, /function compareJsonKeys/);

assert.ok(readme.includes("General, Blocks, Themes, Backup and sync, Website blocker, and Statistics and migration"));
assert.ok(readme.includes("Open Start Tab** action in the page header"));
assert.ok(manualQa.includes("cancel its configuration dialog, and confirm no block or runtime data is created"));
assert.ok(manualQa.includes("privileged/internal tabs"));

for (const command of ["node scripts/run-round35-fixtures.mjs", "node scripts/validate-round35-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test must include ${command}`);
  assert.ok(workflow.includes(command), `CI must include ${command}`);
  assert.ok(selfHosted.includes(command), `Self-hosted CI validation must include ${command}`);
}

console.log("Round 35 static validation passed");
