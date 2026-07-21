import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const blocklist = read("src/lib/blocklist.ts");
const chromeSync = read("src/lib/chrome-sync.ts");
const fixtures = read("scripts/round31-fixtures.ts");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");
const selfHostedValidation = read("scripts/validate-self-hosted-ci.mjs");

assert.match(blocklist, /const BLOCKLIST_RULE_OWNER_VALUE = "start-tab-blocklist-v1";/,
  "Current DNR rules must carry an explicit ownership version");
assert.match(blocklist, /owner=\$\{BLOCKLIST_RULE_OWNER_VALUE\}/,
  "Generated redirect URLs must include the ownership marker");
assert.match(blocklist, /function parseBlocklistDynamicRule\(rule: chrome\.declarativeNetRequest\.Rule\)/,
  "DNR ownership must be parsed from a bounded rule shape");
assert.match(blocklist, /conditionKeys[\s\S]*requestDomains[\s\S]*resourceTypes/,
  "Ownership must require the exact generated condition shape");
assert.match(blocklist, /parameterCount === 1[\s\S]*parameterCount === 2/,
  "Ownership must distinguish exact legacy and current query shapes");
assert.match(blocklist, /class DynamicRuleCollisionError extends Error/,
  "Transient foreign-ID collisions must have a dedicated retryable error");
assert.match(blocklist, /const MAX_DNR_RECONCILE_ATTEMPTS = 4;/,
  "DNR collision reconciliation must be explicitly bounded");
assert.match(blocklist, /for \(let attempt = 0; attempt < MAX_DNR_RECONCILE_ATTEMPTS; attempt \+= 1\)/,
  "DNR replacement must retry allocation after a transient collision");
assert.match(blocklist, /error instanceof DynamicRuleCollisionError/,
  "Only ownership collisions may trigger the bounded retry path");

assert.match(chromeSync, /export function completeChromeSyncPayload\(/,
  "Browser Sync must expose one canonical complete-frame constructor");
assert.match(chromeSync, /for \(let index = 0; index < MAX_SYNC_CHUNKS; index \+= 1\)/,
  "The committed Browser Sync frame must include every canonical chunk slot");
assert.match(chromeSync, /payload\[chunkKey\(index\)\] = chunks\[index\] \?\? "";/,
  "Inactive Browser Sync slots must be overwritten with empty values");
assert.match(chromeSync, /const payload = completeChromeSyncPayload\(meta, snapshot\.chunks\);/,
  "Remote uploads must use the complete frame");
assert.doesNotMatch(chromeSync, /staleRemovedBeforeWrite|chrome\.storage\.sync\.remove\(staleKeys\)|const staleKeys/,
  "A post-upload stale-key removal must never race and corrupt another device snapshot");

for (const marker of [
  "A same-page foreign redirect must survive blocklist synchronization",
  "Exact legacy blocklist rules must migrate to explicit ownership",
  "A transient foreign-ID collision must be retried before the DNR update",
  "Every Browser Sync upload must contain all canonical chunk slots",
]) {
  assert.ok(fixtures.includes(marker), `Round 31 fixture is missing: ${marker}`);
}

for (const command of ["node scripts/run-round31-fixtures.mjs", "node scripts/validate-round31-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test is missing ${command}`);
  assert.ok(workflow.includes(command), `CI is missing ${command}`);
  assert.ok(selfHostedValidation.includes(command), `Self-hosted CI contract is missing ${command}`);
}

console.log("Round 31 static validation passed");
