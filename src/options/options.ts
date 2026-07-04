import { backupFileName, exportBackup, importBackup } from "../lib/backup.js";
import { clearAll, getBlockedSites, replaceBlockedSites } from "../lib/blocklist.js";
import { restoreChromeSyncBackup, syncChromeSyncBackup, uploadChromeSyncBackup } from "../lib/chrome-sync.js";
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

type OptionsTab = "general" | "startTab" | "blocklist" | "backup" | "about";

const TABS: Array<{ id: OptionsTab; labelKey: string }> = [
  { id: "general", labelKey: "tabGeneral" },
  { id: "startTab", labelKey: "tabStartTab" },
  { id: "blocklist", labelKey: "tabBlocklist" },
  { id: "backup", labelKey: "tabBackup" },
  { id: "about", labelKey: "tabAbout" },
];

const titleEl = requireElement<HTMLHeadingElement>("title");
const subtitleEl = requireElement<HTMLParagraphElement>("subtitle");
const formEl = requireElement<HTMLFormElement>("form");
const resetEl = requireElement<HTMLButtonElement>("reset");
const statusEl = requireElement<HTMLParagraphElement>("status");

let i18n: I18n;
let settings: StartPageSettings;
let localePreference: LocalePreference;
let blockedSites: string[] = [];
let activeTab: OptionsTab = "general";

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
  formEl.append(tabbedOptions(), actions());
}

function tabbedOptions(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "tabs";

  const nav = document.createElement("nav");
  nav.className = "tabs__nav";
  nav.setAttribute("aria-label", i18n.t("optionsMenu"));

  const panels = document.createElement("div");
  panels.className = "tabs__panels";

  for (const tab of TABS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = tab.id === activeTab ? "tabs__button tabs__button--active" : "tabs__button";
    button.textContent = i18n.t(tab.labelKey);
    button.setAttribute("aria-controls", `panel-${tab.id}`);
    button.setAttribute("aria-selected", String(tab.id === activeTab));
    button.addEventListener("click", () => setActiveTab(tab.id));
    nav.append(button);
  }

  for (const tab of TABS) panels.append(tabPanel(tab.id, sectionsFor(tab.id)));
  wrapper.append(nav, panels);
  return wrapper;
}

function setActiveTab(tab: OptionsTab): void {
  activeTab = tab;
  document.querySelectorAll<HTMLElement>(".tabs__button").forEach((button, index) => {
    const selected = TABS[index]?.id === tab;
    button.classList.toggle("tabs__button--active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  document.querySelectorAll<HTMLElement>(".tabs__panel").forEach((panel) => {
    panel.hidden = panel.id !== `panel-${tab}`;
  });
}

function tabPanel(tab: OptionsTab, sections: HTMLElement[]): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "tabs__panel";
  panel.id = `panel-${tab}`;
  panel.hidden = tab !== activeTab;
  panel.append(...sections);
  return panel;
}

function sectionsFor(tab: OptionsTab): HTMLElement[] {
  switch (tab) {
    case "general":
      return [generalSection()];
    case "startTab":
      return startTabSections();
    case "blocklist":
      return [blocklistSection()];
    case "backup":
      return [section(i18n.t("sectionBackup"), [backupControls()])];
    case "about":
      return [aboutSection(), newTabDiagnosticsSection()];
  }
}

function generalSection(): HTMLElement {
  return section(i18n.t("sectionGeneral"), [
    field(i18n.t("localePreference"), makeSelect("locale", [
      ["auto", i18n.t("localeAuto")],
      ["en", "English"],
      ["ru", "Русский"],
    ], localePreference)),
    wideNote(i18n.t("generalSettingsNote")),
  ]);
}

