import {
  blockHost,
  clearAll,
  getBlockedSites,
  unblockHost,
} from "../lib/blocklist.js";
import {
  backupFileName,
  exportBackup,
  importBackup,
  restorePreImportBackup,
} from "../lib/backup.js";
import {
  restoreChromeSyncBackup,
  syncChromeSyncBackup,
  uploadChromeSyncBackup,
} from "../lib/chrome-sync.js";
import {
  getFocusStats,
  resetFocusStats,
} from "../lib/focus-stats.js";
import {
  isGoogleIntegrationConfigured,
  restoreDriveBackup,
  uploadDriveBackup,
} from "../lib/google-integration.js";
import {
  getLocalePreference,
  loadI18n,
  setLocalePreference,
  type I18n,
  type LocalePreference,
} from "../lib/i18n.js";
import { editBlockInstance } from "../lib/block-settings-editor.js";
import {
  clearClockAlarm,
  deleteInstanceRuntime,
  getStartPageRuntimeState,
  instanceRuntimeHasUserData,
  type StartPageRuntimeState,
} from "../lib/start-page-runtime.js";
import {
  BLOCK_DESCRIPTORS,
  BUILT_IN_THEMES,
  LAYOUT_PRESETS,
  addBlockInstance,
  applyLayoutPreset,
  canAddBlock,
  cloneSettings,
  createCustomTheme,
  deleteCustomTheme,
  duplicateBlockInstance,
  duplicateTheme,
  exportCustomTheme,
  getStartPageMigrationReport,
  getStartPageSettings,
  hasBlockUserData,
  importCustomTheme,
  isSingletonBlockType,
  removeBlockInstance,
  resetStartPageSettings,
  selectTheme,
  setStartPageSettings,
  updateBlockInstance,
  updateCustomTheme,
  type BlockInstance,
  type BlockType,
  type LayoutMode,
  type LayoutPresetId,
  type LayoutZone,
  type StartPageSettings,
  type StartPageTheme,
} from "../lib/start-page-settings.js";
import { editTheme } from "../lib/theme-editor.js";

