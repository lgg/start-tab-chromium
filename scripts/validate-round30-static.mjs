import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const blocklist = read("src/lib/blocklist.ts");
const google = read("src/lib/google-integration.ts");
const round29Fixtures = read("scripts/round29-fixtures.ts");
const round30Fixtures = read("scripts/round30-fixtures.ts");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");
const selfHostedValidation = read("scripts/validate-self-hosted-ci.mjs");

assert.match(blocklist, /export const BLOCKLIST_RULE_ID_BASE = 1_000_000;/,
  "Blocklist rules must use a documented dedicated dynamic-rule ID namespace");
assert.match(blocklist, /id: BLOCKLIST_RULE_ID_BASE \+ index/,
  "Every generated blocklist rule must use the dedicated namespace");
assert.match(blocklist, /function isNamespacedBlocklistRuleId\(id: number\)/,
  "DNR ownership must recognize the reserved blocklist ID range");
assert.match(blocklist, /function isLegacyBlocklistDynamicRule\(rule: chrome\.declarativeNetRequest\.Rule\)/,
  "DNR ownership must retain a bounded migration path for exact legacy redirects");
assert.match(blocklist, /isNamespacedBlocklistRuleId\(rule\.id\) \|\| isLegacyBlocklistDynamicRule\(rule\)/,
  "DNR snapshots must combine namespaced ownership with exact legacy migration");
assert.match(blocklist, /function assertDynamicRuleCapacity\(/,
  "Shared dynamic-rule capacity must be validated explicitly");
assert.match(blocklist, /MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES/,
  "Unsafe dynamic-rule capacity must use Chrome's runtime limit when exposed");
assert.match(blocklist, /unsafe dynamic-rule capacity/,
  "Capacity rejection must explain the shared unsafe-rule limit");
assert.ok(blocklist.indexOf("assertDynamicRuleCapacity(foreignRules, rules)")
  < blocklist.indexOf("updateDynamicRules({"),
"Capacity validation must happen before the atomic DNR mutation");

assert.match(google, /if \(!nextPageToken \|\| seenPageTokens\.has\(nextPageToken\)\) break;/,
  "Calendar pagination must follow any non-empty nextPageToken regardless of q");
assert.doesNotMatch(google, /if \(!normalizedQuery \|\| !nextPageToken/,
  "A missing search query must not be treated as proof that the first page is complete");

assert.ok(round29Fixtures.includes("Low-ID foreign rules must not block blocklist synchronization"),
  "Round 29 regression coverage must be superseded by successful low-ID coexistence");
for (const marker of [
  "Low-ID foreign rules must survive blocklist synchronization",
  "Legacy low-ID blocklist rules must be removed during namespace migration",
  "Capacity rejection must happen before updateDynamicRules",
  "Calendar pagination without a search query must follow an incomplete page token",
]) {
  assert.ok(round30Fixtures.includes(marker), `Round 30 fixture is missing: ${marker}`);
}

for (const command of [
  "node scripts/run-round27-fixtures.mjs",
  "node scripts/validate-round27-static.mjs",
  "node scripts/run-round28-fixtures.mjs",
  "node scripts/validate-round28-static.mjs",
  "node scripts/run-round29-fixtures.mjs",
  "node scripts/validate-round29-static.mjs",
  "node scripts/run-round30-fixtures.mjs",
  "node scripts/validate-round30-static.mjs",
]) {
  assert.ok(selfHostedValidation.includes(command), `Self-hosted CI contract is missing ${command}`);
}

for (const command of ["node scripts/run-round30-fixtures.mjs", "node scripts/validate-round30-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test is missing ${command}`);
  assert.ok(workflow.includes(command), `CI is missing ${command}`);
}

console.log("Round 30 static validation passed");
