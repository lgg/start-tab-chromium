import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const nativeTab = await readFile("src/lib/native-new-tab.ts", "utf8");
const gate = await readFile("src/newtab/newtab-gate.js", "utf8");
const en = await readFile("src/_locales/en/round7-messages.json", "utf8");
const ru = await readFile("src/_locales/ru/round7-messages.json", "utf8");
const fixtures = await readFile("scripts/round51-fixtures.ts", "utf8");
const runner = await readFile("scripts/run-round51-fixtures.mjs", "utf8");
const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const selfHosted = await readFile("scripts/validate-self-hosted-ci.mjs", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const audit = await readFile("docs/audit-2026-08-11-round-51.md", "utf8");
const manualQa = await readFile("docs/manual-qa-round51.md", "utf8");

assert.match(nativeTab, /import \{ withStorageLock \} from "\.\/storage-lock\.js"/,
  "Native new-tab grant read-modify-write operations must share the cross-context storage lock");
assert.match(nativeTab, /const NATIVE_NEW_TAB_BYPASS_LOCK = "native-new-tab-bypass"/);
assert.match(nativeTab, /async function waitForNativeBypassConsumption\([\s\S]*tabId: number,[\s\S]*expiresAt: number,[\s\S]*pollIntervalMs: number/,
  "The poller must use the grant's absolute expiry instead of starting a second timeout after navigation");
assert.match(nativeTab, /value\?\.tabId !== tabId \|\| value\.expiresAt !== expiresAt\) return false/,
  "Missing, foreign, or replaced bypass ownership must fail closed");
assert.match(nativeTab, /typeof value\.consumedAt === "number"\) return true/,
  "Only explicit consumption of the exact grant may acknowledge native-new-tab success");
assert.match(nativeTab,
  /async function writeOwnedBypass\(tabId: number, timeoutMs: number\): Promise<number> \{[\s\S]*withStorageLock\(NATIVE_NEW_TAB_BYPASS_LOCK[\s\S]*const expiresAt = Date\.now\(\) \+ timeoutMs;[\s\S]*return expiresAt/,
  "A retry must start its expiry only after acquiring the grant lock, not while queued behind an older consumer");
assert.match(nativeTab,
  /const expiresAt = await writeOwnedBypass\(tabId, timeoutMs\);[\s\S]*chrome\.tabs\.update\(tabId, \{ url \}\)[\s\S]*waitForNativeBypassConsumption\(tabId, expiresAt, pollIntervalMs\)/,
  "The published grant's exact expiry must follow the attempt through navigation and polling");
assert.match(nativeTab, /async function removeOwnedBypass[\s\S]*withStorageLock\(NATIVE_NEW_TAB_BYPASS_LOCK/);

const consumeIndex = nativeTab.indexOf("export async function consumeNativeNewTabBypass");
assert.ok(consumeIndex >= 0, "Missing native new-tab bypass consumer");
const consumeSource = nativeTab.slice(consumeIndex);
assert.match(consumeSource, /return withStorageLock\(NATIVE_NEW_TAB_BYPASS_LOCK/,
  "Bypass consumption must serialize its read and consumedAt write with retries");
assert.match(consumeSource, /value\.expiresAt <= Date\.now\(\)\) return false/,
  "A grant expiring at the current instant must already be invalid");
assert.doesNotMatch(consumeSource, /storage\.local\.remove/,
  "Consumers must not delete a shared expired grant after a stale read");

assert.match(gate, /const nativeActionGenerations = new WeakMap\(\)/,
  "Rapid native-tab requests need a per-button result generation guard");
assert.match(gate, /async function runNative\(button\)/);
assert.match(gate, /status\.setAttribute\("role", "alert"\)/,
  "Native-tab failures must be exposed as an accessible visible alert");
assert.match(gate, /nativeActionGenerations\.get\(button\) !== generation\) return/,
  "An older failure must not overwrite the visible result of a newer request");
assert.match(gate, /text\("nativeNewTabFailed", "Couldn't open the browser's native new tab\. Try again\."\)/);
assert.ok((gate.match(/run\(\(\) => runNative\(/g) ?? []).length >= 2,
  "Both static and overlay native-new-tab buttons must use visible failure handling");
for (const catalog of [en, ru]) {
  assert.match(catalog, /"nativeNewTabFailed"/,
    "Every supported locale must contain the native-new-tab failure message");
}

for (const marker of [
  "Expiry before tabs.update settles must fail closed",
  "A disappeared bypass key must not be mistaken for consumption",
  "A bypass owned by another tab must not acknowledge this opener",
  "An expired consumer must not delete the shared bypass key",
  "A late first-attempt consumer must not overwrite the second attempt's grant",
]) {
  assert.ok(fixtures.includes(marker), `Round 51 fixture is missing: ${marker}`);
}
assert.match(runner, /entryPoints: \[path\.join\(root, "scripts", "round51-fixtures\.ts"\)\]/);
assert.match(runner, /bundle: true/);
assert.match(runner, /target: "node22"/);

for (const command of [
  "node scripts/run-round51-fixtures.mjs",
  "node scripts/validate-round51-static.mjs",
]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test is missing ${command}`);
  assert.ok(workflow.includes(command), `CI is missing ${command}`);
  assert.ok(selfHosted.includes(command), `Self-hosted CI contract is missing ${command}`);
}
for (const command of [
  "node scripts/run-round50-fixtures.mjs",
  "node scripts/validate-round50-static.mjs",
]) {
  assert.ok(selfHosted.includes(command), `Self-hosted CI contract must retain Round 50 explicitly: ${command}`);
}
assert.ok(
  workflow.indexOf("node scripts/validate-round50-static.mjs")
    < workflow.indexOf("node scripts/run-round51-fixtures.mjs")
    && workflow.indexOf("node scripts/run-round51-fixtures.mjs")
      < workflow.indexOf("node scripts/validate-round51-static.mjs")
    && workflow.indexOf("node scripts/validate-round51-static.mjs")
      < workflow.indexOf("node scripts/validate-self-hosted-ci.mjs"),
  "Round 51 must run explicitly after Round 50 and before the self-hosted CI contract",
);

for (const phrase of ["false success", "expired", "storage lock", "retry", "visible feedback"]) {
  assert.ok(audit.toLowerCase().includes(phrase), `Round 51 audit is missing: ${phrase}`);
}
for (const phrase of ["native new tab", "fallback", "temporary", "rapid", "alert"]) {
  assert.ok(manualQa.toLowerCase().includes(phrase), `Round 51 manual QA is missing: ${phrase}`);
}

console.log("Round 51 static validation passed");