function requireElement<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required element: ${id}`);
  return node as T;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
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

function textInput(value = "", type: "text" | "number" | "url" = "text"): HTMLInputElement {
  const input = element("input", "input");
  input.type = type;
  input.value = value;
  input.autocomplete = "off";
  return input;
}

function numberInput(value: number, min: number, max: number, step: number | "any" = 1): HTMLInputElement {
  const input = textInput(String(value), "number");
  input.min = String(min);
  input.max = String(max);
  input.step = step === "any" ? "any" : String(step);
  return input;
}

function checkbox(value: boolean): HTMLInputElement {
  const input = element("input", "checkbox");
  input.type = "checkbox";
  input.checked = value;
  return input;
}

function select<T extends string>(value: T, options: Array<[T, string]>): HTMLSelectElement {
  const node = element("select", "select");
  for (const [optionValue, label] of options) {
    const option = element("option", "", label);
    option.value = optionValue;
    option.selected = optionValue === value;
    node.append(option);
  }
  return node;
}

function settingField(label: string, control: HTMLElement, description = ""): HTMLElement {
  const wrapper = element("label", "option-field");
  wrapper.append(element("span", "option-field__label", label), control);
  if (description) wrapper.append(element("span", "option-field__description", description));
  return wrapper;
}

function downloadJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Invalid JSON");
  }
}

function readNumber(input: HTMLInputElement, fallback: number): number {
  const parsed = Number(input.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function blockName(block: BlockInstance, i18n: I18n): string {
  return block.title && !block.title.startsWith("blockTitle")
    ? block.title
    : i18n.t(`blockTitle${block.type[0]?.toUpperCase() ?? ""}${block.type.slice(1)}`);
}

const titleNode = requireElement<HTMLElement>("title");
const subtitleNode = requireElement<HTMLElement>("subtitle");
const headerActions = requireElement<HTMLElement>("headerActions");
const nav = requireElement<HTMLElement>("optionsNav");
const sections = requireElement<HTMLElement>("sections");
const status = requireElement<HTMLElement>("status");
const backupImportInput = requireElement<HTMLInputElement>("backupImportInput");
const themeImportInput = requireElement<HTMLInputElement>("themeImportInput");

let i18n: I18n;
let settings: StartPageSettings;
let runtime: StartPageRuntimeState;
let localePreference: LocalePreference;
let blockedSites: string[];
let rendering = false;

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.dataset.error = String(error);
}

async function runAction(action: () => Promise<void>, successMessage: string): Promise<void> {
  setStatus(i18n.t("working"));
  try {
    await action();
    await reloadState();
    render();
    setStatus(successMessage);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

function section(id: string, title: string, description: string): { root: HTMLElement; body: HTMLElement } {
  const root = element("section", "option-section");
  root.id = id;
  const header = element("header", "option-section__header");
  header.append(element("h2", "option-section__title", title), element("p", "option-section__description", description));
  const body = element("div", "option-section__body");
  root.append(header, body);
  return { root, body };
}

function actionRow(...nodes: HTMLElement[]): HTMLElement {
  const row = element("div", "action-row");
  row.append(...nodes);
  return row;
}

function renderHeader(): void {
  titleNode.textContent = i18n.t("optionsTitle");
  subtitleNode.textContent = i18n.t("optionsSubtitle");
  document.title = i18n.t("optionsTitle");
  headerActions.replaceChildren();
  const openTab = button(i18n.t("openStartTab"), "button button--secondary");
  openTab.addEventListener("click", () => void chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html") }));
  const reset = button(i18n.t("resetStartPage"), "button button--danger");
  reset.addEventListener("click", () => {
    if (!window.confirm(i18n.t("resetStartPageConfirm"))) return;
    void runAction(async () => {
      for (const block of settings.layout.blocks) await clearClockAlarm(block.id);
      await resetStartPageSettings();
      await chrome.storage.local.remove("startPageRuntimeState");
      runtime = await getStartPageRuntimeState(await getStartPageSettings());
    }, i18n.t("resetComplete"));
  });
  headerActions.append(openTab, reset);
}

function renderNavigation(sectionItems: Array<{ id: string; label: string }>): void {
  nav.replaceChildren(...sectionItems.map(({ id, label }) => {
    const anchor = element("a", "options-nav__link", label);
    anchor.href = `#${id}`;
    return anchor;
  }));
}

