import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const pathSafety = read("scripts/path-safety.mjs");
const buildOutput = read("scripts/build-output-path.mjs");
const cleanCi = read("scripts/clean-ci.mjs");
const clean = read("scripts/clean.mjs");
const blocklist = read("src/lib/blocklist.ts");
const fixtures = read("scripts/round25-fixtures.ts");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");

assert.match(pathSafety, /resolveStrictDescendant/,
  "Shared path safety must enforce a strict cleanup boundary");
assert.match(pathSafety, /lstat/,
  "Shared path safety must inspect links without following them");
assert.match(pathSafety, /intermediate symbolic link or junction/,
  "Intermediate links must be rejected rather than traversed");
assert.match(pathSafety, /await rm\(current, \{ recursive: true, force: true \}\)/,
  "A final link must be removed as the link itself");
assert.match(buildOutput, /assertPathContainsNoLinks/,
  "Builder link validation must reuse the shared path-safety implementation");
assert.match(cleanCi, /removePathWithinBoundary/,
  "CI cleanup must use link-aware bounded removal");
assert.match(cleanCi, /CI_CACHE_ROOT does not match the dedicated runner-temp cache path/,
  "CI cleanup must bind the cache to its exact project-specific location");
assert.match(clean, /removePathWithinBoundary/,
  "Local cleanup must not recurse through generated-directory links");

assert.doesNotMatch(workflow, /Remove-Item[^\n]*-Recurse/,
  "The self-hosted workflow must not use lexical-only recursive PowerShell deletion");
assert.equal((workflow.match(/run: node scripts\/clean-ci\.mjs/g) ?? []).length, 2,
  "The shared safe cleanup must run before validation and in the always() post-step");
assert.ok(workflow.indexOf("uses: actions/checkout@v6") < workflow.indexOf("run: node scripts/clean-ci.mjs"),
  "Checked-in cleanup code can only run after checkout");
assert.ok(workflow.indexOf("uses: actions/setup-node@v6") < workflow.indexOf("run: node scripts/clean-ci.mjs"),
  "Safe Node cleanup must run after the pinned Node toolchain is available");

assert.match(blocklist, /dynamicRulesEqual/,
  "Canonical blocklist no-ops must compare derived DNR state too");
assert.match(blocklist, /if \(dynamicRulesEqual\(existingRules, expectedRules\)\) return previousSites;/,
  "A no-op may return only when storage and DNR are both canonical");
assert.match(blocklist, /await replaceDynamicRules\(nextSites, existingRules\);\s*return previousSites;/,
  "DNR drift must be repaired without rewriting storage or data revision");
assert.match(blocklist, /readLastBlockedUrlSnapshot/,
  "Blocked-navigation no-ops must retain the raw snapshot for canonical comparison");
assert.match(blocklist, /ownValue\(urls, host\) === url && storedLastBlockedUrlsEqual\(snapshot, urls\)/,
  "An identical URL may skip writing only when raw metadata is already canonical");
assert.match(blocklist, /writeCanonicalLastBlockedUrls/,
  "Remembered URL updates and clears must share absent-key canonicalization");
assert.match(blocklist, /if \(Object\.keys\(urls\)\.length === 0\)[\s\S]*remove\(LAST_BLOCKED_URLS_KEY\)/,
  "The final remembered URL must remove the storage key instead of persisting an empty object");

for (const marker of [
  "A missing DNR rule must be restored by a repeated block operation",
  "An identical normalized URL must still repair noncanonical raw storage",
  "CI cleanup must never recurse through a junction into external data",
]) {
  assert.ok(fixtures.includes(marker), `Round 25 fixture is missing: ${marker}`);
}

for (const command of ["node scripts/run-round25-fixtures.mjs", "node scripts/validate-round25-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test is missing ${command}`);
  assert.ok(workflow.includes(command), `CI is missing ${command}`);
}

console.log("Round 25 static validation passed");
