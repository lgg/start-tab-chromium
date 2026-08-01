from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    content = target.read_text(encoding="utf-8")
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement target, found {count}")
    target.write_text(content.replace(old, new), encoding="utf-8")


def write_new(path: str, content: str) -> None:
    target = Path(path)
    if target.exists():
        raise RuntimeError(f"{path}: new file already exists")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


replace_once(
    "README.md",
    "CI caches only npm download data, does not upload build artifacts, and removes project-local dependencies, build outputs, and cache files with an `always()` cleanup step.",
    "CI uses an isolated temporary npm download cache but does not use the GitHub Actions cache service, does not upload build artifacts, and removes project-local dependencies, build outputs, and cache files with an `always()` cleanup step.",
)

replace_once(
    "src/newtab/newtab.ts",
    'import { withStorageLock } from "../lib/storage-lock.js";\n',
    'import { withStorageLock } from "../lib/storage-lock.js";\nimport {\n  START_PAGE_ONBOARDING_KEY,\n  isStartPageOnboardingComplete,\n  onboardingStorageAction,\n} from "./onboarding-state.js";\n',
)
replace_once("src/newtab/newtab.ts", 'const ONBOARDING_KEY = "startPageOnboarding";\n', "")
replace_once(
    "src/newtab/newtab.ts",
    '''async function onboardingState(): Promise<boolean> {
  const items = await chrome.storage.local.get(ONBOARDING_KEY);
  const value = items[ONBOARDING_KEY];
  return typeof value === "object" && value !== null && (value as { onboarded?: unknown }).onboarded === true;
}
''',
    '''async function onboardingState(): Promise<boolean> {
  const items = await chrome.storage.local.get(START_PAGE_ONBOARDING_KEY);
  return isStartPageOnboardingComplete(items[START_PAGE_ONBOARDING_KEY]);
}
''',
)
replace_once(
    "src/newtab/newtab.ts",
    '''async function finishOnboarding(presetId: LayoutPresetId | null): Promise<void> {
  if (onboardingFinishing) return;
  onboardingFinishing = true;
  setOnboardingActionsDisabled(true);
  try {
    if (presetId) {
      const next = settingsWithLayoutPreset(savedSettings, presetId);
      const removesUserData = layoutReplacementRemovesUserData(savedSettings, next, runtime);
      if (removesUserData && !window.confirm(i18n.t("applyPresetWithDataConfirm"))) return;
      await sendMessage({
        type: "replace-start-page-settings",
        settings: next,
        expectedSettingsUpdatedAt: savedSettings.updatedAt,
        expectedRuntimeUpdatedAt: runtime.updatedAt,
      });
      savedSettings = await getStartPageSettings();
      editor.replaceSavedSettings(savedSettings);
      runtime = await getStartPageRuntimeState(savedSettings);
    }
    await withStorageLock("data-write", async () => {
      await commitStorageMutationWithRevision(
        [ONBOARDING_KEY],
        () => chrome.storage.local.set({ [ONBOARDING_KEY]: { onboarded: true } }),
      );
    });
    dismissOnboarding();
    queueRender();
  } finally {
    onboardingFinishing = false;
    if (document.getElementById("onboarding")) setOnboardingActionsDisabled(false);
  }
}
''',
    '''async function finishOnboarding(presetId: LayoutPresetId | null): Promise<void> {
  if (onboardingFinishing) return;
  onboardingFinishing = true;
  setOnboardingActionsDisabled(true);
  try {
    await withStorageLock("onboarding", async () => {
      if (await onboardingState()) {
        dismissOnboarding();
        return;
      }
      if (presetId) {
        const next = settingsWithLayoutPreset(savedSettings, presetId);
        const removesUserData = layoutReplacementRemovesUserData(savedSettings, next, runtime);
        if (removesUserData && !window.confirm(i18n.t("applyPresetWithDataConfirm"))) return;
        await sendMessage({
          type: "replace-start-page-settings",
          settings: next,
          expectedSettingsUpdatedAt: savedSettings.updatedAt,
          expectedRuntimeUpdatedAt: runtime.updatedAt,
        });
        savedSettings = await getStartPageSettings();
        editor.replaceSavedSettings(savedSettings);
        runtime = await getStartPageRuntimeState(savedSettings);
      }
      await withStorageLock("data-write", async () => {
        await commitStorageMutationWithRevision(
          [START_PAGE_ONBOARDING_KEY],
          () => chrome.storage.local.set({ [START_PAGE_ONBOARDING_KEY]: { onboarded: true } }),
        );
      });
      dismissOnboarding();
      queueRender();
    });
  } finally {
    onboardingFinishing = false;
    if (document.getElementById("onboarding")) setOnboardingActionsDisabled(false);
  }
}
''',
)
replace_once(
    "src/newtab/newtab.ts",
    '''  if (changes.localeOverride) {
    location.reload();
    return;
  }
  if (changes.startPageSettings || changes.startPageRuntimeState || changes.focusStats) {
''',
    '''  if (changes.localeOverride) {
    location.reload();
    return;
  }
  const onboardingAction = onboardingStorageAction(changes[START_PAGE_ONBOARDING_KEY]);
  if (onboardingAction === "dismiss") {
    dismissOnboarding();
  } else if (onboardingAction === "show") {
    runUiTask(async () => {
      if (!editor.hasUnsavedChanges) await refreshState();
      await showOnboarding();
    });
  }
  if (changes.startPageSettings || changes.startPageRuntimeState || changes.focusStats) {
''',
)

