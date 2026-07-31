import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const worker = read("src/service-worker.ts");
const splitMarkers = read("src/lib/split-view-markers.ts");
const gate = read("src/newtab/newtab-gate.js");
const newtab = read("src/newtab/newtab.ts");
const integrations = read("src/newtab/block-renderers-integrations.ts");
const google = read("src/lib/google-integration.ts");
const settings = read("src/lib/start-page-settings.ts");
const options = read("src/options/options.ts");
const layoutEditor = read("src/newtab/layout-editor.ts");
const buildValidator = read("scripts/validate-build-output.mjs");
const releaseValidator = read("scripts/validate-release-docs.mjs");
const release300 = read("docs/release-3.0.0.md");
const readme = read("README.md");
const manualQa = read("docs/manual-qa-3.0.0.md");
const audit = read("docs/audit-2026-07-31-round-37.md");
const en = read("src/_locales/en/round7-messages.json");
const ru = read("src/_locales/ru/round7-messages.json");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");
const selfHosted = read("scripts/validate-self-hosted-ci.mjs");

const expectedMarkers = [
  "split-view", "split_view", "splitview", "side-by-side", "sidebyside", "side_panel", "side-panel",
  "tab-picker", "tab_picker", "tabpicker", "select-tab", "select_tab", "selecttab",
];
for (const marker of expectedMarkers) {
  assert.ok(splitMarkers.includes(`"${marker}"`), `Shared Split View markers are missing ${marker}`);
  assert.ok(gate.includes(`"${marker}"`), `Early gate markers are missing ${marker}`);
}
for (const generic of ["split", "picker", "pane"]) {
  assert.doesNotMatch(splitMarkers, new RegExp(`^[\\s\\S]*\\n\\s*"${generic}",?$`, "m"), `Generic marker must not bypass Start Tab: ${generic}`);
}
assert.match(worker, /containsSplitViewMarker\(haystack\)/, "Service worker must use the shared explicit marker policy");
assert.doesNotMatch(worker, /const SPLIT_VIEW_MARKERS/, "Service worker must not keep a divergent marker list");

assert.match(newtab, /function dismissOnboarding\(restoreFocus = true\)/);
assert.match(newtab, /onboardingPreviousFocus\?\.isConnected/);
assert.match(newtab, /if \(onboardingFinishing\) return/);
assert.match(newtab, /setOnboardingActionsDisabled\(true\)/);
assert.match(newtab, /aria-describedby", "onboarding-description/);
assert.match(newtab, /DISMISS_ONBOARDING_EVENT/);
assert.match(gate, /window\.dispatchEvent\(new Event\(DISMISS_ONBOARDING_EVENT\)\)/,
  "The early gate must let onboarding perform its own focus/inert cleanup before fallback removal");

assert.match(integrations, /const title = event\.title\.trim\(\) \|\| i18n\.t\("calendarUntitledEvent"\)/);
assert.match(integrations, /if \(!start\) return title;/, "Invalid timed events must not be labeled all-day");
assert.match(google, /title: payload\.summary\?\.trim\(\) \?\? ""/,
  "Google data normalization must preserve an empty title for localized rendering");
assert.match(integrations, /if \(days\.length === 0\) throw new Error\("Missing daily weather"\)/,
  "Empty day/week provider responses must render the unavailable fallback");
assert.match(integrations, /resetAllClocksConfirm/);
assert.match(integrations, /resetStatisticsConfirm/);

assert.match(settings, /export function blockDeletionRequiresDataConfirmation/);
assert.match(settings, /block\.config\.confirmDeleteWithContent && Boolean/);
assert.match(settings, /block\.config\.confirmDeleteWithContent && \(ownValue\(runtime\.tasks/);
assert.match(settings, /clock && \(clock\.running \|\| clock\.accumulatedMs > 0\)/);
assert.match(options, /blockDeletionRequiresDataConfirmation\(block, runtime\)/);
assert.match(layoutEditor, /blockDeletionRequiresDataConfirmation\(block, runtime\)/);
assert.doesNotMatch(options, /hasBlockUserData\(block, runtime\) \|\| instanceRuntimeHasUserData/);
assert.doesNotMatch(layoutEditor, /hasBlockUserData\(block, runtime\) \|\| instanceRuntimeHasUserData/);

assert.ok(buildValidator.includes('"icons/icon.large.png"'), "Build validation must cover the blocked-page icon");
assert.ok(release300.includes("npm run build:google"), "Legacy 3.0.0 release instructions must use the explicit Google profile");
assert.ok(release300.includes("build-google/"), "Legacy release instructions must name the Google artifact directory");
assert.doesNotMatch(release300, /GOOGLE_OAUTH_CLIENT_ID=[^\n]+ npm run build\s*$/m,
  "Legacy release instructions must not claim the ordinary build consumes Google OAuth");
assert.match(releaseValidator, /legacyReleaseNotes/, "Release validation must keep the legacy 3.0.0 Google instructions correct");
assert.match(readme, /per-PR\/ref concurrency group cancels accidental duplicate runs/);
assert.doesNotMatch(readme, /without canceling older queued runs/);

for (const catalog of [en, ru]) {
  assert.match(catalog, /"calendarUntitledEvent"/);
  assert.match(catalog, /"resetAllClocksConfirm"/);
}
for (const command of ["node scripts/run-round37-fixtures.mjs", "node scripts/validate-round37-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test must include ${command}`);
  assert.ok(workflow.includes(command), `CI must include ${command}`);
  assert.ok(selfHosted.includes(command), `Self-hosted CI validation must include ${command}`);
}
for (const phrase of [
  "rapid double-clicks",
  "unrelated internal URLs",
  "valid provider response with no complete daily entries",
  "empty title and an invalid timed start",
  "confirm deletion with content",
  "icon.large.png",
]) assert.ok(manualQa.includes(phrase), `Manual QA is missing: ${phrase}`);
for (const phrase of ["Split View marker", "onboarding", "confirmDeleteWithContent", "Google build instructions"]) {
  assert.ok(audit.includes(phrase), `Round 37 audit report is missing: ${phrase}`);
}

console.log("Round 37 static validation passed");
