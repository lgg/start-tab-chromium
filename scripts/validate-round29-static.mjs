import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const blocklist = read("src/lib/blocklist.ts");
const runtime = read("src/lib/start-page-runtime.ts");
const google = read("src/lib/google-integration.ts");
const fixtures = read("scripts/round29-fixtures.ts");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");

assert.match(blocklist, /function isBlocklistDynamicRule\(rule: chrome\.declarativeNetRequest\.Rule\)/,
  "Blocklist DNR synchronization must define an explicit ownership predicate");
assert.match(blocklist, /function blocklistDynamicRules\([\s\S]*rules\.filter\(isBlocklistDynamicRule\)/,
  "Blocklist snapshots must contain only blocklist-owned dynamic rules");
assert.match(blocklist, /const allCurrentRules = await chrome\.declarativeNetRequest\.getDynamicRules\(\);/,
  "DNR replacement must inspect the complete current rule set before mutating it");
assert.match(blocklist, /foreignRuleIds[\s\S]*conflicts with a dynamic rule owned by another Start Tab feature/,
  "DNR replacement must reject foreign rule-ID collisions before mutation");
assert.match(blocklist, /removeRuleIds: currentRules\.map\(\(rule\) => rule\.id\)/,
  "DNR replacement may remove only currently owned blocklist rules");

assert.match(runtime, /deleteInstanceRuntime\(instanceId: string\)[\s\S]*runIndependentEffects\(\[[\s\S]*restoreStorageKeysSnapshot\(previous, RUNTIME_STORAGE_KEYS\)[\s\S]*restoreClockAlarmSnapshot\(previousAlarms\)[\s\S]*Instance runtime storage\/alarm rollback was incomplete/,
  "Instance deletion must restore storage and alarms independently");

assert.match(google, /const timeMin = new Date\(\)\.toISOString\(\);[\s\S]*while \(events\.length < limit/,
  "Calendar pagination must capture one stable lower bound before requesting pages");
assert.match(google, /url\.searchParams\.set\("timeMin", timeMin\);/,
  "Every Calendar page must reuse the same timeMin query parameter");
assert.doesNotMatch(google, /while \(events\.length < limit[\s\S]{0,900}url\.searchParams\.set\("timeMin", new Date\(\)\.toISOString\(\)\)/,
  "Calendar page tokens must not be combined with a newly generated timeMin");

for (const marker of [
  "Blocklist synchronization must preserve unrelated dynamic rules",
  "Low-ID foreign rules must not block blocklist synchronization",
  "Alarm rollback must still run after instance storage rollback fails",
  "Every page of one Calendar query must reuse the exact same timeMin",
]) {
  assert.ok(fixtures.includes(marker), `Round 29 fixture is missing: ${marker}`);
}

for (const command of ["node scripts/run-round29-fixtures.mjs", "node scripts/validate-round29-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test is missing ${command}`);
  assert.ok(workflow.includes(command), `CI is missing ${command}`);
}

console.log("Round 29 static validation passed");