function renderGeneral(): HTMLElement {
  const item = section("general", i18n.t("sectionGeneral"), i18n.t("sectionGeneralDescription"));
  const form = element("form", "option-form");
  const startTabEnabled = checkbox(settings.startTab.enabled);
  const locale = select<LocalePreference>(localePreference, [
    ["auto", i18n.t("localeAuto")],
    ["en", "English"],
    ["ru", "Русский"],
  ]);
  const buttonVisibility = select(settings.settingsButton.visibility, [
    ["always", i18n.t("settingsButtonAlways")],
    ["hover", i18n.t("settingsButtonHover")],
  ]);
  const hoverArea = select(settings.settingsButton.hoverArea, [
    ["top", i18n.t("settingsHoverTop")],
    ["top-right", i18n.t("settingsHoverTopRight")],
    ["right", i18n.t("settingsHoverRight")],
  ]);
  const mode = select<LayoutMode>(settings.layout.mode, [["grid", i18n.t("layoutModeGrid")], ["free", i18n.t("layoutModeFree")]]);
  const zone = select<LayoutZone>(settings.layout.zone, [["contained", i18n.t("layoutZoneContained")], ["full", i18n.t("layoutZoneFull")]]);
  const columns = numberInput(settings.layout.columns, 1, 80, 1);
  const rowHeight = numberInput(settings.layout.rowHeight, 40, 240, 1);
  const gap = numberInput(settings.layout.gap, 0, 60, 1);
  const containedMaxWidth = numberInput(settings.layout.containedMaxWidth, 640, 3840, 10);
  const showTitles = checkbox(settings.layout.showBlockTitles);
  const defaultMinutes = numberInput(settings.focusStats.defaultMinutesPerAvoidedVisit, 0, 1440, 1);
  const dedupeSeconds = numberInput(settings.focusStats.avoidedVisitDedupeSeconds, 1, 604800, 1);
  const preset = select<LayoutPresetId | "custom">(
    LAYOUT_PRESETS.some((candidate) => candidate.id === settings.layout.profile) ? settings.layout.profile as LayoutPresetId : "custom",
    [["custom", i18n.t("layoutPresetCustom")], ...LAYOUT_PRESETS.map((candidate) => [candidate.id, i18n.t(candidate.titleKey)] as [LayoutPresetId, string])],
  );

  form.append(
    settingField(i18n.t("locale"), locale),
    settingField(i18n.t("startTabEnabled"), startTabEnabled),
    settingField(i18n.t("settingsButtonVisibility"), buttonVisibility),
    settingField(i18n.t("settingsButtonHoverArea"), hoverArea),
    settingField(i18n.t("layoutMode"), mode),
    settingField(i18n.t("layoutZone"), zone),
    settingField(i18n.t("layoutColumns"), columns),
    settingField(i18n.t("layoutRowHeight"), rowHeight),
    settingField(i18n.t("layoutGap"), gap),
    settingField(i18n.t("containedMaxWidth"), containedMaxWidth),
    settingField(i18n.t("showBlockTitles"), showTitles),
    settingField(i18n.t("layoutPreset"), preset),
    settingField(i18n.t("defaultMinutesPerAvoidedVisit"), defaultMinutes),
    settingField(i18n.t("avoidedVisitDedupeSeconds"), dedupeSeconds),
  );
  const save = button(i18n.t("saveGeneralSettings"), "button button--primary");
  save.type = "submit";
  form.append(actionRow(save));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    void runAction(async () => {
      if (locale.value !== localePreference) {
        await setLocalePreference(locale.value as LocalePreference);
        localePreference = locale.value as LocalePreference;
      }
      if (preset.value !== "custom" && preset.value !== settings.layout.profile) {
        await applyLayoutPreset(preset.value as LayoutPresetId);
        settings = await getStartPageSettings();
      }
      const next = cloneSettings(settings);
      next.startTab.enabled = startTabEnabled.checked;
      next.settingsButton.visibility = buttonVisibility.value as typeof next.settingsButton.visibility;
      next.settingsButton.hoverArea = hoverArea.value as typeof next.settingsButton.hoverArea;
      next.layout.mode = mode.value as LayoutMode;
      next.layout.zone = zone.value as LayoutZone;
      next.layout.blocks = next.layout.blocks.map((block) => ({ ...block, zone: next.layout.zone }));
      next.layout.columns = readNumber(columns, next.layout.columns);
      next.layout.rowHeight = readNumber(rowHeight, next.layout.rowHeight);
      next.layout.gap = readNumber(gap, next.layout.gap);
      next.layout.containedMaxWidth = readNumber(containedMaxWidth, next.layout.containedMaxWidth);
      next.layout.showBlockTitles = showTitles.checked;
      next.focusStats.defaultMinutesPerAvoidedVisit = readNumber(defaultMinutes, next.focusStats.defaultMinutesPerAvoidedVisit);
      next.focusStats.avoidedVisitDedupeSeconds = readNumber(dedupeSeconds, next.focusStats.avoidedVisitDedupeSeconds);
      await setStartPageSettings(next);
      if (locale.value !== i18n.locale && locale.value !== "auto") location.reload();
    }, i18n.t("settingsSaved"));
  });
  item.body.append(form);
  return item.root;
}

