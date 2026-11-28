import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const gate = read("src/newtab/newtab-gate.js");
const worker = read("src/service-worker.ts");
const runtimeTarget = read("src/lib/runtime-mutation-target.ts");
const blockEditor = read("src/lib/block-settings-editor.ts");
const themeEditor = read("src/lib/theme-editor.ts");
const dialogGuard = read("src/lib/settings-dialog-guard.ts");
const options = read("src/options/options.ts");
const deferredSection = read("src/options/deferred-section.ts");
const en = JSON.parse(read("src/_locales/en/round7-messages.json"));
const ru = JSON.parse(read("src/_locales/ru/round7-messages.json"));
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");
const selfHosted = read("scripts/validate-self-hosted-ci.mjs");
const manualQa = read("docs/manual-qa-3.0.0.md");
const audit = read("docs/audit-2026-07-31-round-38.md");

for (const file of ["messages.json", "roadmap-messages.json", "round7-messages.json"]) {
  assert.ok(gate.includes(`"${file}"`), `Early gate must merge locale catalog ${file}`);
}
assert.match(gate, /catalog: Object\.assign\(\{\}, \.\.\.catalogs\)[\s\S]*const nextCatalog = preferred\.baseAvailable[\s\S]*generation !== catalogLoadGeneration[\s\S]*catalog = nextCatalog/,
  "The early gate must merge every locale fragment and publish it only if the load is still current");
assert.match(gate, /candidates = await chrome\.tabs\.query\(\{ currentWindow: true \}\);[\s\S]*?catch \{[\s\S]*?if \(pageActive && generation === applyGeneration\) \{[\s\S]*?showOverlay\(text\("splitViewTitle"[\s\S]*?text\("splitViewQueryFailed"[^\n]*, \[\], true\);[\s\S]*?return;/,
  "A Split View query failure must fail closed with a current-generation retry overlay");
assert.doesNotMatch(gate, /chrome\.tabs\.query\(\{ currentWindow: true \}\)\.catch\(\(\) => \[\]\)/,
  "A failed query must not masquerade as an empty list");
assert.match(gate, /function resolvedGateLocale\(override\)[\s\S]*const preference = normalize\(override\);[\s\S]*if \(preference\) return preference;[\s\S]*navigator\.languages[\s\S]*for \(const language of languages\)[\s\S]*if \(supported\) return supported;[\s\S]*return "en";/,
  "Automatic locale selection must resolve the first supported browser language after honoring the normalized explicit preference");
assert.match(gate, /const locale = resolvedGateLocale\(items\[LOCALE_OVERRIDE_KEY\]\)[\s\S]*Promise\.all\(catalogFiles\.map/,
  "Explicit and automatic locale modes must load the same complete fragment set through the latest-only path");
assert.match(gate, /changes\[LOCALE_OVERRIDE_KEY\]/);
assert.match(gate, /loadGateCatalog\(\)\.then\(\(current\) => current \? apply\(\) : undefined\)/,
  "An open gate must refresh only after the latest locale catalog load commits");
assert.match(gate, /return \{ url: value, title: title \|\| value \};/);
assert.match(gate, /button\.textContent = tab\.title;/);
for (const catalog of [en, ru]) {
  for (const key of ["splitViewTitle", "splitViewText", "splitViewQueryFailed", "startTabDisabledTitle", "startTabDisabledText", "gateUntitledTab"]) {
    assert.equal(typeof catalog[key]?.message, "string", `Missing localized early-gate key: ${key}`);
    assert.ok(catalog[key].message.trim(), `Empty localized early-gate key: ${key}`);
  }
}

assert.match(runtimeTarget, /export function assertRuntimeMutationTarget/);
for (const [kind, type] of [["note", "note"], ["tasks", "localTasks"]]) {
  assert.ok(runtimeTarget.includes(`${kind}: ["${type}"]`));
}
assert.match(runtimeTarget, /linkPage: \["links", "startPinned"\]/);
assert.match(runtimeTarget, /candidate\.id === instanceId[\s\S]*allowed\.includes\(block\.type\)/);
assert.ok((worker.match(/assertRuntimeMutationTarget\(settings, instanceId,/g) ?? []).length >= 3,
  "Every Round 38 non-clock per-instance runtime mutation must validate the current block target");
assert.match(worker, /assertRuntimeMutationTarget\(settings, instanceId, "note"\)/);
assert.match(worker, /assertRuntimeMutationTarget\(settings, instanceId, "tasks"\)/);
assert.match(worker, /assertRuntimeMutationTarget\(settings, instanceId, "linkPage"\)/);

assert.match(dialogGuard, /dialog\.settings-dialog\[open\]/);
assert.match(dialogGuard, /nextSettingsDialogTitleId/);
for (const editor of [blockEditor, themeEditor]) {
  assert.match(editor, /if \(focusExistingSettingsDialog\(\)\) return null;/);
  assert.match(editor, /const titleId = nextSettingsDialogTitleId/);
  assert.match(editor, /dialog\.setAttribute\("aria-labelledby", titleId\)/);
  assert.match(editor, /title\.id = titleId/);
}
assert.doesNotMatch(blockEditor, /aria-labelledby", "block-settings-title"/);
assert.doesNotMatch(themeEditor, /aria-labelledby", "theme-editor-title"/);

assert.match(deferredSection, /export function hashTargetsSection/);
assert.equal((options.match(/restoreDeferredSectionAnchor\(/g) ?? []).length, 2,
  "Both successful and failed async Statistics rendering must restore a deep link");
assert.match(options, /sections\.append\(statistics\);\s*restoreDeferredSectionAnchor\(statistics\)/);
assert.match(options, /sections\.append\(failed\.root\);\s*restoreDeferredSectionAnchor\(failed\.root\)/);

for (const command of ["node scripts/run-round38-fixtures.mjs", "node scripts/validate-round38-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test must include ${command}`);
  assert.ok(workflow.includes(command), `CI must include ${command}`);
  assert.ok(selfHosted.includes(command), `Self-hosted contract must include ${command}`);
}
for (const phrase of [
  "locale while the early gate is visible",
  "tabs.query failure",
  "remove the block or change it to another type",
  "Rapidly activate two block or theme editors",
  "Open Options directly with #statistics",
]) assert.ok(manualQa.includes(phrase), `Manual QA is missing: ${phrase}`);
for (const phrase of ["locale catalogs", "fail closed", "stale writes", "settings dialogs", "#statistics"]) {
  assert.ok(audit.includes(phrase), `Round 38 audit report is missing: ${phrase}`);
}

console.log("Round 38 static validation passed");

const locale110 = read("src/lib/i18n.ts");
assert.match(locale110, /return loadI18nForPreference\(await withStorageLock\("data-write", getLocalePreference\)\)/);
assert.match(options, /async function reloadState\(preserveGeneral = false\)[\s\S]*const nextI18n = !i18n \|\| \(!preserveGeneral && i18n\.preference !== nextLocale\)[\s\S]*await loadI18nForPreference\(nextLocale\)[\s\S]*settings = nextSettings[\s\S]*i18n = nextI18n/);
assert.match(options, /async function init\(\): Promise<void> \{\s*await reloadState\(\);\s*render\(\);/);
assert.match(options, /await reloadState\(savingGeneral \|\| Boolean\(generalDraft\?\.state\.isDirty\(generalDraft\.signature\(\)\)\)\)/);
assert.doesNotMatch(options, /location\.reload\(\)/, "Options must rebuild from the committed locale without dropping the page");
