import { commitStorageMutationWithRevision } from "../lib/data-revision.js";
import { getLocalePreference, loadI18n, type I18n, type LocalePreference } from "../lib/i18n.js";
import { jsonContentEqual } from "../lib/json-content.js";
import { sendMessage } from "../lib/messages.js";
import { withStorageLock } from "../lib/storage-lock.js";
import {
  START_PAGE_ONBOARDING_KEY,
  isStartPageOnboardingComplete,
  onboardingStorageAction,
} from "./onboarding-state.js";
import {
  getStartPageViewSnapshot,
  normalizeRuntimeState,
  type StartPageRuntimeState,
} from "../lib/start-page-runtime.js";
import {
  LAYOUT_PRESETS,
  blockTitleKey,
  blockUsesDefaultTitle,
  getTheme,
  layoutReplacementRemovesUserData,
  settingsWithLayoutPreset,
  type BlockInstance,
  type LayoutPresetId,
  type StartPageSettings,
} from "../lib/start-page-settings.js";
import { renderBlockContent, type BlockRenderContext } from "./block-renderers.js";
import { hasUnsavedNoteDrafts, hasPendingTaskDrafts, pruneTaskForms, renderHiddenNoteDrafts, hiddenTaskDrafts } from "./block-renderers-runtime.js";
import { hiddenSearchDrafts, pruneLinkPages, hasSearchDrafts } from "./block-renderers-static.js";
import { renderHiddenTextDrafts } from "./hidden-text-drafts.js";
import { localeReloadDecision } from "./protected-page-drafts.js";
import { LayoutEditor } from "./layout-editor.js";
import { RenderScheduler } from "./render-scheduler.js";
import { recoverRuntimeMutation } from "./runtime-mutation-recovery.js";
import { planStartPageStorageChange, sameRuntimeContent } from "./storage-change-plan.js";
import { applyTheme } from "./theme-runtime.js";

const GATE_CHANGE_EVENT = "start-tab-gate-change";
const DISMISS_ONBOARDING_EVENT = "start-tab-dismiss-onboarding";

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
declare global {
  interface Window {
    startTabGateReady?: Promise<void>;
  }
}

const page = requireElement<HTMLElement>("startPage");
const grid = requireElement<HTMLElement>("grid");
const toolbarHost = requireElement<HTMLElement>("editorToolbar");
const paletteHost = requireElement<HTMLElement>("blockPalette");
const settingsButton = requireElement<HTMLButtonElement>("settings");
const nativeNewTabButton = requireElement<HTMLButtonElement>("nativeNewTab");
const statusRegion = requireElement<HTMLElement>("statusRegion");

let i18n: I18n;
let loadedLocalePreference: LocalePreference;
let localeReloadDeferred = false;
let localeCheckGeneration = 0;
const localeNotice = element("section", "draft-recovery");
localeNotice.hidden = true;
const hiddenNotesHost = element("section", "draft-recovery");
hiddenNotesHost.hidden = true;
page.insertBefore(localeNotice, grid);
page.insertBefore(hiddenNotesHost, grid);
const hiddenTextHost = element("section", "draft-recovery");
hiddenTextHost.hidden = true;
page.insertBefore(hiddenTextHost, grid);

function hasProtectedWork(): boolean {
  return editor.isActive || hasUnsavedNoteDrafts() || hasPendingTaskDrafts()
    || hasSearchDrafts() || onboardingOpening || onboardingFinishing
    || Boolean(document.querySelector("dialog[open]") || document.getElementById("onboarding"));
}

function showLocaleNotice(): void {
  localeNotice.hidden = false;
  const message = element("p", "", i18n.t("localeReloadDeferred"));
  message.setAttribute("role", "status");
  const reload = button(i18n.t("localeReloadAction"), "button button--secondary");
  reload.addEventListener("click", () => runUiTask(async () => {
    const committed = await withStorageLock("data-write", getLocalePreference);
    if (disposed) return;
    if (committed === loadedLocalePreference) {
      localeReloadDeferred = false;
      localeNotice.hidden = true;
      return;
    }
    if (hasProtectedWork() && !window.confirm(i18n.t("localeReloadDiscardConfirm"))) return;
    location.reload();
  }));
  localeNotice.replaceChildren(message, reload);
}
let savedSettings: StartPageSettings;
let runtime: StartPageRuntimeState;
let editor: LayoutEditor;
let renderCleanups: Array<() => void> = [];
let disposed = false;
let runtimeMutationJob: Promise<unknown> = Promise.resolve();
let refreshJob: Promise<unknown> = Promise.resolve();
let savedGeneration = 0;
let onboardingOpening = false;
let onboardingFinishing = false;
let onboardingPreviousFocus: HTMLElement | null = null;

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