function blockActions(block: BlockInstance): HTMLElement {
  const row = element("div", "instance-row");
  const info = element("div", "instance-row__info");
  info.append(
    element("strong", "instance-row__title", blockName(block, i18n)),
    element("span", "instance-row__meta", `${i18n.t(`blockTitle${block.type[0]?.toUpperCase() ?? ""}${block.type.slice(1)}`)} · ${block.id}`),
    element("span", block.enabled ? "badge badge--active" : "badge", i18n.t(block.enabled ? "enabled" : "disabled")),
  );
  const actions = element("div", "instance-row__actions");
  const edit = button(i18n.t("edit"), "button button--secondary");
  edit.addEventListener("click", () => void (async () => {
    const edited = await editBlockInstance(block, i18n);
    if (!edited) return;
    await runAction(async () => { await updateBlockInstance(block.id, () => edited); }, i18n.t("instanceUpdated"));
  })());
  const toggle = button(i18n.t(block.enabled ? "disable" : "enable"), "button button--secondary");
  toggle.addEventListener("click", () => void runAction(async () => {
    await updateBlockInstance(block.id, (current) => ({ ...current, enabled: !current.enabled }));
  }, i18n.t("instanceUpdated")));
  actions.append(edit, toggle);
  if (!isSingletonBlockType(block.type)) {
    const duplicate = button(i18n.t("duplicate"), "button button--secondary");
    duplicate.addEventListener("click", () => void runAction(async () => { await duplicateBlockInstance(block.id); }, i18n.t("instanceDuplicated")));
    actions.append(duplicate);
  }
  const clear = button(i18n.t("clearInstanceData"), "button button--secondary");
  clear.addEventListener("click", () => {
    if (!window.confirm(i18n.t("clearInstanceDataConfirm", { title: blockName(block, i18n) }))) return;
    void runAction(async () => { await deleteInstanceRuntime(block.id); }, i18n.t("instanceDataCleared"));
  });
  const remove = button(i18n.t("delete"), "button button--danger");
  remove.addEventListener("click", () => {
    const withData = hasBlockUserData(block, runtime) || instanceRuntimeHasUserData(block.id, runtime);
    const key = withData ? "deleteBlockWithDataConfirm" : "deleteBlockConfirm";
    if (!window.confirm(i18n.t(key, { title: blockName(block, i18n) }))) return;
    void runAction(async () => {
      await removeBlockInstance(block.id);
      await deleteInstanceRuntime(block.id);
    }, i18n.t("instanceDeleted"));
  });
  actions.append(clear, remove);
  row.append(info, actions);
  return row;
}

function renderBlocks(): HTMLElement {
  const item = section("blocks", i18n.t("sectionBlocks"), i18n.t("sectionBlocksDescription"));
  const addRow = element("div", "add-instance");
  const available = BLOCK_DESCRIPTORS.filter((descriptor) => canAddBlock(settings, descriptor.type));
  const addSelect = select<BlockType>(available[0]?.type ?? "dateTime", available.map((descriptor) => [descriptor.type, i18n.t(descriptor.titleKey)]));
  const add = button(i18n.t("addBlock"), "button button--primary");
  add.disabled = available.length === 0;
  add.addEventListener("click", () => void runAction(async () => {
    const created = await addBlockInstance(addSelect.value as BlockType);
    const configured = await editBlockInstance(created, i18n);
    if (configured) await updateBlockInstance(created.id, () => configured);
  }, i18n.t("instanceAdded")));
  addRow.append(addSelect, add);
  const list = element("div", "instance-list");
  list.append(...settings.layout.blocks.sort((left, right) => left.order - right.order).map(blockActions));
  item.body.append(addRow, list);
  return item.root;
}

