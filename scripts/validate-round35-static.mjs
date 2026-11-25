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
const blockedHtml = read("src/blocked/blocked.html");
const clockGate = read("src/newtab/clock-request-gate.ts");
const worker = read("src/service-worker.ts");
const localeReport = read("scripts/report-locale-parity.mjs");
const localeValidation = read("scripts/locale-catalog-validation.mjs");
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
assert.match(gate, /toggleAttribute\("inert",/);
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

assert.match(runtimeRenderer, /const submissions = taskForms\.get\(block\.id\)/);
assert.match(runtimeRenderer, /!title \|\| !submissions\.begin\(\)/);
assert.match(runtimeRenderer, /submissions\.acknowledge\(submittedDraft\)/);
assert.match(runtimeRenderer, /submissions\.view = redraw/);
assert.match(runtimeRenderer, /if \(submissions\.view !== redraw\) return/);
assert.match(newtab, /input\[data-widget-draft\][\s\S]*setSelectionRange/);
assert.match(newtab, /if \(!editor\.isActive\) \{[\s\S]*pruneTaskForms[\s\S]*pruneLinkPages/);
assert.match(runtimeRenderer, /const settle = \(\): void => \{\s*submissions\.finish\(\)/);
assert.match(runtimeRenderer, /finally\(\(\) => \{\s*settle\(\)/);
assert.doesNotMatch(runtimeRenderer, /context\.runtime\.tasks\[block\.id\] = cloneTasks/);
assert.match(runtimeRenderer, /submissions\.view !== redraw \|\| !submissions\.begin\(\)/);
assert.match(runtimeRenderer, /checkbox\.disabled = pending/);
const links76 = read("src/newtab/block-renderers-static.ts");
assert.doesNotMatch(links76, /context\.runtime\.linkPages\[block\.id\] = page/);
assert.match(links76, /session\.view !== draw \|\| !session\.begin\(\)/);
assert.match(links76, /session\.committed\.observe\(ack\.savedLinkPage, ack\.runtimeUpdatedAt\)/);
assert.match(runtimeRenderer, /Math\.ceil\(value \/ 1000\) \* 1000/);
assert.match(runtimeRenderer, /const clockRequests = new ClockRequestGate\(\)/);
assert.match(runtimeRenderer, /clockRequests\.begin\(block\.id, token\)[\s\S]*await refreshClock\(block, context\)[\s\S]*clockRequests\.finish\(lease\)/);
assert.match(runtimeRenderer, /clockRequests\.canComplete\(block\.id, clock\.completionToken\)/);
assert.match(clockGate, /retryAt: this\.now\(\) \+ this\.retryDelayMs/);
assert.match(newtab, /pageshow[\s\S]*event\.persisted && disposed[\s\S]*location\.reload\(\)/);
assert.match(blocked, /deadline = performance\.now\(\) \+ WAIT_SECONDS \* 1000/);
assert.match(blocked, /remainingCountdownSeconds\(deadline, performance\.now\(\)\)/);
assert.match(blocked, /function showUnblockFailed[\s\S]*errorEl\.hidden = false[\s\S]*countdownEl\.hidden = true/);
assert.match(blockedHtml, /id="unblockError" role="alert"/);
assert.match(blocked, /pageshow[\s\S]*event\.persisted[\s\S]*location\.reload\(\)/);

assert.match(localeReport, /buildLocaleParityReport/,
  "The locale report must delegate catalog enumeration to the shared validator");
assert.match(localeValidation, /readdir\(directory\)/);
assert.match(localeValidation, /filter\(\(file\) => file\.endsWith\("\.json"\)\)/,
  "Locale parity must cover every catalog loaded by the runtime");
assert.match(localeReport, /duplicateEnglishKeys/);
assert.match(localeReport, /duplicateRussianKeys/);
assert.match(localeValidation, /duplicateKeys/,
  "The extracted locale validator must preserve duplicate-key detection");
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

assert.match(options, /generalDraft\.state\.mayReplace\(/);
assert.match(options, /window\.addEventListener\("beforeunload"[\s\S]*generalDraft\?\.state\.isDirty/);
assert.match(options, /render\(savingGeneral \|\| Boolean\(generalDraft\?\.state\.isDirty\(generalDraft\.signature\(\)\)\)\)/,
  "A failed unrelated action must retain a dirty General draft");
assert.match(options, /preserveGeneral && generalDraft \? generalDraft\.root : renderGeneral\(\)/);
assert.match(options, /expectedSettingsUpdatedAt: baseSettings\.updatedAt/);
assert.match(options, /expectedRuntimeUpdatedAt: baseRuntimeUpdatedAt/);
assert.match(options, /createCustomThemeDraft\(settings,[\s\S]*saveNewCustomTheme\(edited\)/);
assert.match(options, /const \{ settings: nextSettings, runtime: nextRuntime, localePreference: nextLocale \} = await getStartPageViewSnapshot\(\);[\s\S]*const nextSites = await getBlockedSites\(\);[\s\S]*settings = nextSettings/);
assert.doesNotMatch(options, /await getLocalePreference\(\)/, "Options must not independently read the locale after releasing the layout lock");
assert.match(runtime, /const stored = await chrome\.storage\.local\.get\(\[START_PAGE_SETTINGS_KEY, START_PAGE_RUNTIME_KEY, LEGACY_INSTANCE_RUNTIME_KEY, LOCALE_OVERRIDE_KEY\]\)/);
assert.match(runtime, /return \{ settings, runtime, localePreference: localePreferenceFromStored\(stored\[LOCALE_OVERRIDE_KEY\]\) \}/);

const themeEditor69 = read("src/lib/theme-editor.ts");
const formCache69 = read("src/lib/form-panel-cache.ts");
assert.match(themeEditor69, /backgroundPanels\.show\(kind\.value, dynamic, createBackgroundPanel\)/);
assert.match(themeEditor69, /effectPanels\.show\(effect\.value, effectFields, createEffectPanel\)/);
assert.match(formCache69, /host\.replaceChildren\(\.\.\.existing\.nodes\)/);
for (const source of [editor, themeEditor69, options]) {
  assert.match(source, /return parseNumberField\(input\.value, fallback\)/);
}

const taskGate82 = read("src/newtab/task-submission-gate.ts");
assert.match(taskGate82, /submittedDraft\.generation !== this\.draftGeneration/);
assert.match(runtimeRenderer, /const submittedDraft = submissions\.snapshotDraft\(\)/);

assert.match(taskGate82, /!retained\.has\(id\) && !session\.pending && !session\.draft/);
assert.match(newtab, /renderHiddenTextDrafts\(hiddenTextHost,[\s\S]*hiddenTaskDrafts[\s\S]*hiddenSearchDrafts/);
assert.doesNotMatch(newtab, /pruneSearchDrafts/);

for (const renderer87 of [runtimeRenderer, links76]) {
  assert.match(renderer87, /await context\.setRuntime\([\s\S]*await refreshAfterAcknowledgedRuntimeWrite\(/);
  assert.match(renderer87, /runtimeSavedRefreshFailed/);
}

assert.match(runtimeRenderer, /submissions\.committed\.observe\(ack\.savedTasks, ack\.runtimeUpdatedAt\)/);
assert.match(runtimeRenderer, /ack\.runtimeUpdatedAt !== undefined && Array\.isArray\(ack\.savedTasks\)/);
assert.match(links76, /ack\.runtimeUpdatedAt !== undefined && ack\.savedLinkPage !== undefined/);

assert.match(newtab, /async function reconcileCommittedLocale\(\): Promise<boolean>/);
assert.match(newtab, /runUiTask\(reconcileCommittedLocale\)/);
const init102 = newtab.slice(newtab.indexOf("async function init()"));
assert.match(init102, /chrome\.storage\.onChanged\.addListener\(handleStorageChange\)[\s\S]*await refreshState\(\);[\s\S]*await reconcileCommittedLocale\(\)[\s\S]*render\(\);/,
  "Subscribe before the startup state and locale catch-up so initialization cannot miss earlier committed changes");

const commands105 = read("src/newtab/block-renderers-integrations.ts");
const commandGate105 = read("src/newtab/command-action-gate.ts");
assert.match(commands105, /const destructiveCommands = new CommandActionGate\(\)/);
assert.match(commands105, /if \(!button\.isConnected\) return;[\s\S]*destructiveCommands\.run/);
assert.match(commands105, /context\.registerCleanup\(unsubscribe\)/);
assert.match(commands105, /resetCommandButton\("reset-clocks"/);
assert.match(commands105, /resetCommandButton\("reset-stats"/);
assert.doesNotMatch(commands105, /getStartPageRuntimeState/);
assert.match(commandGate105, /await mutate\(\);\s*\} finally \{[\s\S]*refresh\(\);/);

assert.match(worker, /case "complete-clock": return runRuntimeJob\(\(\) => finishClockCompletion/);
assert.match(worker, /const result = await completeClockInstance[\s\S]*catch \(error\) \{[\s\S]*return \{ notificationFailed: true \}/);
assert.match(runtimeRenderer, /if \(ack\.notificationFailed\) context\.reportError\(new Error\(context\.i18n\.t\("clockCompletedNotificationFailed"\)\)\)/);
for (const locale108 of ["en", "ru"]) {
  assert.ok(JSON.parse(read("src/_locales/" + locale108 + "/round7-messages.json")).clockCompletedNotificationFailed.message);
}