write_new(
    "src/newtab/onboarding-state.ts",
    '''export const START_PAGE_ONBOARDING_KEY = "startPageOnboarding";

export interface OnboardingStorageChange {
  newValue?: unknown;
}

export type OnboardingStorageAction = "dismiss" | "show" | null;

export function isStartPageOnboardingComplete(value: unknown): boolean {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, "onboarded")
    && (value as { onboarded?: unknown }).onboarded === true;
}

export function onboardingStorageAction(change: OnboardingStorageChange | undefined): OnboardingStorageAction {
  if (!change) return null;
  return isStartPageOnboardingComplete(change.newValue) ? "dismiss" : "show";
}
''',
)

write_new(
    "scripts/round42-fixtures.ts",
    '''import assert from "node:assert/strict";
import {
  START_PAGE_ONBOARDING_KEY,
  isStartPageOnboardingComplete,
  onboardingStorageAction,
} from "../src/newtab/onboarding-state.js";

assert.equal(START_PAGE_ONBOARDING_KEY, "startPageOnboarding");
assert.equal(isStartPageOnboardingComplete({ onboarded: true }), true);
assert.equal(isStartPageOnboardingComplete({ onboarded: false }), false);
assert.equal(isStartPageOnboardingComplete({ onboarded: 1 }), false);
assert.equal(isStartPageOnboardingComplete(null), false);
assert.equal(isStartPageOnboardingComplete([]), false);

const inherited = Object.create({ onboarded: true }) as Record<string, unknown>;
assert.equal(isStartPageOnboardingComplete(inherited), false,
  "Inherited onboarding flags must not complete the wizard");

assert.equal(onboardingStorageAction(undefined), null);
assert.equal(onboardingStorageAction({ newValue: { onboarded: true } }), "dismiss");
assert.equal(onboardingStorageAction({ newValue: { onboarded: false } }), "show");
assert.equal(onboardingStorageAction({ newValue: undefined }), "show");
assert.equal(onboardingStorageAction({ newValue: "damaged" }), "show");

console.log("Round 42 fixtures passed");
''',
)

write_new(
    "scripts/run-round42-fixtures.mjs",
    '''import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(tmpdir(), "start-tab-round42-runner-"));
try {
  const outfile = path.join(temporary, "round42-fixtures.mjs");
  await build({
    entryPoints: [path.join(root, "scripts", "round42-fixtures.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "silent",
  });
  await import(`${pathToFileURL(outfile).href}?run=${Date.now()}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
''',
)

write_new(
    "scripts/validate-round42-static.mjs",
    '''import assert from "node:assert/strict";
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
''',
)