function themeCard(theme: StartPageTheme): HTMLElement {
  const selected = settings.themes.selectedThemeId === theme.id;
  const card = element("article", selected ? "theme-card theme-card--selected" : "theme-card");
  const preview = element("div", "theme-card__preview");
  preview.style.setProperty("--preview-text", theme.tokens.textPrimary);
  preview.style.setProperty("--preview-card", theme.tokens.cardSurface);
  preview.style.setProperty("--preview-accent", theme.tokens.accent);
  if (theme.background.kind === "solid") preview.style.background = theme.background.color;
  if (theme.background.kind === "gradient") preview.style.background = theme.background.css;
  if (theme.background.kind === "image") preview.style.background = `center / cover url("${theme.background.url.replaceAll("\"", "\\\"")}")`;
  if (theme.background.kind === "effect") preview.style.background = theme.background.baseColor;
  preview.append(element("span", "theme-card__preview-card", theme.name));
  const info = element("div", "theme-card__info");
  info.append(element("strong", "theme-card__title", theme.name), element("span", "badge", i18n.t(theme.builtIn ? "builtInTheme" : "customTheme")));
  const actions = element("div", "theme-card__actions");
  const choose = button(i18n.t(selected ? "selected" : "selectTheme"), selected ? "button button--primary" : "button button--secondary");
  choose.disabled = selected;
  choose.addEventListener("click", () => void runAction(async () => { await selectTheme(theme.id); }, i18n.t("themeSelected")));
  const duplicate = button(i18n.t("duplicate"), "button button--secondary");
  duplicate.addEventListener("click", () => void runAction(async () => { await duplicateTheme(theme.id); }, i18n.t("themeDuplicated")));
  actions.append(choose, duplicate);
  if (!theme.builtIn) {
    const edit = button(i18n.t("edit"), "button button--secondary");
    edit.addEventListener("click", () => void (async () => {
      const edited = await editTheme(theme, i18n);
      if (!edited) return;
      await runAction(async () => { await updateCustomTheme(edited); }, i18n.t("themeUpdated"));
    })());
    const exportButton = button(i18n.t("exportTheme"), "button button--secondary");
    exportButton.addEventListener("click", () => downloadJson(`start-tab-theme-${theme.id}.json`, exportCustomTheme(theme)));
    const remove = button(i18n.t("delete"), "button button--danger");
    remove.addEventListener("click", () => {
      if (!window.confirm(i18n.t("deleteThemeConfirm", { name: theme.name }))) return;
      void runAction(async () => { await deleteCustomTheme(theme.id); }, i18n.t("themeDeleted"));
    });
    actions.append(edit, exportButton, remove);
  }
  card.append(preview, info, actions);
  return card;
}

function renderThemes(): HTMLElement {
  const item = section("themes", i18n.t("sectionThemes"), i18n.t("sectionThemesDescription"));
  const create = button(i18n.t("createTheme"), "button button--primary");
  create.addEventListener("click", () => void (async () => {
    const created = await createCustomTheme(i18n.t("newCustomTheme"), settings.themes.selectedThemeId);
    const edited = await editTheme(created, i18n);
    if (edited) await updateCustomTheme(edited);
    await reloadState();
    render();
  })());
  const importButton = button(i18n.t("importTheme"), "button button--secondary");
  importButton.addEventListener("click", () => themeImportInput.click());
  const actions = actionRow(create, importButton);
  const grid = element("div", "theme-grid");
  const themes = [...BUILT_IN_THEMES, ...settings.themes.customThemes];
  grid.append(...themes.map(themeCard));
  item.body.append(actions, grid);
  return item.root;
}