function reportUiError(error: unknown): void {
  announce(error instanceof Error ? error.message : String(error));
}

function runUiTask(action: () => Promise<unknown>): void {
  void action().catch(reportUiError);
}

function syncStartPageInert(): void {
  const modalActive = Boolean(document.getElementById("startTabGateOverlay") || document.getElementById("onboarding"));
  page.toggleAttribute("inert", modalActive);
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((node) => !node.hidden && node.getAttribute("aria-hidden") !== "true");
}

function trapModalFocus(event: KeyboardEvent, container: HTMLElement): void {
  if (event.key !== "Tab") return;
  const focusable = focusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function blockTitle(block: BlockInstance): string {
  return blockUsesDefaultTitle(block) ? i18n.t(blockTitleKey(block.type)) : block.title;
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
  if (disposed || editor.isPointerActive) return;
  const active = document.activeElement;
  const cardFocus = active instanceof HTMLElement && grid.contains(active) && active.classList.contains("card--editing")
    ? active.dataset.blockId : undefined;
  const noteFocus = active instanceof HTMLTextAreaElement && grid.contains(active) && active.dataset.noteId
    ? { id: active.dataset.noteId, start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection, scrollTop: active.scrollTop }
    : null;
  const widgetFocus = active instanceof HTMLInputElement && grid.contains(active) && active.dataset.widgetDraft
    ? { key: active.dataset.widgetDraft, start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection }
    : null;
  clearRenderCleanups();
  const settings = editor.settings;
  // While editing a layout a removed block can still be restored by Cancel.
  // Only prune against committed layouts, not transient editor drafts.
  if (!editor.isActive) {
    pruneTaskForms(new Set(settings.layout.blocks.filter((block) => block.type === "localTasks").map((block) => block.id)));
    pruneLinkPages(new Set(settings.layout.blocks.filter((block) => block.type === "links" || block.type === "startPinned").map((block) => block.id)));
  }
  const blocks = visibleBlocks(settings);
  applyTheme(getTheme(settings), background);
  updateSettingsButton(settings);
  updateLayoutMetrics(settings, blocks);
  const context: BlockRenderContext = {
    i18n,
    settings,
    runtime,
    setRuntime: async (mutation) => {
      const operation = async (): Promise<number | undefined> => {
        switch (mutation.kind) {
          case "note":
            return (await sendMessage({
              type: "runtime-note",
              instanceId: mutation.instanceId,
              value: mutation.value,
              expectedValue: mutation.expectedValue,
            })).runtimeUpdatedAt;
          case "tasks":
            return (await sendMessage({
              type: "runtime-tasks",
              instanceId: mutation.instanceId,
              tasks: mutation.tasks,
              expectedTasks: mutation.expectedTasks,
            })).runtimeUpdatedAt;
          case "linkPage":
            return (await sendMessage({
              type: "runtime-link-page",
              instanceId: mutation.instanceId,
              page: mutation.page,
              expectedPage: mutation.expectedPage,
            })).runtimeUpdatedAt;
        }
      };
      const next = runtimeMutationJob.catch(() => undefined).then(operation);
      runtimeMutationJob = next;
      try {
        return await next;
      } catch (error) {
        return await recoverRuntimeMutation(error, {
          refresh: async () => { await refreshState(); },
          announceConflict: () => announce(i18n.t("runtimeMutationConflict")),
          queueRender,
          queueRefresh: queueStateRefresh,
        });
      }
    },
    requestRender: () => queueStateRefresh(),
    reportError: reportUiError,
    registerCleanup: registerRenderCleanup,
  };
  grid.replaceChildren(...blocks.map((block) => cardFor(block, context)));
  renderHiddenNoteDrafts(hiddenNotesHost, new Set(blocks.filter((block) => block.type === "note" && block.enabled).map((block) => block.id)), new Set(savedSettings.layout.blocks.filter((block) => block.type === "note").map((block) => block.id)), context);
  renderHiddenTextDrafts(hiddenTextHost, [
    ...hiddenTaskDrafts(new Set(blocks.filter((block) => block.type === "localTasks" && block.enabled).map((block) => block.id))),
    ...hiddenSearchDrafts(new Set(blocks.filter((block) => block.type === "search" && block.enabled).map((block) => block.id))),
  ], context);
  if (blocks.length === 0) grid.append(element("p", "empty-layout", i18n.t("emptyLayout")));
  if (noteFocus && (document.activeElement === document.body || document.activeElement === null)
    && !page.hasAttribute("inert")) {
    const replacement = Array.from(grid.querySelectorAll<HTMLTextAreaElement>("textarea[data-note-id]"))
      .find((candidate) => candidate.dataset.noteId === noteFocus.id);
    if (replacement) {
      replacement.focus({ preventScroll: true });
      replacement.setSelectionRange(noteFocus.start, noteFocus.end, noteFocus.direction);
      replacement.scrollTop = noteFocus.scrollTop;
    }
  } else if (widgetFocus && (document.activeElement === document.body || document.activeElement === null)
    && !page.hasAttribute("inert")) {
    const replacement = Array.from(grid.querySelectorAll<HTMLInputElement>("input[data-widget-draft]"))
      .find((candidate) => candidate.dataset.widgetDraft === widgetFocus.key);
    if (replacement && !replacement.disabled) {
      replacement.focus({ preventScroll: true });
      if (widgetFocus.start !== null && widgetFocus.end !== null) {
        replacement.setSelectionRange(widgetFocus.start, widgetFocus.end, widgetFocus.direction ?? "none");
      }
    }
  } else if (cardFocus && document.activeElement === document.body && !page.hasAttribute("inert")) {
    Array.from(grid.querySelectorAll<HTMLElement>(".card--editing"))
      .find((candidate) => candidate.dataset.blockId === cardFocus)?.focus({ preventScroll: true });
  }
}

const renderScheduler = new RenderScheduler({
  requestFrame: (callback) => { window.requestAnimationFrame(callback); },
  refresh: refreshState,
  render,
  onError: reportUiError,
});

function queueRender(): void {
  renderScheduler.queueRender();
}

function queueStateRefresh(): void {
  renderScheduler.queueRefresh();
}

function refreshState(): Promise<boolean> {
  const next = refreshJob.catch(() => undefined).then(async () => {
    if (disposed) return false;
    const generation = savedGeneration;
    const snapshot = await getStartPageViewSnapshot();
    if (disposed || generation !== savedGeneration) return false;
    const settingsChanged = !jsonContentEqual(savedSettings, snapshot.settings);
    // Even a dirty editor needs the latest saved baseline for Cancel.
    // LayoutEditor preserves its draft and original CAS token independently.
    savedSettings = snapshot.settings;
    editor.replaceSavedSettings(savedSettings);
    const projected = normalizeRuntimeState(snapshot.runtime, editor.settings);
    const runtimeChanged = !sameRuntimeContent(runtime, projected);
    runtime = projected;
    return settingsChanged || runtimeChanged;
  });
  refreshJob = next;
  return next;
}

async function onboardingState(): Promise<boolean> {
  return withStorageLock("data-write", async () => {
    const items = await chrome.storage.local.get(START_PAGE_ONBOARDING_KEY);
    return isStartPageOnboardingComplete(items[START_PAGE_ONBOARDING_KEY]);
  });
}

function dismissOnboarding(restoreFocus = true): void {
  const overlay = document.getElementById("onboarding");
  if (overlay) overlay.remove();
  syncStartPageInert();
  if (restoreFocus && onboardingPreviousFocus?.isConnected) onboardingPreviousFocus.focus();
  onboardingPreviousFocus = null;
}

function setOnboardingActionsDisabled(disabled: boolean): void {
  document.querySelectorAll<HTMLButtonElement>("#onboarding button").forEach((action) => {
    action.disabled = disabled;
  });
}

async function finishOnboarding(presetId: LayoutPresetId | null): Promise<void> {
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
        await refreshState();
        const next = settingsWithLayoutPreset(savedSettings, presetId);
        const removesUserData = layoutReplacementRemovesUserData(savedSettings, next, runtime);
        if (removesUserData && !window.confirm(i18n.t("applyPresetWithDataConfirm"))) return;
        await sendMessage({
          type: "replace-start-page-settings",
          settings: next,
          expectedSettingsUpdatedAt: savedSettings.updatedAt,
          expectedRuntimeUpdatedAt: runtime.updatedAt,
          completeOnboarding: true,
        });
      } else {
        await withStorageLock("data-write", async () => {
          const items = await chrome.storage.local.get(START_PAGE_ONBOARDING_KEY);
          if (isStartPageOnboardingComplete(items[START_PAGE_ONBOARDING_KEY])) return;
          await commitStorageMutationWithRevision(
            [START_PAGE_ONBOARDING_KEY],
            () => chrome.storage.local.set({ [START_PAGE_ONBOARDING_KEY]: { onboarded: true } }),
          );
        });
      }
      dismissOnboarding();
      queueStateRefresh();
    });
  } finally {
    onboardingFinishing = false;
    if (document.getElementById("onboarding")) setOnboardingActionsDisabled(false);
  }
}

