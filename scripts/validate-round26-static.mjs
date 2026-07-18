import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const blocklist = read("src/lib/blocklist.ts");
const fixtures = read("scripts/round26-fixtures.ts");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");

assert.match(blocklist, /Object\.prototype\.hasOwnProperty\.call\(items, LEGACY_STORAGE_KEY\)/,
  "Legacy migration must distinguish an absent key from an empty or malformed legacy value");
assert.match(blocklist, /finally \{\s*if \(migrationPromise === migration\) migrationPromise = undefined;/,
  "A completed legacy migration must release its cached promise so later legacy state can be repaired");
assert.match(blocklist, /if \(!storedSitesEqual\(items\[STORAGE_KEY\], normalized\)\)/,
  "Legacy cleanup must avoid rewriting an already canonical current blocklist");
assert.match(blocklist, /lastBlockedUrlsForSites/,
  "Live remembered-navigation metadata must be correlated with active blocked sites");
assert.match(blocklist, /const nextUrls = normalizedUrls === null \? null : lastBlockedUrlsForSites\(normalizedUrls, nextSites\)/,
  "Every transactional blocklist mutation must remove metadata for no-longer-blocked sites");
assert.match(blocklist, /const urls = lastBlockedUrlsForSites\(storedUrls, sites\)/,
  "Auxiliary remembered-URL operations must canonicalize against the current blocklist");
assert.doesNotMatch(blocklist, /if \(!sites\.includes\(normalized\)\) return false;/,
  "A no-op unblock must still reach derived DNR reconciliation");
assert.match(blocklist, /let changed = false;[\s\S]*await applyBlocklistMutation[\s\S]*return changed;/,
  "Unblock must report durable change separately from DNR-only repair");

assert.match(workflow, /uses: actions\/checkout@v6[\s\S]*clean: false/,
  "Checkout must not perform an unbounded git clean before checked-in path safety is available");
assert.doesNotMatch(workflow, /clean: true/,
  "The workflow must not re-enable checkout's broad workspace clean");
assert.equal((workflow.match(/run: node scripts\/clean-ci\.mjs/g) ?? []).length, 2,
  "Known project outputs must still be cleaned before validation and in the final always step");

for (const marker of [
  "A no-op unblock must remove an extra stale DNR rule",
  "Failed legacy migration must restore the exact blocklist and revision snapshot",
  "A legacy key introduced after an earlier successful pass must still be migrated",
  "An empty legacy blocklist key must be removed instead of cached forever",
  "An identical remembered URL must still remove metadata for no-longer-blocked sites",
]) {
  assert.ok(fixtures.includes(marker), `Round 26 fixture is missing: ${marker}`);
}

for (const command of ["node scripts/run-round26-fixtures.mjs", "node scripts/validate-round26-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test is missing ${command}`);
  assert.ok(workflow.includes(command), `CI is missing ${command}`);
}

console.log("Round 26 static validation passed");
