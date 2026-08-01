import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const nativeTab = read("src/lib/native-new-tab.ts");
const navigation = read("src/lib/tab-navigation-change.ts");
const worker = read("src/service-worker.ts");
const gate = read("src/newtab/newtab-gate.js");
const popup = read("src/popup/popup.ts");
const popupTarget = read("src/popup/popup-target.ts");
const en = JSON.parse(read("src/_locales/en/round7-messages.json"));
const ru = JSON.parse(read("src/_locales/ru/round7-messages.json"));
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");
const selfHosted = read("scripts/validate-self-hosted-ci.mjs");
const manualQa = read("docs/manual-qa-round41.md");
const audit = read("docs/audit-2026-08-01-round-41.md");

assert.match(nativeTab, /consumedAt\?: number/);
assert.match(nativeTab, /typeof value\.consumedAt === "number"/);
assert.match(nativeTab, /\[NATIVE_NEW_TAB_BYPASS_KEY\]: \{ \.\.\.value, consumedAt: Date\.now\(\) \}/);
assert.doesNotMatch(nativeTab, /if \(value\.tabId === tabId\) await chrome\.storage\.local\.remove/,
  "A consumed native-tab bypass must remain valid for repeated URL events during its lease");

assert.match(navigation, /typeof changeInfo\.url === "string"/);
assert.match(worker, /changedTabNavigationUrl\(changeInfo\)/);
assert.match(worker, /if \(!url\) return/);
assert.doesNotMatch(worker, /changeInfo\.url \?\? tab\.url/,
  "Non-navigation tab updates must not re-run the native new-tab fallback");

assert.match(gate, /let catalogLoadGeneration = 0/);
assert.match(gate, /let applyGeneration = 0/);
assert.match(gate, /generation !== catalogLoadGeneration/);
assert.match(gate, /generation !== applyGeneration/);
assert.match(gate, /chrome\.storage\.onChanged\.addListener[\s\S]*if \(await loadGateCatalog\(\)\) await apply\(\)/,
  "The gate change listener must be registered before the initial asynchronous catalog load");
assert.match(gate, /loadGateCatalog\(\)\.then\(\(current\) => current \? apply\(\) : undefined\)/);
assert.match(gate, /if \(generation === applyGeneration\) window\.dispatchEvent/);

assert.match(popupTarget, /current\.tabId === expected\.tabId/);
assert.match(popupTarget, /current\.host === expected\.host/);
assert.match(popupTarget, /current\.blockedHost === expected\.blockedHost/);
assert.match(popup, /let actionPending = true/);
assert.match(popup, /let renderGeneration = 0/);
assert.match(popup, /const generation = \+\+renderGeneration/);
assert.match(popup, /const current = await getActiveTarget\(\);[\s\S]*samePopupTarget\(expected, current\)/);
assert.match(popup, /setActionPending\(true\)[\s\S]*finally \{[\s\S]*setActionPending\(false\)/);
assert.match(popup, /i18n\.t\("currentSiteChanged"\)/);
assert.equal(en.currentSiteChanged?.message, "The active tab changed. Review the current site and try again.");
assert.equal(ru.currentSiteChanged?.message, "Активная вкладка изменилась. Проверьте текущий сайт и повторите действие.");

for (const command of ["node scripts/run-round41-fixtures.mjs", "node scripts/validate-round41-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test must include ${command}`);
  assert.ok(workflow.includes(command), `CI must include ${command}`);
  assert.ok(selfHosted.includes(command), `Self-hosted contract must include ${command}`);
}
for (const phrase of ["native new tab", "status-only", "locale", "active tab", "block state"]) {
  assert.ok(manualQa.toLowerCase().includes(phrase), `Round 41 manual QA is missing: ${phrase}`);
}
for (const phrase of ["267 tracked files", "native-new-tab", "generation", "popup", "validation boundary"]) {
  assert.ok(audit.toLowerCase().includes(phrase.toLowerCase()), `Round 41 audit is missing: ${phrase}`);
}

console.log("Round 41 static validation passed");
