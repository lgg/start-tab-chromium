import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const blocklist = read("src/lib/blocklist.ts");
const runtime = read("src/lib/start-page-runtime.ts");
const fixtures = read("scripts/round28-fixtures.ts");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");

assert.match(blocklist, /function rulePriorityForHost\(host: string\)[\s\S]*return host\.split\("\."\)\.length;/,
  "DNR priority must use complete label depth so every proper child outranks its parent");
assert.doesNotMatch(blocklist, /Math\.max\(1, host\.split\("\."\)\.length - 1\)/,
  "One-label parents must not tie with their two-label children");

assert.match(runtime, /import \{ runIndependentEffects \} from "\.\/independent-effects\.js";/,
  "Runtime rollback must use the shared independent-effects helper");
assert.match(runtime, /restoreStorageKeysSnapshot[\s\S]*runIndependentEffects\(effects, "Start Tab runtime storage rollback was incomplete"\)/,
  "Runtime storage rollback must attempt removals and snapshot writes independently");
assert.match(runtime, /rollbackEffects[\s\S]*restoreStorageKeysSnapshot[\s\S]*restoreClockAlarmSnapshot[\s\S]*runIndependentEffects/,
  "Clock runtime rollback must attempt storage and alarm restoration independently");
assert.match(runtime, /Start Tab runtime reset rollback was incomplete/,
  "Runtime reset must preserve independent storage/alarm rollback");
assert.match(runtime, /Start Tab data reset rollback was incomplete/,
  "Complete Start Tab reset must preserve independent storage/alarm rollback");
assert.match(runtime, /Clock alarm snapshot cleanup was incomplete/,
  "Alarm snapshot restoration must attempt every relevant clear");
assert.match(runtime, /Clock alarm snapshot recreation was incomplete/,
  "Alarm snapshot restoration must attempt every snapshot recreation");
assert.match(runtime, /Clock alarm snapshot restoration was incomplete/,
  "Alarm snapshot restoration must aggregate cleanup and recreation failures");
assert.match(runtime, /async function clearClockAlarms\(\)[\s\S]*Clock alarm cleanup was incomplete/,
  "Primary alarm cleanup must wait for every clear before rollback begins");
assert.match(runtime, /Clock alarm reconciliation cleanup was incomplete/,
  "Alarm reconciliation must wait for every obsolete-alarm clear");
assert.match(runtime, /Clock instance alarm cleanup was incomplete/,
  "Per-instance alarm cleanup must wait for every matching clear");
assert.doesNotMatch(runtime, /Promise\.all\(alarms[\s\S]{0,220}chrome\.alarms\.clear/,
  "Alarm cleanup must not reject while sibling clear promises continue in the background");

for (const marker of [
  "A two-label child must have strictly higher DNR priority than its one-label parent",
  "Snapshot set must still run after removal of an absent runtime key fails",
  "Alarm restoration must still run after storage rollback fails",
  "Every existing Start Tab alarm must receive a clear attempt",
  "Every snapshot alarm must receive a create attempt even after an earlier failure",
  "Alarm rollback must not touch unrelated extension alarms",
  "No late primary clear may delete alarms recreated by rollback",
]) {
  assert.ok(fixtures.includes(marker), `Round 28 fixture is missing: ${marker}`);
}

for (const command of ["node scripts/run-round28-fixtures.mjs", "node scripts/validate-round28-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test is missing ${command}`);
  assert.ok(workflow.includes(command), `CI is missing ${command}`);
}

console.log("Round 28 static validation passed");
