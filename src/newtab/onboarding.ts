import {
  cloneLayoutBlocks,
  getStartPageSettings,
  LAYOUT_PRESETS,
  setStartPageSettings,
} from "../lib/start-page-settings.js";

const STATE_KEY = "startPageRuntimeState";

interface RuntimeState {
  onboarded?: boolean;
}

function t(key: string): string {
  return chrome.i18n.getMessage(key) || key;
}

async function readState(): Promise<RuntimeState> {
  const items = await chrome.storage.local.get(STATE_KEY);
  const value = items[STATE_KEY];
  return typeof value === "object" && value !== null ? value as RuntimeState : {};
}

async function writeState(patch: RuntimeState): Promise<void> {
  const state = await readState();
  await chrome.storage.local.set({ [STATE_KEY]: { ...state, ...patch } });
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