function onboardingBlocked(): boolean {
  return disposed || editor.isActive || hasUnsavedNoteDrafts() || hasPendingTaskDrafts()
    || hasSearchDrafts() || !savedSettings.startTab.enabled
    || Boolean(document.getElementById("startTabGateOverlay")
      || document.getElementById("onboarding")
      || document.querySelector("dialog[open]"));
}

async function showOnboarding(): Promise<void> {
  if (onboardingOpening) return;
  onboardingOpening = true;
  try {
    await window.startTabGateReady;
    if (onboardingBlocked()) return;
    // The committed-state read can wait for another context's transaction.
    // Recheck every page-local guard synchronously before mounting the modal.
    if (await onboardingState() || onboardingBlocked()) return;
    onboardingPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = element("div", "onboarding");
    overlay.id = "onboarding";
    const panel = element("section", "onboarding__panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "onboarding-title");
    panel.setAttribute("aria-describedby", "onboarding-description");
    panel.tabIndex = -1;
    panel.addEventListener("keydown", (event) => trapModalFocus(event, panel));
    const title = element("h1", "onboarding__title", i18n.t("onboardingTitle"));
    title.id = "onboarding-title";
    const text = element("p", "onboarding__text", i18n.t("onboardingText"));
    text.id = "onboarding-description";
    const presets = element("div", "onboarding__presets");
    for (const preset of LAYOUT_PRESETS) {
      const item = button(i18n.t(preset.titleKey), "button button--secondary");
      item.addEventListener("click", () => runUiTask(() => finishOnboarding(preset.id)));
      presets.append(item);
    }
    const skip = button(i18n.t("onboardingSkip"), "button button--ghost");
    skip.addEventListener("click", () => runUiTask(() => finishOnboarding(null)));
    panel.append(title, text, presets, skip);
    overlay.append(panel);
    document.body.append(overlay);
    syncStartPageInert();
    (presets.querySelector("button") as HTMLButtonElement | null)?.focus();
  } finally {
    onboardingOpening = false;
  }
}

function handleStorageChange(changes: Record<string, chrome.storage.StorageChange>, areaName: string): void {
  if (areaName !== "local" || disposed) return;
  if (changes.localeOverride) {
    // Ignore provisional writes/rollbacks; reload only for the committed
    // preference that differs from the catalog loaded by this page.
    const generation = ++localeCheckGeneration;
    runUiTask(async () => {
      const committed = await withStorageLock("data-write", getLocalePreference);
      if (disposed || generation !== localeCheckGeneration) return;
      const decision = localeReloadDecision(loadedLocalePreference, committed, hasProtectedWork(), localeReloadDeferred);
      if (decision === "none") {
        localeReloadDeferred = false;
        localeNotice.hidden = true;
      } else if (decision === "defer") {
        localeReloadDeferred = true;
        showLocaleNotice();
      } else location.reload();
    });
  }
  if (changes[START_PAGE_ONBOARDING_KEY]) {
    runUiTask(async () => {
      const complete = await onboardingState();
      if (disposed) return;
      const onboardingAction = onboardingStorageAction({ newValue: { onboarded: complete } });
      if (onboardingAction === "dismiss") {
        dismissOnboarding();
      } else if (onboardingAction === "show") {
        await refreshState();
        await showOnboarding();
      }
    });
  }
  if (changes.startPageSettings || changes.startPageRuntimeState || changes.focusStats) {
    const plan = planStartPageStorageChange(editor.hasUnsavedChanges, {
      settings: Boolean(changes.startPageSettings),
      runtime: Boolean(changes.startPageRuntimeState),
      focusStats: Boolean(changes.focusStats),
    });
    if (plan.announceIgnoredSettings) announce(i18n.t("externalSettingsChangeIgnored"));
    // Do not publish uncommitted values from the storage event. A locked
    // refresh updates the revision even when visible content is unchanged.
    if (plan.refreshState) renderScheduler.queueRefresh(Boolean(changes.focusStats));
  }
}

function dismissOnboardingFromGate(): void {
  dismissOnboarding();
}

function handleGateChange(): void {
  runUiTask(async () => {
    if (!document.getElementById("startTabGateOverlay") && !editor.hasUnsavedChanges) await refreshState();
    await showOnboarding();
  });
}

function handleResize(): void {
  queueRender();
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!editor.hasUnsavedChanges && !hasUnsavedNoteDrafts() && !hasPendingTaskDrafts()) return;
  event.preventDefault();
  event.returnValue = "";
}

