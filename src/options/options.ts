import { backupFileName, exportBackup, importBackup } from "../lib/backup.js";
import {
  getLocalePreference,
  loadI18n,
  setLocalePreference,
  type I18n,
  type LocalePreference,
} from "../lib/i18n.js";
import {
  getStartPageSettings,
  resetStartPageSettings,
  setStartPageSettings,
  type BackgroundEffect,
  type DateTimeMode,
  type LayoutBlock,
  type LinkPageDirection,
  type SearchProviderId,
  type SettingsButtonVisibility,
  type StartLink,
  type StartPageSettings,
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
      field(i18n.t("ipEndpoint"), makeInput("ipEndpoint", settings.ip.endpoint, "url"), true),
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
    section(i18n.t("sectionPinned"), [
      field(i18n.t("startPinnedJson"), makeTextarea("startPinnedJson", JSON.stringify(settings.startPinned.items, null, 2)), true),
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

function makeInput(id: string, value: string, type = "text"): HTMLInputElement {
  const element = document.createElement("input");
  element.id = id;
  element.type = type;
  element.value = value;
  if (type === "number") element.min = "1";
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

  const exportButton = document.createElement("button");
  exportButton.className = "button button--secondary";
  exportButton.type = "button";
  exportButton.textContent = i18n.t("exportBackup");
  exportButton.addEventListener("click", () => void handleExport());

  const importButton = document.createElement("button");
  importButton.className = "button button--secondary";
  importButton.type = "button";
  importButton.textContent = i18n.t("importBackup");
  importButton.addEventListener("click", () => void handleImport(file.files?.[0]));

  wrapper.append(exportButton, file, importButton);
  return wrapper;
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
  settings = await getStartPageSettings();
  localePreference = await getLocalePreference();
  render();
  statusEl.textContent = i18n.t("backupImported");
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
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
        ...settings.search,
        provider: select("searchProvider").value as SearchProviderId,
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