function renderBackup(): HTMLElement {
  const item = section("backup", i18n.t("sectionBackup"), i18n.t("sectionBackupDescription"));
  const local = element("div", "option-card");
  local.append(element("h3", "option-card__title", i18n.t("localBackup")));
  const exportButton = button(i18n.t("exportBackup"), "button button--primary");
  exportButton.addEventListener("click", () => void exportBackup().then((bundle) => downloadJson(backupFileName(), bundle)).catch((error: unknown) => setStatus(String(error), true)));
  const importButton = button(i18n.t("importBackup"), "button button--secondary");
  importButton.addEventListener("click", () => backupImportInput.click());
  const recovery = button(i18n.t("restorePreImportBackup"), "button button--secondary");
  recovery.addEventListener("click", () => void runAction(restorePreImportBackup, i18n.t("backupRestored")));
  local.append(actionRow(exportButton, importButton, recovery));

  const browser = element("div", "option-card");
  browser.append(element("h3", "option-card__title", i18n.t("browserSync")), element("p", "option-card__description", i18n.t("browserSyncDescription")));
  const upload = button(i18n.t("syncUpload"), "button button--secondary");
  upload.addEventListener("click", () => void runAction(uploadChromeSyncBackup, i18n.t("syncUploaded")));
  const restore = button(i18n.t("syncRestore"), "button button--secondary");
  restore.addEventListener("click", () => void runAction(restoreChromeSyncBackup, i18n.t("syncRestored")));
  const smart = button(i18n.t("syncNow"), "button button--primary");
  smart.addEventListener("click", () => void runAction(async () => {
    const result = await syncChromeSyncBackup();
    setStatus(i18n.t(result === "uploaded" ? "syncUploaded" : result === "restored" ? "syncRestored" : "syncUnchanged"));
  }, i18n.t("syncComplete")));
  browser.append(actionRow(upload, restore, smart));

  const drive = element("div", "option-card");
  drive.append(element("h3", "option-card__title", i18n.t("googleDrive")), element("p", "option-card__description", isGoogleIntegrationConfigured() ? i18n.t("googleDriveDescription") : i18n.t("googleDriveNotConfigured")));
  const driveUpload = button(i18n.t("driveUpload"), "button button--secondary");
  const driveRestore = button(i18n.t("driveRestore"), "button button--secondary");
  driveUpload.disabled = !isGoogleIntegrationConfigured();
  driveRestore.disabled = !isGoogleIntegrationConfigured();
  driveUpload.addEventListener("click", () => void runAction(uploadDriveBackup, i18n.t("driveUploaded")));
  driveRestore.addEventListener("click", () => void runAction(restoreDriveBackup, i18n.t("driveRestored")));
  drive.append(actionRow(driveUpload, driveRestore));
  const cards = element("div", "option-card-grid");
  cards.append(local, browser, drive);
  item.body.append(cards);
  return item.root;
}

function renderBlocker(): HTMLElement {
  const item = section("blocker", i18n.t("sectionBlocker"), i18n.t("sectionBlockerDescription"));
  const form = element("form", "add-site");
  const input = textInput();
  input.placeholder = i18n.t("blockSitePlaceholder");
  input.setAttribute("aria-label", i18n.t("blockSitePlaceholder"));
  const add = button(i18n.t("blockSite"), "button button--primary");
  add.type = "submit";
  form.append(input, add);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const host = input.value.trim();
    if (!host) return;
    void runAction(async () => { await blockHost(host); input.value = ""; }, i18n.t("siteBlocked"));
  });
  const list = element("div", "site-list");
  if (blockedSites.length === 0) list.append(element("p", "empty-state", i18n.t("emptyBlocklist")));
  for (const site of blockedSites) {
    const row = element("div", "site-row");
    const remove = button(i18n.t("unblock"), "button button--secondary");
    remove.addEventListener("click", () => void runAction(async () => { await unblockHost(site); }, i18n.t("siteUnblocked")));
    row.append(element("span", "site-row__host", site), remove);
    list.append(row);
  }
  const clear = button(i18n.t("clearBlocklist"), "button button--danger");
  clear.disabled = blockedSites.length === 0;
  clear.addEventListener("click", () => {
    if (!window.confirm(i18n.t("clearBlocklistConfirm"))) return;
    void runAction(clearAll, i18n.t("blocklistCleared"));
  });
  item.body.append(form, list, actionRow(clear));
  return item.root;
}