function dispose(): void {
  if (disposed) return;
  disposed = true;
  editor.cancelPointer();
  clearRenderCleanups();
  renderScheduler.dispose();
  chrome.storage.onChanged.removeListener(handleStorageChange);
  window.removeEventListener(GATE_CHANGE_EVENT, handleGateChange);
  window.removeEventListener(DISMISS_ONBOARDING_EVENT, dismissOnboardingFromGate);
  window.removeEventListener("resize", handleResize);
  window.removeEventListener("beforeunload", handleBeforeUnload);
}

async function init(): Promise<void> {
  const loaded = await loadI18n();
  i18n = loaded;
  loadedLocalePreference = loaded.preference;
  document.title = i18n.t("appName");
  const initialSnapshot = await getStartPageViewSnapshot();
  savedSettings = initialSnapshot.settings;
  runtime = initialSnapshot.runtime;
  editor = new LayoutEditor(savedSettings, {
    i18n,
    toolbarHost,
    paletteHost,
    getRuntime: () => runtime,
    requestRender: queueRender,
    previewBlock: (card, block, settings) => {
      positionCard(card, block, settings);
      updateLayoutMetrics(settings, visibleBlocks(settings));
    },
    onSaved: (settings) => {
      savedGeneration += 1;
      savedSettings = settings;
      announce(i18n.t("layoutSaved"));
      queueStateRefresh();
    },
    onError: reportUiError,
  });
  settingsButton.addEventListener("click", () => runUiTask(() => chrome.runtime.openOptionsPage()));
  chrome.storage.onChanged.addListener(handleStorageChange);
  window.addEventListener(GATE_CHANGE_EVENT, handleGateChange);
  window.addEventListener(DISMISS_ONBOARDING_EVENT, dismissOnboardingFromGate);
  window.addEventListener("resize", handleResize);
  window.addEventListener("beforeunload", handleBeforeUnload);
  // BFCache restores the existing DOM after pagehide disposed all listeners
  // and widget timers. Reinitialize via reload rather than a half-live page.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && disposed) location.reload();
  });
  window.addEventListener("pagehide", dispose, { once: true });
  render();
  await showOnboarding();
}

void init().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  grid.replaceChildren(element("p", "fatal-error", message));
});
