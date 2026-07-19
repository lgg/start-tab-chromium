import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const blocklist = read("src/lib/blocklist.ts");
const worker = read("src/service-worker.ts");
const backup = read("src/lib/backup.ts");
const revision = read("src/lib/data-revision.ts");
const fixtures = read("scripts/round27-fixtures.ts");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");

assert.match(blocklist, /function matchingBlockedSite\(/,
  "Overlapping blocked domains must use an explicit most-specific matcher");
assert.match(blocklist, /site\.length > match\.length/,
  "The most-specific blocked suffix must win independently of storage order");
assert.match(blocklist, /function rulePriorityForHost\(host: string\)/,
  "DNR generation must define an explicit domain-specificity priority");
assert.match(blocklist, /Math\.max\(1, host\.split\("\."\)\.length - 1\)/,
  "Every additional subdomain label must raise DNR priority");
assert.match(blocklist, /priority: rulePriorityForHost\(host\)/,
  "Every generated redirect rule must use its domain-specificity priority");
assert.doesNotMatch(blocklist, /excludedRequestDomains/,
  "Specificity must not create growing nested-domain exclusion arrays");
assert.match(blocklist, /rememberBlockedNavigation\(url: string\): Promise<string \| null>/,
  "Remembered navigation must return its atomically selected blocked site");
assert.match(worker, /const host = await rememberBlockedNavigation\(url\);/,
  "The worker must use the site returned by the locked remember operation");
assert.doesNotMatch(worker, /blockedSiteForUrl/,
  "The worker must not perform a separate pre-match before remembered URL persistence");

for (const marker of [
  "readDynamicRulesSnapshot",
  "restoreDynamicRulesSnapshot",
  "restoreBlocklistTransaction",
]) {
  assert.ok(blocklist.includes(marker), `Blocklist exact-DNR rollback marker is missing: ${marker}`);
}
assert.match(blocklist, /const originalRules = await readDynamicRulesSnapshot\(\)/,
  "Every blocklist transaction must snapshot exact pre-mutation DNR state");
assert.match(blocklist, /runIndependentEffects\(\[\s*\(\) => restoreBlocklistStorage[\s\S]*restoreDynamicRulesSnapshot/,
  "Storage failure must not skip exact DNR rollback");

assert.match(backup, /const currentRules = await readDynamicRulesSnapshot\(\)/,
  "Backup import must snapshot exact DNR state before mutation");
assert.match(backup, /runIndependentEffects\(\[[\s\S]*restoreStorageSnapshot\(current\)[\s\S]*restoreDynamicRulesSnapshot\(currentRules\)[\s\S]*restoreClockAlarmSnapshot\(currentAlarms\)/,
  "Backup rollback must attempt storage, exact DNR, and alarm restoration independently");
assert.match(revision, /runIndependentEffects\(effects, "Revisioned storage rollback was incomplete"\)/,
  "Revisioned storage rollback must attempt absent-key removal and snapshot writes independently");

for (const marker of [
  "A blocked child domain must have higher DNR priority than its blocked parent",
  "Failed blocklist mutation must restore the exact original DNR snapshot",
  "DNR rollback must still run after storage rollback fails",
  "Snapshot set must still run when removal of an absent-at-snapshot key fails",
  "Backup failure must restore exact original DNR rules",
]) {
  assert.ok(fixtures.includes(marker), `Round 27 fixture is missing: ${marker}`);
}

for (const command of ["node scripts/run-round27-fixtures.mjs", "node scripts/validate-round27-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test is missing ${command}`);
  assert.ok(workflow.includes(command), `CI is missing ${command}`);
}

console.log("Round 27 static validation passed");
