import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const validator = await readFile("scripts/locale-catalog-validation.mjs", "utf8");
const reporter = await readFile("scripts/report-locale-parity.mjs", "utf8");
const fixtures = await readFile("scripts/run-round50-fixtures.mjs", "utf8");
const clean = await readFile("scripts/clean.mjs", "utf8");
const gitignore = await readFile(".gitignore", "utf8");
const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const audit = await readFile("docs/audit-2026-08-11-round-50.md", "utf8");
const manualQa = await readFile("docs/manual-qa-round50.md", "utf8");

assert.match(validator, /export async function buildLocaleParityReport/);
assert.match(validator, /export function assertLocaleParity/);
assert.match(validator, /Duplicate .* locale keys/);
assert.match(validator, /Missing .* locale keys/);
assert.match(validator, /Extra .* locale keys/);
assert.match(validator, /message must be a string/);
assert.match(validator, /message must not be empty/);
assert.match(validator, /Locale placeholder mismatch/);
assert.match(validator, /matchAll\(\/\\\{\(\[A-Za-z0-9_\]\+\)\\\}\/g\)/,
  "Locale validator must compare the runtime's named {placeholder} syntax");

const writeIndex = reporter.indexOf("await writeFile(\"locale-parity-report.json\"");
const assertIndex = reporter.indexOf("assertLocaleParity(genericReport)");
assert.ok(writeIndex >= 0 && assertIndex > writeIndex,
  "The diagnostic locale report must be written before fail-closed validation throws");
assert.match(reporter, /schemaErrors: genericReport\.schemaErrors/);
assert.match(reporter, /placeholderMismatches: genericReport\.placeholderMismatches/);

for (const marker of [
  "Missing Russian key must fail locale validation",
  "Extra Russian key must fail locale validation",
  "Duplicate key across locale fragments must fail locale validation",
  "Malformed or empty locale messages must fail before runtime translation",
  "Translated runtime templates must preserve the source placeholder set",
]) {
  assert.ok(fixtures.includes(marker), `Round 50 fixture is missing: ${marker}`);
}

for (const command of [
  "node scripts/report-locale-parity.mjs",
  "node scripts/run-round50-fixtures.mjs",
  "node scripts/validate-round50-static.mjs",
]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test is missing ${command}`);
  assert.ok(workflow.includes(command), `CI is missing ${command}`);
}

assert.match(workflow, /- name: Validate locale catalogs\s*\n\s*run: node scripts\/report-locale-parity\.mjs/,
  "CI must label locale checking as validation rather than report-only generation");
assert.ok(
  workflow.indexOf("node scripts/validate-round49-static.mjs")
    < workflow.indexOf("node scripts/run-round50-fixtures.mjs")
    && workflow.indexOf("node scripts/run-round50-fixtures.mjs")
      < workflow.indexOf("node scripts/validate-round50-static.mjs")
    && workflow.indexOf("node scripts/validate-round50-static.mjs")
      < workflow.indexOf("node scripts/validate-self-hosted-ci.mjs"),
  "Round 50 must run explicitly after Round 49 and before the self-hosted CI contract",
);

assert.match(clean, /locale-parity-report\.json/,
  "Portable clean must remove the generated locale report");
assert.match(clean, /removePathWithinBoundary/,
  "Locale report cleanup must remain boundary-safe");
assert.match(gitignore, /^build\*\/$/m,
  "All normal build profile directories must be ignored");
assert.match(gitignore, /^locale-parity-report\.json$/m,
  "Generated locale report must not dirty local git status");

assert.match(audit, /diagnostic only/i);
assert.match(audit, /placeholder/i);
assert.match(manualQa, /npm test/);
assert.match(manualQa, /placeholder mismatch/i);

console.log("Round 50 static validation passed");