write_new(
    "docs/audit-2026-08-01-round-42.md",
    '''# Deep audit round 42 — onboarding cross-context consistency

## Scope

Independent continuation from exact `master` commit `9d086cbfe5f96a1dc512eabce3ff5b3baf1fd984`. The audit rechecked every tracked file and declared user-facing surface: manifest and build profiles, service worker, popup, blocked page, new-tab gate and layout editor, block renderers, Options, blocklist/DNR, settings and runtime transactions, backup/import rollback, Browser Sync, Google Calendar and Drive, localization, accessibility contracts, release documentation, and self-hosted CI.

## Confirmed defects

1. An open Start Tab listened for settings, runtime, locale, and statistics storage changes but ignored `startPageOnboarding`. Completing or skipping onboarding in one Start Tab therefore left a stale onboarding dialog open in another tab. Resetting Start Tab or importing a backup that restored incomplete onboarding also failed to show the wizard in already-open tabs.
2. Two onboarding dialogs could finish concurrently. Settings revision checks protected changed layouts, but two tabs that had not changed settings could both proceed after the user selected different outcomes. The later action could apply a preset after onboarding had already been completed elsewhere.
3. README still claimed that CI caches npm download data without explaining that Round 41 removed the GitHub Actions cache service. That wording no longer accurately described the runner contract.

## Corrections

- Added one shared onboarding-state parser and storage-change planner.
- Open Start Tab pages now dismiss onboarding immediately when another context completes it.
- When reset or import makes onboarding incomplete, an open page refreshes canonical state and shows the wizard again when the gate permits it.
- Onboarding completion now uses a dedicated cross-context Web Lock. A waiting action rechecks canonical onboarding state before applying any preset, so only the first completion can mutate the layout.
- Preserved the existing `data-write` transaction and data revision for the final onboarding marker.
- Corrected README to distinguish the temporary local npm cache from the disabled GitHub Actions cache service.
- Added executable fixtures, static contracts, CI wiring, and targeted manual QA.

## Validation boundary

Automation verifies state parsing, storage-change planning, lock/revalidation ordering, reset coverage, documentation consistency, the complete historical regression chain, TypeScript typecheck, and all build profiles. Physical Chromium validation remains required for real cross-tab event timing, focus restoration, vendor-specific new-tab behavior, and production OAuth accounts.
''',
)

write_new(
    "docs/manual-qa-round42.md",
    '''# Round 42 manual QA — onboarding across extension contexts

- [ ] Open two Start Tab tabs before onboarding is complete. In the first tab, skip onboarding. Confirm the onboarding dialog closes automatically in the second tab without applying another preset.
- [ ] Repeat with two Start Tab tabs and choose different preset buttons nearly simultaneously. Confirm only the first completion changes the layout and the other tab dismisses its stale dialog.
- [ ] Complete onboarding, keep a Start Tab open, then use Options to reset Start Tab. Confirm the open tab shows onboarding again after canonical settings/runtime reload.
- [ ] Import a backup with `startPageOnboarding.onboarded` set to false while another Start Tab is open. Confirm that tab refreshes and shows onboarding.
- [ ] Import a backup with onboarding already complete while a stale onboarding dialog is open. Confirm the dialog closes.
- [ ] While the disabled-content or Split View gate is visible, reset or import onboarding state. Confirm onboarding waits for the gate to close and appears only afterward.
- [ ] Start editing a layout, then change onboarding state from another context. Confirm unsaved layout content is not silently replaced.
- [ ] Verify focus returns to the previously focused connected control when a remote completion dismisses onboarding.
''',
)

replace_once(
    ".github/workflows/ci.yml",
    '''      - name: Validate round 41
        run: node scripts/validate-round41-static.mjs

      - name: Validate self-hosted CI contract
''',
    '''      - name: Validate round 41
        run: node scripts/validate-round41-static.mjs

      - name: Run round 42 fixtures
        run: node scripts/run-round42-fixtures.mjs

      - name: Validate round 42
        run: node scripts/validate-round42-static.mjs

      - name: Validate self-hosted CI contract
''',
)

replace_once(
    "scripts/validate-self-hosted-ci.mjs",
    '''  "node scripts/run-round41-fixtures.mjs",
  "node scripts/validate-round41-static.mjs",
  "node scripts/validate-self-hosted-ci.mjs",
''',
    '''  "node scripts/run-round41-fixtures.mjs",
  "node scripts/validate-round41-static.mjs",
  "node scripts/run-round42-fixtures.mjs",
  "node scripts/validate-round42-static.mjs",
  "node scripts/validate-self-hosted-ci.mjs",
''',
)

replace_once(
    "package.json",
    " && node scripts/run-round41-fixtures.mjs && node scripts/validate-round41-static.mjs && node scripts/validate-self-hosted-ci.mjs",
    " && node scripts/run-round41-fixtures.mjs && node scripts/validate-round41-static.mjs && node scripts/run-round42-fixtures.mjs && node scripts/validate-round42-static.mjs && node scripts/validate-self-hosted-ci.mjs",
)

print("Round 42 deterministic replacements completed")
