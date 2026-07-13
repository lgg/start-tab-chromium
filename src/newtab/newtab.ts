import { loadI18n, type I18n } from "../lib/i18n.js";
import {
  getStartPageRuntimeState,
  setStartPageRuntimeState,
  type StartPageRuntimeState,
} from "../lib/start-page-runtime.js";
import {
  LAYOUT_PRESETS,
  blocksFromPreset,
  cloneSettings,
  getStartPageSettings,
  getTheme,
  setStartPageSettings,
  type BlockInstance,
  type LayoutPresetId,
  type StartPageSettings,
} from "../lib/start-page-settings.js";
import { renderBlockContent, type BlockRenderContext } from "./block-renderers.js";
import { LayoutEditor } from "./layout-editor.js";
import { applyTheme } from "./theme-runtime.js";

const ONBOARDING_KEY = "startPageOnboarding";
const NATIVE_NEW_TAB_BYPASS_KEY = "startTabNativeNewTabBypass";

function requireElement<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required element: ${id}`);
  return node as T;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function button(text: string, className = "button"): HTMLButtonElement {
  const node = element("button", className, text);
  node.type = "button";
  return node;
}

const background = requireElement<HTMLElement>("background");
const page = requireElement<HTMLElement>("startPage");
const grid = requireElement<HTMLElement>("grid");
const toolbarHost = requireElement<HTMLElement>("editorToolbar");
const paletteHost = requireElement<HTMLElement>("blockPalette");
const settingsButton = requireElement<HTMLButtonElement>("settings");
const nativeNewTabButton = requireElement<HTMLButtonElement>("nativeNewTab");
const statusRegion = requireElement<HTMLElement>("statusRegion");

let i18n: I18n;
let savedSettings: StartPageSettings;
let runtime: StartPageRuntimeState;
let editor: LayoutEditor;
let renderCleanups: Array<() => void> = [];
let renderQueued = false;
let disposed = false;

function clearRenderCleanups(): void {
  for (const cleanup of renderCleanups.splice(0)) cleanup();
}

function registerRenderCleanup(cleanup: () => void): void {
  renderCleanups.push(cleanup);
}

function announce(message: string): void {
  statusRegion.textContent = "";
  window.requestAnimationFrame(() => { statusRegion.textContent = message; });
}

function blockTitle(block: BlockInstance): string {
  if (!block.title || block.title.startsWith("blockTitle")) {
    const key = `blockTitle${block.type[0]?.toUpperCase() ?? ""}${block.type.slice(1)}`;
    return i18n.t(key);
  }
  return block.title;
}

function cardFor(block: BlockInstance, context: BlockRenderContext): HTMLElement {
  const card = element("article", block.enabled ? "card" : "card card--disabled");
  card.dataset.blockId = block.id;
  card.dataset.blockType = block.type;
  card.dataset.zone = block.zone;
  const title = element("h2", "card__title", blockTitle(block));
  const content = element("div", `card__content card__content--${block.type}`);
  if (editor.isActive && !block.enabled) {
    content.append(element("p", "empty-state", i18n.t("blockDisabled")));
  } else {
    renderBlockContent(block, content, context);
  }
  if (editor.settings.layout.showBlockTitles) card.append(title);
  card.append(content);
  positionCard(card, block, editor.settings);
  editor.decorateCard(card, block);
  return card;
}

function positionCard(card: HTMLElement, block: BlockInstance, settings: StartPageSettings): void {
  card.style.removeProperty("grid-column");
  card.style.removeProperty("grid-row");
  card.style.removeProperty("left");
  card.style.removeProperty("top");
  card.style.removeProperty("width");
  card.style.removeProperty("height");
  if (settings.layout.mode === "grid") {
    card.style.gridColumn = `${block.column} / span ${block.width}`;
    card.style.gridRow = `${block.row} / span ${block.height}`;
    card.style.minHeight = `calc(${block.height} * var(--row-height) + (${block.height} - 1) * var(--layout-gap))`;
    return;
  }
  card.style.minHeight = "";
  card.style.left = `${block.free.x}px`;
  card.style.top = `${block.free.y}px`;
  card.style.width = `${block.free.width}px`;
  card.style.height = `${block.free.height}px`;
}

function visibleBlocks(settings: StartPageSettings): BlockInstance[] {
  return settings.layout.blocks
    .filter((block) => editor.isActive || block.enabled)
    .sort((left, right) => left.order - right.order);
}

function updateLayoutMetrics(settings: StartPageSettings, blocks: readonly BlockInstance[]): void {
  const layout = settings.layout;
  page.dataset.layoutMode = layout.mode;
  page.dataset.layoutZone = layout.zone;
  page.dataset.editorActive = String(editor.isActive);
  page.style.setProperty("--layout-columns", String(layout.columns));
  page.style.setProperty("--row-height", `${layout.rowHeight}px`);
  page.style.setProperty("--layout-gap", `${layout.gap}px`);
  page.style.setProperty("--contained-max-width", `${layout.containedMaxWidth}px`);
  grid.className = layout.mode === "grid" ? "grid grid--grid" : "grid grid--free";

  const viewportWidth = Math.max(320, window.innerWidth - (layout.zone === "contained" ? 48 : 32));
  const standardWidth = layout.zone === "contained"
    ? Math.min(layout.containedMaxWidth, viewportWidth)
    : viewportWidth;

  if (layout.mode === "grid") {
    const maxColumn = blocks.reduce((maximum, block) => Math.max(maximum, block.column + block.width - 1), layout.columns);
    const maxRow = blocks.reduce((maximum, block) => Math.max(maximum, block.row + block.height - 1), 1);
    const columnWidth = Math.max(48, (standardWidth - layout.gap * (layout.columns - 1)) / layout.columns);
    const neededWidth = maxColumn <= layout.columns
      ? standardWidth
      : maxColumn * columnWidth + Math.max(0, maxColumn - 1) * layout.gap;
    grid.style.width = `${Math.ceil(neededWidth)}px`;
    grid.style.minHeight = `${Math.max(1, maxRow) * layout.rowHeight + Math.max(0, maxRow - 1) * layout.gap}px`;
  } else {
    const contentWidth = blocks.reduce((maximum, block) => Math.max(maximum, block.free.x + block.free.width), 0);
    const contentHeight = blocks.reduce((maximum, block) => Math.max(maximum, block.free.y + block.free.height), 0);
    grid.style.width = `${Math.ceil(Math.max(standardWidth, contentWidth))}px`;
    grid.style.minHeight = `${Math.ceil(Math.max(window.innerHeight - 96, contentHeight))}px`;
  }
}

function updateSettingsButton(settings: StartPageSettings): void {
  page.dataset.settingsVisibility = settings.settingsButton.visibility;
  page.dataset.settingsHoverArea = settings.settingsButton.hoverArea;
  settingsButton.title = i18n.t("openSettings");
  settingsButton.setAttribute("aria-label", i18n.t("openSettings"));
  nativeNewTabButton.title = i18n.t("openNativeNewTab");
  nativeNewTabButton.setAttribute("aria-label", i18n.t("openNativeNewTab"));
}

function render(): void {
  if (disposed) return;
  clearRenderCleanups();
  const settings = editor.settings;
  const blocks = visibleBlocks(settings);
  applyTheme(getTheme(settings), background);
  updateSettingsButton(settings);
  updateLayoutMetrics(settings, blocks);
  const context: BlockRenderContext = {
    i18n,
    settings,
    runtime,
    setRuntime: async (next) => {
      runtime = next;
      context.runtime = next;
      await setStartPageRuntimeState(next);
    },
    requestRender: () => queueStateRefresh(),
    registerCleanup: registerRenderCleanup,
  };
  grid.replaceChildren(...blocks.map((block) => cardFor(block, context)));
  if (blocks.length === 0) grid.append(element("p", "empty-layout", i18n.t("emptyLayout")));
}

function queueRender(): void {
  if (renderQueued || disposed) return;
  renderQueued = true;
  window.requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function queueStateRefresh(): void {
  if (renderQueued || disposed) return;
  renderQueued = true;
  window.requestAnimationFrame(() => {
    void refreshState().finally(() => {
      renderQueued = false;
      render();
    });
  });
}

async function refreshState(): Promise<void> {
  if (!editor.hasUnsavedChanges) {
    savedSettings = await getStartPageSettings();
    editor.replaceSavedSettings(savedSettings);
  }
  runtime = await getStartPageRuntimeState(editor.settings);
}

async function openNativeNewTab(): Promise<void> {
  const tab = await chrome.tabs.create({ active: true });
  if (typeof tab.id !== "number") return;
  await chrome.storage.local.set({
    [NATIVE_NEW_TAB_BYPASS_KEY]: {
      tabId: tab.id,
      expiresAt: Date.now() + 5000,
    },
  });
  try {
    await chrome.tabs.update(tab.id, { url: "chrome://newtab/" });
  } catch {
    await chrome.tabs.update(tab.id, { url: "about:newtab" });
  }
}

async function onboardingState(): Promise<boolean> {
  const items = await chrome.storage.local.get(ONBOARDING_KEY);
  const value = items[ONBOARDING_KEY];
  return typeof value === "object" && value !== null && (value as { onboarded?: unknown }).onboarded === true;
}

async function finishOnboarding(presetId: LayoutPresetId | null): Promise<void> {
  if (presetId) {
    const preset = LAYOUT_PRESETS.find((candidate) => candidate.id === presetId);
    if (preset) {
      const next = cloneSettings(savedSettings);
      next.layout.columns = preset.columns;
      next.layout.profile = preset.id;
      next.layout.blocks = blocksFromPreset(preset, next.layout.zone);
      await setStartPageSettings(next);
      savedSettings = await getStartPageSettings();
      editor.replaceSavedSettings(savedSettings);
      runtime = await getStartPageRuntimeState(savedSettings);
    }
  }
  await chrome.storage.local.set({ [ONBOARDING_KEY]: { onboarded: true } });
  document.getElementById("onboarding")?.remove();
  queueRender();
}

async function showOnboarding(): Promise<void> {
  if (await onboardingState()) return;
  const overlay = element("div", "onboarding");
  overlay.id = "onboarding";
  const panel = element("section", "onboarding__panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "onboarding-title");
  const title = element("h1", "onboarding__title", i18n.t("onboardingTitle"));
  title.id = "onboarding-title";
  const text = element("p", "onboarding__text", i18n.t("onboardingText"));
  const presets = element("div", "onboarding__presets");
  for (const preset of LAYOUT_PRESETS) {
    const item = button(i18n.t(preset.titleKey), "button button--secondary");
    item.addEventListener("click", () => void finishOnboarding(preset.id));
    presets.append(item);
  }
  const skip = button(i18n.t("onboardingSkip"), "button button--ghost");
  skip.addEventListener("click", () => void finishOnboarding(null));
  panel.append(title, text, presets, skip);
  overlay.append(panel);
  document.body.append(overlay);
  (presets.querySelector("button") as HTMLButtonElement | null)?.focus();
}

function handleStorageChange(changes: Record<string, chrome.storage.StorageChange>, areaName: string): void {
  if (areaName !== "local" || disposed) return;
  if (changes.localeOverride) {
    location.reload();
    return;
  }
  if (changes.startPageSettings || changes.startPageRuntimeState || changes.focusStats) {
    if (editor.hasUnsavedChanges && changes.startPageSettings) {
      announce(i18n.t("externalSettingsChangeIgnored"));
      return;
    }
    queueStateRefresh();
  }
}

function handleResize(): void {
  queueRender();
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!editor.hasUnsavedChanges) return;
  event.preventDefault();
  event.returnValue = "";
}

function dispose(): void {
  if (disposed) return;
  disposed = true;
  clearRenderCleanups();
  chrome.storage.onChanged.removeListener(handleStorageChange);
  window.removeEventListener("resize", handleResize);
  window.removeEventListener("beforeunload", handleBeforeUnload);
}

async function init(): Promise<void> {
  i18n = await loadI18n();
  document.title = i18n.t("appName");
  savedSettings = await getStartPageSettings();
  runtime = await getStartPageRuntimeState(savedSettings);
  editor = new LayoutEditor(savedSettings, {
    i18n,
    toolbarHost,
    paletteHost,
    getRuntime: () => runtime,
    requestRender: queueRender,
    onSaved: (settings) => {
      savedSettings = settings;
      announce(i18n.t("layoutSaved"));
      void getStartPageRuntimeState(settings).then((nextRuntime) => {
        runtime = nextRuntime;
        queueRender();
      });
    },
  });
  settingsButton.addEventListener("click", () => void chrome.runtime.openOptionsPage());
  nativeNewTabButton.addEventListener("click", () => void openNativeNewTab());
  chrome.storage.onChanged.addListener(handleStorageChange);
  window.addEventListener("resize", handleResize);
  window.addEventListener("beforeunload", handleBeforeUnload);
  window.addEventListener("pagehide", dispose, { once: true });
  render();
  await showOnboarding();
}

void init().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  grid.replaceChildren(element("p", "fatal-error", message));
});
