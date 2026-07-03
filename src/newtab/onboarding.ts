import {
  cloneLayoutBlocks,
  getStartPageSettings,
  LAYOUT_PRESETS,
  setStartPageSettings,
} from "../lib/start-page-settings.js";

const ONBOARDING_KEY = "startPageOnboarding";
const LEGACY_RUNTIME_STATE_KEY = "startPageRuntimeState";

interface OnboardingState {
  onboarded?: boolean;
}

function t(key: string): string {
  return chrome.i18n.getMessage(key) || key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readState(): Promise<OnboardingState> {
  const items = await chrome.storage.local.get([ONBOARDING_KEY, LEGACY_RUNTIME_STATE_KEY]);
  const current = items[ONBOARDING_KEY];
  if (isRecord(current)) return { onboarded: current.onboarded === true };

  const legacy = items[LEGACY_RUNTIME_STATE_KEY];
  return { onboarded: isRecord(legacy) && legacy.onboarded === true };
}

async function writeState(patch: OnboardingState): Promise<void> {
  const state = await readState();
  await chrome.storage.local.set({ [ONBOARDING_KEY]: { ...state, ...patch } });
}

function button(label: string, className = "button"): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  return element;
}

async function applyPreset(presetId: string): Promise<void> {
  const preset = LAYOUT_PRESETS.find((item) => item.id === presetId);
  if (!preset) return;
  const settings = await getStartPageSettings();
  await setStartPageSettings({
    ...settings,
    layout: {
      columns: preset.columns,
      profile: preset.id,
      blocks: cloneLayoutBlocks(preset.blocks),
    },
  });
  await writeState({ onboarded: true });
  location.reload();
}

async function dismiss(): Promise<void> {
  await writeState({ onboarded: true });
  document.getElementById("onboarding")?.remove();
}

function renderOnboarding(): void {
  const overlay = document.createElement("div");
  overlay.className = "onboarding";
  overlay.id = "onboarding";

  const panel = document.createElement("section");
  panel.className = "onboarding__panel";

  const title = document.createElement("h1");
  title.textContent = t("onboardingTitle");

  const text = document.createElement("p");
  text.textContent = t("onboardingText");

  const actions = document.createElement("div");
  actions.className = "onboarding__actions";
  for (const preset of LAYOUT_PRESETS) {
    const item = button(preset.title);
    item.addEventListener("click", () => void applyPreset(preset.id));
    actions.append(item);
  }

  const skip = button(t("onboardingSkip"), "button button--ghost");
  skip.addEventListener("click", () => void dismiss());

  panel.append(title, text, actions, skip);
  overlay.append(panel);
  document.body.append(overlay);
}

void (async () => {
  const state = await readState();
  if (!state.onboarded) renderOnboarding();
})();