function startTabSections(): HTMLElement[] {
  return [
    section(i18n.t("sectionStartTab"), [
      field(i18n.t("startTabEnabled"), makeCheckbox("startTabEnabled", settings.startTab.enabled)),
      wideNote(i18n.t("startTabEnabledNote")),
    ]),
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
      field(i18n.t("settingsButtonHoverArea"), makeSelect("settingsHoverArea", [
        ["top", i18n.t("hoverAreaTop")],
        ["top-right", i18n.t("hoverAreaTopRight")],
        ["right", i18n.t("hoverAreaRight")],
      ], settings.settingsButton.hoverArea)),
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
      field(i18n.t("weatherForecastEndpoint"), makeInput("weatherForecastEndpoint", settings.weather.forecastEndpoint, "url"), true),
      field(i18n.t("weatherGeocodingEndpoint"), makeInput("weatherGeocodingEndpoint", settings.weather.geocodingEndpoint, "url"), true),
    ]),
    section(i18n.t("sectionLinks"), [
      field(i18n.t("linkColumns"), makeInput("linkColumns", String(settings.links.columns), "number")),
      field(i18n.t("linkRows"), makeInput("linkRows", String(settings.links.rows), "number")),
      field(i18n.t("linkDirection"), makeSelect("linkDirection", [
        ["horizontal", i18n.t("directionHorizontal")],
        ["vertical", i18n.t("directionVertical")],
      ], settings.links.pageDirection)),
      field(i18n.t("linkFontFamily"), makeInput("linkFontFamily", settings.links.fontFamily)),
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
  ];
}

function blocklistSection(): HTMLElement {
  return section(i18n.t("sectionBlocklist"), [
    wideNote(i18n.t("blocklistSettingsNote")),
    field(i18n.t("blockedSites"), makeTextarea("blockedSites", blockedSites.join("\n")), true),
    blocklistControls(),
  ]);
}

function aboutSection(): HTMLElement {
  const manifest = chrome.runtime.getManifest();
  const wrapper = document.createElement("div");
  wrapper.className = "about field--wide";
  wrapper.append(
    aboutRow(i18n.t("extensionName"), manifest.name),
    aboutRow(i18n.t("extensionVersion"), manifest.version),
    aboutLink(i18n.t("githubRepository"), manifest.homepage_url ?? "https://github.com/lgg/start-tab-chromium"),
  );
  return section(i18n.t("sectionAbout"), [wrapper]);
}

function newTabDiagnosticsSection(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "actions field--wide";
  wrapper.append(
    actionButton("openStartTab", async () => {
      await chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html") });
    }),
  );
  return section(i18n.t("sectionNewTabDiagnostics"), [
    wideNote(i18n.t("newTabDiagnosticsNote")),
    wrapper,
  ]);
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

function wideNote(text: string): HTMLElement {
  const note = document.createElement("p");
  note.className = "note field--wide";
  note.textContent = text;
  return note;
}

function aboutRow(label: string, value: string): HTMLElement {
  const row = document.createElement("p");
  row.className = "about__row";
  row.append(`${label}: `, document.createTextNode(value));
  return row;
}

function aboutLink(label: string, url: string): HTMLElement {
  const row = document.createElement("p");
  row.className = "about__row";
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.textContent = url;
  row.append(`${label}: `, anchor);
  return row;
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

  wrapper.append(
    actionButton("exportBackup", handleExport),
    file,
    actionButton("importBackup", () => handleImport(file.files?.[0])),
    actionButton("chromeSyncSmartSync", handleChromeSyncSmartSync),
    actionButton("chromeSyncUpload", handleChromeSyncUpload),
    actionButton("chromeSyncRestore", handleChromeSyncRestore),
    actionButton("driveBackupUpload", handleDriveUpload),
    actionButton("driveBackupRestore", handleDriveRestore),
  );
  return wrapper;
}

function blocklistControls(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "actions field--wide";
  wrapper.append(actionButton("clearBlocklist", async () => {
    await clearAll();
    blockedSites = [];
    textarea("blockedSites").value = "";
    statusEl.textContent = i18n.t("blocklistCleared");
  }));
  return wrapper;
}

function showActionError(error: unknown): void {
  statusEl.textContent = error instanceof Error ? error.message : String(error);
}

function actionButton(labelKey: string, handler: () => Promise<void> | void): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "button button--secondary";
  button.type = "button";
  button.textContent = i18n.t(labelKey);
  button.addEventListener("click", () => {
    button.disabled = true;
    void Promise.resolve()
      .then(handler)
      .catch(showActionError)
      .finally(() => {
        button.disabled = false;
      });
  });
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
  const apply = actionButton("applyLayoutPreset", () => applyLayoutPreset(preset.value));
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
  const rows = document.createElement("div");
  rows.className = "layout-editor__rows";
  rows.id = "layoutRows";
  for (const block of blocks) rows.append(layoutEditorRow(block));
  editor.append(rows, layoutPreview(blocks));
}

