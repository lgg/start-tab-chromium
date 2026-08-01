import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const newtab = read("src/newtab/newtab.ts");
const onboarding = read("src/newtab/onboarding-state.ts");
const runtime = read("src/lib/start-page-runtime.ts");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");
const selfHosted = read("scripts/validate-self-hosted-ci.mjs");
const readme = read("README.md");
const audit = read("docs/audit-2026-08-01-round-42.md");
const manualQa = read("docs/manual-qa-round42.md");

assert.match(onboarding, /START_PAGE_ONBOARDING_KEY = "startPageOnboarding"/);
assert.match(onboarding, /Object\.prototype\.hasOwnProperty\.call\(value, "onboarded"\)/);
assert.match(onboarding, /onboardingStorageAction/);
assert.match(newtab, /withStorageLock\("onboarding", async \(\) => \{[\s\S]*if \(await onboardingState\(\)\)/,
  "Onboarding completion must serialize across extension contexts and revalidate after waiting for the lock");
assert.ok(
  newtab.indexOf("if (await onboardingState())") < newtab.indexOf("settingsWithLayoutPreset(savedSettings, presetId)"),
  "The latest onboarding state must be checked before a preset can be applied",
);
assert.match(newtab, /onboardingStorageAction\(changes\[START_PAGE_ONBOARDING_KEY\]\)/);
assert.match(newtab, /onboardingAction === "dismiss"[\s\S]*dismissOnboarding\(\)/);
assert.match(newtab, /onboardingAction === "show"[\s\S]*refreshState\(\)[\s\S]*showOnboarding\(\)/);
assert.match(runtime, /RESET_STORAGE_KEYS[\s\S]*ONBOARDING_KEY/,
  "Reset must continue removing onboarding state so an open page can show the wizard again");

assert.match(readme, /does not use the GitHub Actions cache service/);
assert.doesNotMatch(readme, /CI caches only npm download data/);

for (const command of ["node scripts/run-round42-fixtures.mjs", "node scripts/validate-round42-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test must include ${command}`);
  assert.ok(workflow.includes(command), `CI must include ${command}`);
  assert.ok(selfHosted.includes(command), `Self-hosted contract must include ${command}`);
}
for (const phrase of ["cross-tab", "import", "reset", "preset", "Web Lock"]) {
  assert.ok(audit.toLowerCase().includes(phrase.toLowerCase()), `Round 42 audit is missing: ${phrase}`);
}
for (const phrase of ["two Start Tab tabs", "skip onboarding", "reset", "import", "preset"]) {
  assert.ok(manualQa.toLowerCase().includes(phrase.toLowerCase()), `Round 42 manual QA is missing: ${phrase}`);
}

for (const temporary of [".round42", "round42-source-export", "round42-apply"]) {
  assert.equal(fs.existsSync(path.join(root, temporary)), false, `Temporary audit artifact remained: ${temporary}`);
}

console.log("Round 42 static validation passed");
