import { backupFileName, exportBackup, importBackup } from "../lib/backup.js";
import { restoreChromeSyncBackup, uploadChromeSyncBackup } from "../lib/chrome-sync.js";
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
import {
  cloneLayoutBlocks,
  getStartPageSettings,
  LAYOUT_PRESETS,
  resetStartPageSettings,
  setStartPageSettings,
  type BackgroundEffect,
  type DateTimeMode,
  type LayoutBlock,
  type LinkPageDirection,
  type SearchProvider,
  type SearchProviderId,
  type SettingsButtonVisibility,
  type StartLink,
  type StartPageSettings,
  type WeatherDisplayMode,
} from "../lib/start-page-settings.js";

const titleEl = requireElement<HTMLHeadingElement>("title");
const subtitleEl = requireElement<HTMLParagraphElement>("subtitle");
const formEl = requireElement<HTMLFormElement>("form");
const resetEl = requireElement<HTMLButtonElement>("reset");
const statusEl = requireElement<HTMLParagraphElement>("status");

let i18n: I18n;
let settings: StartPageSettings;
let localePreference: LocalePreference;

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: ${id}`);
  return element as T;
}

function input(id: string): HTMLInputElement {
  return requireElement<HTMLInputElement>(id);
}

function select(id: string): HTMLSelectElement {
  return requireElement<HTMLSelectElement>(id);
}

function textarea(id: string): HTMLTextAreaElement {
  return requireElement<HTMLTextAreaElement>(id);
}

function numberValue(id: string, fallback: number): number {
  const value = Number(input(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function render(): void {
  document.title = i18n.t("optionsTitle");
  titleEl.textContent = i18n.t("optionsTitle");
  subtitleEl.textContent = i18n.t("optionsSubtitle");
  resetEl.textContent = i18n.t("resetSettings");
  statusEl.textContent = "";
  formEl.innerHTML = "";

  formEl.append(
    section(i18n.t("sectionLocalization"), [
      field(i18n.t("localePreference"), makeSelect("locale", [
        ["auto", i18n.t("localeAuto")],
        ["en", "English"],
        ["ru", "Русский"],
      ], localePreference)),
    ]),
    section(i18n.t("sectionBackup"), [backupControls()]),
    section(i18n.t("sectionAppearance"), [
      field(i18n.t("fontFamily"), makeInput("fontFamily", settings.appearance.fontFamily)),
      field(i18n.t("baseFontSize"), makeInput("baseFontSize", String(settings.appearance.baseFontSize), "number")),
      field(i18n.t("textColor"), makeInput("textColor", settings.appearance.textColor, "color")),
      field(i18n.t("backgroundColor"), makeInput("backgroundColor", settings.appearance.backgroundColor, "color")),
      field(i18n.t("backgroundImage"), makeInput("backgroundImage", settings.appearance.backgroundImage, "url"), true),
      field(i18n.t("backgroundEffect"), makeSelect("backgroundEffect", [
        ["none", i18n.t("effectNone")],
        ["gradient", i18n.t("effectGradient")],
        ["aurora", i18n.t("effectAurora")],
        ["mesh", i18n.t("effectMesh")],
        ["spotlight", i18n.t("effectSpotlight")],
        ["noise", i18n.t("effectNoise")],
      ], settings.appearance.backgroundEffect)),
    ]),
    section(i18n.t("sectionSettingsButton"), [
      field(i18n.t("settingsButtonVisibility"), makeSelect("settingsVisibility", [
        ["always", i18n.t("visibilityAlways")],
        ["hover", i18n.t("visibilityHover")],
      ], settings.settingsButton.visibility)),
    ]),
    section(i18n.t("sectionDateTime"), [
      field(i18n.t("dateTimeMode"), makeSelect("dateTimeMode", [
        ["both", i18n.t("dateTimeBoth")],
        ["date", i18n.t("dateTimeDate")],
        ["time", i18n.t("dateTimeTime")],
      ], settings.dateTime.mode)),
      field(i18n.t("dateFormat"), makeInput("dateFormat", settings.dateTime.dateFormat)),
      field(i18n.t("timeFormat"), makeInput("timeFormat", settings.dateTime.timeFormat)),
    ]),
    section(i18n.t("sectionSearchIp"), [
      field(i18n.t("searchProvider"), makeSelect(
        "searchProvider",
        settings.search.providers.map((provider) => [provider.id, provider.title]),
        settings.search.provider,
      )),
      field(i18n.t("searchProvidersJson"), makeTextarea("searchProvidersJson", JSON.stringify(settings.search.providers, null, 2)), true),
      field(i18n.t("ipEndpoint"), makeInput("ipEndpoint", settings.ip.endpoint, "url"), true),
    ]),
    section(i18n.t("sectionGoogleCalendar"), [
      field(i18n.t("calendarId"), makeInput("calendarId", settings.googleCalendar.calendarId)),
      field(i18n.t("calendarMaxResults"), makeInput("calendarMaxResults", String(settings.googleCalendar.maxResults), "number")),
    ]),
    section(i18n.t("sectionWeather"), [
      field(i18n.t("weatherProvider"), makeSelect("weatherProvider", [["open-meteo", "Open-Meteo"]], settings.weather.provider)),
      field(i18n.t("weatherCity"), makeInput("weatherCity", settings.weather.city)),
      field(i18n.t("weatherLatitude"), makeInput("weatherLatitude", String(settings.weather.latitude), "number", "-90")),
      field(i18n.t("weatherLongitude"), makeInput("weatherLongitude", String(settings.weather.longitude), "number", "-180")),
      field(i18n.t("weatherDisplayMode"), makeSelect("weatherDisplayMode", [
        ["current", i18n.t("weatherModeCurrent")],
        ["day", i18n.t("weatherModeDay")],
        ["week", i18n.t("weatherModeWeek")],
      ], settings.weather.displayMode)),
    ]),
    section(i18n.t("sectionLinks"), [
      field(i18n.t("linkColumns"), makeInput("linkColumns", String(settings.links.columns), "number")),
      field(i18n.t("linkRows"), makeInput("linkRows", String(settings.links.rows), "number")),
      field(i18n.t("linkDirection"), makeSelect("linkDirection", [
        ["horizontal", i18n.t("directionHorizontal")],
        ["vertical", i18n.t("directionVertical")],
      ], settings.links.pageDirection)),
      field(i18n.t("linkFontSize"), makeInput("linkFontSize", String(settings.links.fontSize), "number")),
      field(i18n.t("linkIconSize"), makeInput("linkIconSize", String(settings.links.iconSize), "number")),
      field(i18n.t("linksJson"), makeTextarea("linksJson", JSON.stringify(settings.links.items, null, 2)), true),
    ]),
    section(i18n.t("blockTitleStartPinned"), [
      field(i18n.t("linksJson"), makeTextarea("startPinnedJson", JSON.stringify(settings.startPinned.items, null, 2)), true),
    ]),
    section(i18n.t("sectionTimers"), [
      field(i18n.t("timerSeconds"), makeInput("timerSeconds", String(settings.timers.timerSeconds), "number")),
      field(i18n.t("pomodoroWorkSeconds"), makeInput("pomodoroWorkSeconds", String(settings.timers.pomodoroWorkSeconds), "number")),
      field(i18n.t("pomodoroBreakSeconds"), makeInput("pomodoroBreakSeconds", String(settings.timers.pomodoroBreakSeconds), "number")),
      field(i18n.t("notifyOnComplete"), makeCheckbox("notifyOnComplete", settings.timers.notifyOnComplete)),
    ]),
    section(i18n.t("sectionFocusStats"), [
      field(i18n.t("defaultMinutesPerAvoidedVisit"), makeInput("defaultMinutesPerAvoidedVisit", String(settings.focusStats.defaultMinutesPerAvoidedVisit), "number")),
      field(i18n.t("avoidedVisitDedupeSeconds"), makeInput("avoidedVisitDedupeSeconds", String(settings.focusStats.avoidedVisitDedupeSeconds), "number")),
      field(i18n.t("domainMinutesJson"), makeTextarea("domainMinutesJson", JSON.stringify(settings.focusStats.domainMinutes, null, 2)), true),
    ]),
    section(i18n.t("sectionLayout"), [
      field(i18n.t("layoutColumns"), makeInput("layoutColumns", String(settings.layout.columns), "number")),
      field(i18n.t("layoutProfile"), makeInput("layoutProfile", settings.layout.profile)),
      layoutPresetControls(),
      layoutEditor(),
      field(i18n.t("layoutBlocksJson"), makeTextarea("layoutBlocksJson", JSON.stringify(settings.layout.blocks, null, 2)), true),
    ]),
    actions(),
  );
}

function section(title: string, fields: HTMLElement[]): HTMLElement {
  const sectionEl = document.createElement("section");
  sectionEl.className = "section";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const grid = document.createElement("div");
  grid.className = "grid";
  grid.append(...fields);
  sectionEl.append(heading, grid);
  return sectionEl;
}

function field(labelText: string, control: HTMLElement, wide = false): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = wide ? "field field--wide" : "field";
  const span = document.createElement("span");
  span.textContent = labelText;
  wrapper.append(span, control);
  return wrapper;
}

function makeInput(id: string, value: string, type = "text", min = type === "number" ? "1" : ""): HTMLInputElement {
  const element = document.createElement("input");
  element.id = id;
  element.type = type;
  element.value = value;
  if (min) element.min = min;
  return element;
}

function makeSelect(id: string, options: string[][], value: string): HTMLSelectElement {
  const element = document.createElement("select");
  element.id = id;
  for (const [optionValue, label] of options) {
    const option = document.createElement("option");
    option.value = optionValue ?? "";
    option.textContent = label ?? optionValue ?? "";
    option.selected = option.value === value;
    element.append(option);
  }
  return element;
}

function makeTextarea(id: string, value: string): HTMLTextAreaElement {
  const element = document.createElement("textarea");
  element.id = id;
  element.spellcheck = false;
  element.value = value;
  return element;
}

function makeCheckbox(id: string, checked: boolean): HTMLElement {
  const wrapper = document.createElement("span");
  wrapper.className = "checkbox";
  const element = document.createElement("input");
  element.id = id;
  element.type = "checkbox";
  element.checked = checked;
  const label = document.createElement("span");
  label.textContent = i18n.t("enabled");
  wrapper.append(element, label);
  return wrapper;
}

function backupControls(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "actions field--wide";

  const file = document.createElement("input");
  file.id = "backupFile";
  file.type = "file";
  file.accept = "application/json,.json";

  const exportButton = actionButton("exportBackup", handleExport);
  const importButton = actionButton("importBackup", () => handleImport(file.files?.[0]));
  const chromeSyncUploadButton = actionButton("chromeSyncUpload", handleChromeSyncUpload);
  const chromeSyncRestoreButton = actionButton("chromeSyncRestore", handleChromeSyncRestore);
  const driveUploadButton = actionButton("driveBackupUpload", handleDriveUpload);
  const driveRestoreButton = actionButton("driveBackupRestore", handleDriveRestore);

  wrapper.append(exportButton, file, importButton, chromeSyncUploadButton, chromeSyncRestoreButton, driveUploadButton, driveRestoreButton);
  return wrapper;
}

function actionButton(labelKey: string, handler: () => Promise<void>): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "button button--secondary";
  button.type = "button";
  button.textContent = i18n.t(labelKey);
  button.addEventListener("click", () => void handler());
  return button;
}

function layoutPresetControls(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "actions field--wide";
  const preset = makeSelect(
    "layoutPreset",
    LAYOUT_PRESETS.map((item) => [item.id, item.title]),
    settings.layout.profile,
  );
  const apply = actionButton("applyLayoutPreset", async () => {
    applyLayoutPreset(preset.value);
  });
  wrapper.append(preset, apply);
  return wrapper;
}

function applyLayoutPreset(presetId: string): void {
  const preset = LAYOUT_PRESETS.find((item) => item.id === presetId);
  if (!preset) return;
  const blocks = cloneLayoutBlocks(preset.blocks);
  input("layoutColumns").value = String(preset.columns);
  input("layoutProfile").value = preset.id;
  textarea("layoutBlocksJson").value = JSON.stringify(blocks, null, 2);
  rebuildLayoutEditor(blocks);
  statusEl.textContent = i18n.t("layoutPresetApplied");
}

function layoutEditor(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "layout-editor field--wide";
  wrapper.id = "layoutEditor";
  rebuildLayoutEditorRows(wrapper, settings.layout.blocks);
  return wrapper;
}

function rebuildLayoutEditor(blocks: LayoutBlock[]): void {
  const editor = document.getElementById("layoutEditor");
  if (!editor) return;
  rebuildLayoutEditorRows(editor, blocks);
}

function rebuildLayoutEditorRows(editor: HTMLElement, blocks: LayoutBlock[]): void {
  editor.innerHTML = "";
  for (const block of blocks) editor.append(layoutEditorRow(block));
}

function layoutEditorRow(block: LayoutBlock): HTMLElement {
  const row = document.createElement("div");
  row.className = "layout-row";
  row.draggable = true;
  row.dataset.block = JSON.stringify(block);

  const drag = document.createElement("span");
  drag.className = "layout-row__drag";
  drag.textContent = "::";

  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = block.enabled;
  enabled.dataset.field = "enabled";

  const title = document.createElement("strong");
  title.textContent = block.title;

  const type = document.createElement("small");
  type.textContent = block.type;

  row.append(drag, enabled, title, type);
  for (const key of ["column", "row", "width", "height"] as const) {
    const number = document.createElement("input");
    number.type = "number";
    number.min = "1";
    number.value = String(block[key]);
    number.title = i18n.t(`layout${key.charAt(0).toUpperCase()}${key.slice(1)}`);
    number.dataset.field = key;
    row.append(number);
  }
  row.append(resizeControls());

  row.addEventListener("dragstart", () => row.classList.add("layout-row--dragging"));
  row.addEventListener("dragend", () => {
    row.classList.remove("layout-row--dragging");
    syncLayoutJsonFromEditor();
  });
  row.addEventListener("dragover", (event) => event.preventDefault());
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    const editor = requireElement<HTMLDivElement>("layoutEditor");
    const dragged = editor.querySelector<HTMLElement>(".layout-row--dragging");
    if (!dragged || dragged === row) return;
    editor.insertBefore(dragged, row);
    syncLayoutJsonFromEditor();
  });
  row.addEventListener("input", syncLayoutJsonFromEditor);
  row.addEventListener("change", syncLayoutJsonFromEditor);
  row.addEventListener("click", handleResizeClick);

  return row;
}

function resizeControls(): HTMLElement {
  const controls = document.createElement("div");
  controls.className = "layout-row__resize";
  for (const [fieldName, delta, label, title] of [
    ["width", -1, "W-", `${i18n.t("layoutWidth")} -1`],
    ["width", 1, "W+", `${i18n.t("layoutWidth")} +1`],
    ["height", -1, "H-", `${i18n.t("layoutHeight")} -1`],
    ["height", 1, "H+", `${i18n.t("layoutHeight")} +1`],
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = title;
    button.dataset.resizeField = fieldName;
    button.dataset.resizeDelta = String(delta);
    controls.append(button);
  }
  return controls;
}

function handleResizeClick(event: MouseEvent): void {
  const button = event.target instanceof HTMLButtonElement ? event.target : null;
  if (!button?.dataset.resizeField || !button.dataset.resizeDelta) return;
  const row = button.closest<HTMLElement>(".layout-row");
  if (!row) return;
  const target = row.querySelector<HTMLInputElement>(`[data-field="${button.dataset.resizeField}"]`);
  if (!target) return;
  const delta = Number(button.dataset.resizeDelta);
  const current = Number(target.value);
  target.value = String(Math.max(1, (Number.isFinite(current) ? current : 1) + delta));
  syncLayoutJsonFromEditor();
}

function syncLayoutJsonFromEditor(): void {
  const target = document.getElementById("layoutBlocksJson") as HTMLTextAreaElement | null;
  const editor = document.getElementById("layoutEditor");
  if (!target || !editor) return;
  const blocks = readLayoutBlocksFromEditor(editor);
  target.value = JSON.stringify(blocks, null, 2);
}

function readLayoutBlocksFromEditor(editor: HTMLElement): LayoutBlock[] {
  const blocks: LayoutBlock[] = [];
  for (const row of Array.from(editor.querySelectorAll<HTMLElement>(".layout-row"))) {
    const original = readRowBlock(row);
    if (!original) continue;
    blocks.push({
      ...original,
      enabled: row.querySelector<HTMLInputElement>('[data-field="enabled"]')?.checked ?? original.enabled,
      column: fieldNumber(row, "column", original.column),
      row: fieldNumber(row, "row", original.row),
      width: fieldNumber(row, "width", original.width),
      height: fieldNumber(row, "height", original.height),
    });
  }
  return blocks;
}

function readRowBlock(row: HTMLElement): LayoutBlock | null {
  try {
    const value = row.dataset.block;
    return value ? JSON.parse(value) as LayoutBlock : null;
  } catch {
    return null;
  }
}

function fieldNumber(row: HTMLElement, fieldName: string, fallback: number): number {
  const value = Number(row.querySelector<HTMLInputElement>(`[data-field="${fieldName}"]`)?.value);
  return Number.isFinite(value) ? Math.max(1, value) : fallback;
}

function actions(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "actions";
  const save = document.createElement("button");
  save.className = "button";
  save.type = "submit";
  save.textContent = i18n.t("saveSettings");
  wrapper.append(save);
  return wrapper;
}

function parseJson<T>(id: string): T {
  try {
    return JSON.parse(textarea(id).value) as T;
  } catch (error) {
    throw new Error(i18n.t("invalidJson", { field: id, error: error instanceof Error ? error.message : String(error) }));
  }
}

async function handleExport(): Promise<void> {
  const bundle = await exportBackup();
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = backupFileName();
  anchor.click();
  URL.revokeObjectURL(url);
  statusEl.textContent = i18n.t("backupExported");
}

async function handleImport(file: File | undefined): Promise<void> {
  if (!file) {
    statusEl.textContent = i18n.t("backupFileRequired");
    return;
  }
  const text = await file.text();
  await importBackup(JSON.parse(text));
  await reloadSettings();
  statusEl.textContent = i18n.t("backupImported");
}

async function handleChromeSyncUpload(): Promise<void> {
  try {
    await uploadChromeSyncBackup();
    statusEl.textContent = i18n.t("chromeSyncUploaded");
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function handleChromeSyncRestore(): Promise<void> {
  try {
    await restoreChromeSyncBackup();
    await reloadSettings();
    statusEl.textContent = i18n.t("chromeSyncRestored");
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function handleDriveUpload(): Promise<void> {
  if (!isGoogleIntegrationConfigured()) {
    statusEl.textContent = i18n.t("googleNotConfigured");
    return;
  }
  try {
    await uploadDriveBackup();
    statusEl.textContent = i18n.t("driveBackupUploaded");
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function handleDriveRestore(): Promise<void> {
  if (!isGoogleIntegrationConfigured()) {
    statusEl.textContent = i18n.t("googleNotConfigured");
    return;
  }
  try {
    await restoreDriveBackup();
    await reloadSettings();
    statusEl.textContent = i18n.t("driveBackupRestored");
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function reloadSettings(): Promise<void> {
  settings = await getStartPageSettings();
  localePreference = await getLocalePreference();
  render();
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  syncLayoutJsonFromEditor();
  try {
    const next: StartPageSettings = {
      ...settings,
      appearance: {
        ...settings.appearance,
        fontFamily: input("fontFamily").value.trim() || settings.appearance.fontFamily,
        baseFontSize: numberValue("baseFontSize", settings.appearance.baseFontSize),
        textColor: input("textColor").value,
        backgroundColor: input("backgroundColor").value,
        backgroundImage: input("backgroundImage").value.trim(),
        backgroundEffect: select("backgroundEffect").value as BackgroundEffect,
      },
      settingsButton: {
        ...settings.settingsButton,
        visibility: select("settingsVisibility").value as SettingsButtonVisibility,
      },
      dateTime: {
        mode: select("dateTimeMode").value as DateTimeMode,
        dateFormat: input("dateFormat").value.trim() || settings.dateTime.dateFormat,
        timeFormat: input("timeFormat").value.trim() || settings.dateTime.timeFormat,
      },
      ip: {
        endpoint: input("ipEndpoint").value.trim() || settings.ip.endpoint,
      },
      links: {
        ...settings.links,
        columns: numberValue("linkColumns", settings.links.columns),
        rows: numberValue("linkRows", settings.links.rows),
        pageDirection: select("linkDirection").value as LinkPageDirection,
        fontSize: numberValue("linkFontSize", settings.links.fontSize),
        iconSize: numberValue("linkIconSize", settings.links.iconSize),
        items: parseJson<StartLink[]>("linksJson"),
      },
      startPinned: {
        items: parseJson<StartLink[]>("startPinnedJson"),
      },
      search: {
        provider: select("searchProvider").value as SearchProviderId,
        providers: parseJson<SearchProvider[]>("searchProvidersJson"),
      },
      googleCalendar: {
        calendarId: input("calendarId").value.trim() || settings.googleCalendar.calendarId,
        maxResults: numberValue("calendarMaxResults", settings.googleCalendar.maxResults),
      },
      weather: {
        provider: "open-meteo",
        city: input("weatherCity").value.trim() || settings.weather.city,
        latitude: numberValue("weatherLatitude", settings.weather.latitude),
        longitude: numberValue("weatherLongitude", settings.weather.longitude),
        displayMode: select("weatherDisplayMode").value as WeatherDisplayMode,
      },
      timers: {
        timerSeconds: numberValue("timerSeconds", settings.timers.timerSeconds),
        pomodoroWorkSeconds: numberValue("pomodoroWorkSeconds", settings.timers.pomodoroWorkSeconds),
        pomodoroBreakSeconds: numberValue("pomodoroBreakSeconds", settings.timers.pomodoroBreakSeconds),
        notifyOnComplete: input("notifyOnComplete").checked,
      },
      focusStats: {
        defaultMinutesPerAvoidedVisit: numberValue("defaultMinutesPerAvoidedVisit", settings.focusStats.defaultMinutesPerAvoidedVisit),
        avoidedVisitDedupeSeconds: numberValue("avoidedVisitDedupeSeconds", settings.focusStats.avoidedVisitDedupeSeconds),
        domainMinutes: parseJson<Record<string, number>>("domainMinutesJson"),
      },
      layout: {
        columns: numberValue("layoutColumns", settings.layout.columns),
        profile: input("layoutProfile").value.trim() || settings.layout.profile,
        blocks: parseJson<LayoutBlock[]>("layoutBlocksJson"),
      },
    };

    await setLocalePreference(select("locale").value as LocalePreference);
    await setStartPageSettings(next);
    settings = next;
    localePreference = await getLocalePreference();
    statusEl.textContent = i18n.t("settingsSaved");
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  }
});

resetEl.addEventListener("click", async () => {
  settings = await resetStartPageSettings();
  await setLocalePreference("auto");
  localePreference = "auto";
  render();
  statusEl.textContent = i18n.t("settingsReset");
});

void (async () => {
  [i18n, settings, localePreference] = await Promise.all([
    loadI18n(),
    getStartPageSettings(),
    getLocalePreference(),
  ]);
  render();
})();