function layoutEditorRow(block: LayoutBlock): HTMLElement {
  const row = document.createElement("div");
  row.className = "layout-row";
  row.draggable = true;
  row.dataset.block = JSON.stringify(block);
  row.dataset.blockId = block.id;

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

  row.addEventListener("dragstart", (event) => {
    row.classList.add("layout-row--dragging");
    event.dataTransfer?.setData("text/plain", block.id);
  });
  row.addEventListener("dragend", () => {
    row.classList.remove("layout-row--dragging");
    syncLayoutEditor();
  });
  row.addEventListener("dragover", (event) => event.preventDefault());
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    const rows = requireElement<HTMLDivElement>("layoutRows");
    const dragged = rows.querySelector<HTMLElement>(".layout-row--dragging");
    if (!dragged || dragged === row) return;
    rows.insertBefore(dragged, row);
    syncLayoutEditor();
  });
  row.addEventListener("input", syncLayoutEditor);
  row.addEventListener("change", syncLayoutEditor);
  row.addEventListener("click", handleResizeClick);
  return row;
}

function layoutPreview(blocks: LayoutBlock[]): HTMLElement {
  const preview = document.createElement("div");
  preview.className = "layout-preview";
  preview.id = "layoutPreview";
  preview.style.setProperty("--layout-preview-columns", String(layoutColumnCount()));
  preview.setAttribute("aria-label", i18n.t("sectionLayout"));
  preview.addEventListener("dragover", (event) => event.preventDefault());
  preview.addEventListener("drop", handlePreviewDrop);

  for (const block of blocks) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = block.enabled ? "layout-preview__block" : "layout-preview__block layout-preview__block--disabled";
    item.draggable = true;
    item.dataset.blockId = block.id;
    item.textContent = block.title;
    item.style.gridColumn = `${block.column} / span ${block.width}`;
    item.style.gridRow = `${block.row} / span ${block.height}`;
    item.addEventListener("dragstart", (event) => event.dataTransfer?.setData("text/plain", block.id));
    preview.append(item);
  }
  return preview;
}

function layoutColumnCount(): number {
  const element = document.getElementById("layoutColumns");
  const columns = element instanceof HTMLInputElement ? Number(element.value) : settings.layout.columns;
  return Number.isFinite(columns) ? Math.max(1, Math.round(columns)) : settings.layout.columns;
}

function handlePreviewDrop(event: DragEvent): void {
  event.preventDefault();
  const preview = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const blockId = event.dataTransfer?.getData("text/plain");
  if (!preview || !blockId) return;

  const row = Array.from(document.querySelectorAll<HTMLElement>(".layout-row"))
    .find((candidate) => candidate.dataset.blockId === blockId);
  if (!row) return;

  const rect = preview.getBoundingClientRect();
  const columns = layoutColumnCount();
  const cellWidth = rect.width / columns;
  const cellHeight = 30;
  const column = Math.min(columns, Math.max(1, Math.floor((event.clientX - rect.left) / cellWidth) + 1));
  const targetRow = Math.max(1, Math.floor((event.clientY - rect.top) / cellHeight) + 1);
  const widthInput = row.querySelector<HTMLInputElement>('[data-field="width"]');
  const columnInput = row.querySelector<HTMLInputElement>('[data-field="column"]');
  const rowInput = row.querySelector<HTMLInputElement>('[data-field="row"]');
  const width = Number(widthInput?.value);
  const maxColumn = Math.max(1, columns - (Number.isFinite(width) ? width : 1) + 1);
  if (columnInput) columnInput.value = String(Math.min(column, maxColumn));
  if (rowInput) rowInput.value = String(targetRow);
  syncLayoutEditor();
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
  syncLayoutEditor();
}