async function renderStatistics(): Promise<HTMLElement> {
  const item = section("statistics", i18n.t("sectionStatistics"), i18n.t("sectionStatisticsDescription"));
  const stats = await getFocusStats();
  const grid = element("div", "stats-grid");
  const values: Array<[string, string]> = [
    [i18n.t("statsBlockHitsLabel"), String(stats.totals.blockHits)],
    [i18n.t("statsAvoidedVisitsLabel"), String(stats.totals.avoidedVisits)],
    [i18n.t("statsTimeSavedLabel"), String(Math.round(stats.totals.estimatedMinutesSaved))],
    [i18n.t("statsFocusSessionsLabel"), String(stats.totals.focusSessionsCompleted)],
    [i18n.t("statsInterruptedLabel"), String(stats.totals.focusSessionsInterrupted)],
    [i18n.t("statsFocusMinutesLabel"), String(Math.round(stats.totals.focusTimeMs / 60000))],
    [i18n.t("statsUnblocksLabel"), String(stats.totals.unblocksAfterCountdown)],
  ];
  grid.append(...values.map(([label, value]) => {
    const card = element("div", "stat-card");
    card.append(element("span", "stat-card__value", value), element("span", "stat-card__label", label));
    return card;
  }));
  const reset = button(i18n.t("resetStatistics"), "button button--danger");
  reset.addEventListener("click", () => {
    if (!window.confirm(i18n.t("resetStatisticsConfirm"))) return;
    void runAction(resetFocusStats, i18n.t("statisticsReset"));
  });
  const migration = await getStartPageMigrationReport();
  const migrationCard = element("div", "option-card");
  migrationCard.append(element("h3", "option-card__title", i18n.t("migrationStatus")));
  migrationCard.append(element("p", "option-card__description", migration
    ? i18n.t("migrationSummary", { from: migration.fromVersion, to: migration.toVersion, blocks: migration.migratedBlocks, skipped: migration.skippedBlocks })
    : i18n.t("migrationNotRequired")));
  item.body.append(grid, actionRow(reset), migrationCard);
  return item.root;
}

async function reloadState(): Promise<void> {
  settings = await getStartPageSettings();
  runtime = await getStartPageRuntimeState(settings);
  localePreference = await getLocalePreference();
  blockedSites = await getBlockedSites();
}

function render(): void {
  if (rendering) return;
  rendering = true;
  renderHeader();
  const placeholders = [renderGeneral(), renderBlocks(), renderThemes(), renderBackup(), renderBlocker()];
  sections.replaceChildren(...placeholders);
  void renderStatistics().then((statistics) => {
    sections.append(statistics);
    renderNavigation([
      { id: "general", label: i18n.t("sectionGeneral") },
      { id: "blocks", label: i18n.t("sectionBlocks") },
      { id: "themes", label: i18n.t("sectionThemes") },
      { id: "backup", label: i18n.t("sectionBackup") },
      { id: "blocker", label: i18n.t("sectionBlocker") },
      { id: "statistics", label: i18n.t("sectionStatistics") },
    ]);
  }).catch((error: unknown) => setStatus(String(error), true));
  rendering = false;
}

backupImportInput.addEventListener("change", () => {
  const file = backupImportInput.files?.[0];
  backupImportInput.value = "";
  if (!file) return;
  void runAction(async () => { await importBackup(await readJsonFile(file)); }, i18n.t("backupImported"));
});

themeImportInput.addEventListener("change", () => {
  const file = themeImportInput.files?.[0];
  themeImportInput.value = "";
  if (!file) return;
  void runAction(async () => { await importCustomTheme(await readJsonFile(file)); }, i18n.t("themeImported"));
});

async function init(): Promise<void> {
  i18n = await loadI18n();
  await reloadState();
  render();
}

void init().catch((error: unknown) => setStatus(error instanceof Error ? error.message : String(error), true));
