import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const sync = read("src/lib/chrome-sync.ts");
const settings = read("src/lib/start-page-settings.ts");
const options = read("src/options/options.ts");
const gate = read("src/newtab/newtab-gate.js");
const newtab = read("src/newtab/newtab.ts");
const en = read("src/_locales/en/round7-messages.json");
const ru = read("src/_locales/ru/round7-messages.json");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");
const selfHosted = read("scripts/validate-self-hosted-ci.mjs");
const manualQa = read("docs/manual-qa-3.0.0.md");
const audit = read("docs/audit-2026-07-22-round-36.md");

assert.match(sync, /await chrome\.storage\.sync\.set\(payload\)[\s\S]*readRemoteMeta\(\)[\s\S]*readVerifiedRemoteBundle\(committed\)[\s\S]*writeLocalMeta\(meta\)/,
  "Browser Sync upload must verify metadata and all committed chunks before advancing local metadata");

assert.match(settings, /settingsWithLayoutPreset[\s\S]*next\.layout\.mode = "grid"[\s\S]*next\.layout\.columns = preset\.columns/,
  "Applying a preset must restore its grid mode and declared columns");
assert.match(settings, /export function layoutMatchesPreset/);
assert.match(settings, /settings\.layout\.mode !== "grid"/);
assert.match(options, /preset\.addEventListener\("change"[\s\S]*mode\.value = "grid"[\s\S]*columns\.value = String\(selected\.columns\)/,
  "Preset selection must update the visible mode and column controls");
assert.match(options, /activePreset[\s\S]*layoutMatchesPreset\(settings, candidate\.id\)/,
  "Options must not display stale preset metadata for geometry that no longer matches");
assert.match(options, /preset\.value !== "custom" && !layoutMatchesPreset\(settings, preset\.value as LayoutPresetId\)/,
  "Reapplying a stale preset ID must depend on actual geometry, not only the stored profile string");
assert.match(options, /layoutMatchesPreset\(next, preset\.value as LayoutPresetId\)/,
  "Saved profile metadata must describe actual geometry rather than a stale selector");

const navigationIndex = options.indexOf("renderNavigation(navigationItems)");
const statisticsIndex = options.indexOf("void renderStatistics().then");
assert.ok(navigationIndex >= 0 && statisticsIndex > navigationIndex,
  "Options navigation must render before asynchronous statistics loading");
assert.match(options, /renderStatistics\(\)[\s\S]*catch[\s\S]*statisticsUnavailable/,
  "Statistics failure must leave a visible localized section instead of removing navigation");

assert.match(gate, /LOCALE_OVERRIDE_KEY/);
assert.match(gate, /_locales\/\$\{locale\}\/messages\.json/,
  "The early gate must honor the explicit locale override before the module UI loads");
assert.doesNotMatch(gate, /openerNewTab/,
  "A generic opener relationship must not be treated as proof of Split View");
assert.match(gate, /opener\?\.url[\s\S]*opener\?\.pendingUrl[\s\S]*opener\?\.title/,
  "Opener-based Split View detection must require an explicit marker");
assert.match(gate, /function trapFocus/);
assert.match(gate, /previousFocus\?\.isConnected/);
assert.match(gate, /ONBOARDING_ID/);
assert.match(gate, /window\.startTabGateReady = Promise\.resolve\(\)\.then\(initGate\)\.catch\(ignore\)/,
  "The module UI must be able to await the final gate decision");
assert.match(newtab, /await window\.startTabGateReady/);
assert.match(newtab, /function trapModalFocus/);
assert.match(newtab, /startTabGateOverlay[\s\S]*onboarding/);
assert.match(newtab, /!savedSettings\.startTab\.enabled[\s\S]*document\.getElementById\("startTabGateOverlay"\)/,
  "Onboarding must never stack over a disabled or Split View gate");

assert.match(options, /function confirmDataRestore/);
for (const restoreCall of ["restorePreImportBackup", "restoreChromeSyncBackup", "restoreDriveBackup", "importBackup"]) {
  const position = options.indexOf(restoreCall);
  assert.ok(position >= 0, `Missing restore path: ${restoreCall}`);
}
assert.ok((options.match(/confirmDataRestore\(\)/g) ?? []).length >= 5,
  "Every direct destructive restore/import surface must require confirmation");
for (const catalog of [en, ru]) {
  assert.match(catalog, /"statisticsUnavailable"/);
  assert.match(catalog, /"restoreDataConfirm"/);
}

for (const command of ["node scripts/run-round36-fixtures.mjs", "node scripts/validate-round36-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test must include ${command}`);
  assert.ok(workflow.includes(command), `CI must include ${command}`);
  assert.ok(selfHosted.includes(command), `Self-hosted CI validation must include ${command}`);
}
for (const phrase of [
  "preset from free layout",
  "ordinary Open Start Tab",
  "explicit Russian locale",
  "keyboard focus remains inside",
  "restore/import action asks for confirmation",
]) assert.ok(manualQa.includes(phrase), `Manual QA is missing: ${phrase}`);
assert.ok(audit.includes("Browser Sync upload"));
assert.ok(audit.includes("gate readiness"));

console.log("Round 36 static validation passed");