function syncLayoutEditor(): void {
  syncLayoutJsonFromEditor();
  rebuildLayoutPreviewFromEditor();
}

function syncLayoutJsonFromEditor(): void {
  const target = document.getElementById("layoutBlocksJson") as HTMLTextAreaElement | null;
  const editor = document.getElementById("layoutEditor");
  if (!target || !editor) return;
  target.value = JSON.stringify(readLayoutBlocksFromEditor(editor), null, 2);
}

function rebuildLayoutPreviewFromEditor(): void {
  const editor = document.getElementById("layoutEditor");
  const preview = document.getElementById("layoutPreview");
  if (!editor || !preview) return;
  preview.replaceWith(layoutPreview(readLayoutBlocksFromEditor(editor)));
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
  wrapper.className = "actions actions--sticky";
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

function parseBlockedSites(): string[] {
  return textarea("blockedSites").value.split(/[\n,;\s]+/).map((site) => site.trim()).filter(Boolean);
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

async function handleChromeSyncSmartSync(): Promise<void> {
  try {
    const result = await syncChromeSyncBackup();
    if (result === "restored") await reloadSettings();
    statusEl.textContent = i18n.t(result === "restored" ? "chromeSyncSmartRestored" : "chromeSyncSmartUploaded");
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  }
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

async function reloadSettings(reloadCatalog = false): Promise<void> {
  [settings, localePreference, blockedSites] = await Promise.all([
    getStartPageSettings(),
    getLocalePreference(),
    getBlockedSites(),
  ]);
  if (reloadCatalog) i18n = await loadI18n();
  render();
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  syncLayoutJsonFromEditor();
  try {
    const nextLocale = select("locale").value as LocalePreference;
    const next: StartPageSettings = {
      ...settings,
      startTab: {
        enabled: input("startTabEnabled").checked,
      },
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
        hoverArea: select("settingsHoverArea").value as StartPageSettings["settingsButton"]["hoverArea"],
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
        fontFamily: input("linkFontFamily").value.trim() || settings.links.fontFamily,
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
        forecastEndpoint: input("weatherForecastEndpoint").value.trim() || settings.weather.forecastEndpoint,
        geocodingEndpoint: input("weatherGeocodingEndpoint").value.trim() || settings.weather.geocodingEndpoint,
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
        ...settings.layout,
        columns: numberValue("layoutColumns", settings.layout.columns),
        profile: input("layoutProfile").value.trim() || settings.layout.profile,
        blocks: parseJson<LayoutBlock[]>("layoutBlocksJson"),
      },
    };

    await setLocalePreference(nextLocale);
    await setStartPageSettings(next);
    blockedSites = await replaceBlockedSites(parseBlockedSites());
    await reloadSettings(nextLocale !== localePreference);
    statusEl.textContent = i18n.t("settingsSaved");
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  }
});

resetEl.addEventListener("click", () => {
  resetEl.disabled = true;
  void Promise.resolve()
    .then(async () => {
      settings = await resetStartPageSettings();
      await setLocalePreference("auto");
      localePreference = "auto";
      i18n = await loadI18n();
      render();
      statusEl.textContent = i18n.t("settingsReset");
    })
    .catch(showActionError)
    .finally(() => {
      resetEl.disabled = false;
    });
});

void (async () => {
  [i18n, settings, localePreference, blockedSites] = await Promise.all([
    loadI18n(),
    getStartPageSettings(),
    getLocalePreference(),
    getBlockedSites(),
  ]);
  render();
})().catch(showActionError);
