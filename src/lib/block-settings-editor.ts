import type { I18n } from "./i18n.js";
import {
  blockTitleKey,
  blockUsesDefaultTitle,
  cloneBlock,
  normalizeBlockConfig,
  type BlockConfig,
  type BlockInstance,
  type SearchProvider,
  type StartLink,
  type ValidationIssue,
} from "./start-page-settings.js";

interface DialogResult {
  block: BlockInstance | null;
}

interface FieldOptions {
  description?: string;
  wide?: boolean;
}

interface NumberOptions {
  min: number;
  max: number;
  step?: number | "any";
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

function button(text: string, className = "button", type: "button" | "submit" = "button"): HTMLButtonElement {
  const node = element("button", className, text);
  node.type = type;
  return node;
}

function field(labelText: string, control: HTMLElement, options: FieldOptions = {}): HTMLElement {
  const wrapper = element("label", options.wide ? "settings-field settings-field--wide" : "settings-field");
  const label = element("span", "settings-field__label", labelText);
  wrapper.append(label, control);
  if (options.description) wrapper.append(element("span", "settings-field__description", options.description));
  return wrapper;
}

function textInput(value: string, type: "text" | "url" = "text"): HTMLInputElement {
  const input = element("input", "input");
  input.type = type;
  input.value = value;
  input.autocomplete = "off";
  return input;
}

function numberInput(value: number, options: NumberOptions): HTMLInputElement {
  const input = element("input", "input");
  input.type = "number";
  input.value = String(value);
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = options.step === "any" ? "any" : String(options.step ?? 1);
  return input;
}

function checkboxInput(value: boolean): HTMLInputElement {
  const input = element("input", "checkbox");
  input.type = "checkbox";
  input.checked = value;
  return input;
}

function selectInput<T extends string>(value: T, options: Array<[T, string]>): HTMLSelectElement {
  const select = element("select", "select");
  for (const [optionValue, title] of options) {
    const option = element("option", "", title);
    option.value = optionValue;
    option.selected = optionValue === value;
    select.append(option);
  }
  return select;
}

function readNumber(input: HTMLInputElement, fallback: number): number {
  const parsed = Number(input.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function makeId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function issuesText(i18n: I18n, issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${i18n.t(issue.messageKey, issue.replacements)}`).join("\n");
}

function linksEditor(i18n: I18n, initial: readonly StartLink[]): { root: HTMLElement; read: () => StartLink[] } {
  const root = element("div", "collection-editor");
  const list = element("div", "collection-editor__list");
  const add = button(i18n.t("addLink"), "button button--secondary");

  const appendRow = (item: StartLink): void => {
    const row = element("div", "collection-row");
    row.dataset.itemId = item.id;
    const icon = textInput(item.icon);
    icon.placeholder = i18n.t("linkIcon");
    icon.setAttribute("aria-label", i18n.t("linkIcon"));
    const title = textInput(item.title);
    title.placeholder = i18n.t("linkTitle");
    title.setAttribute("aria-label", i18n.t("linkTitle"));
    const url = textInput(item.url, "url");
    url.placeholder = "https://";
    url.setAttribute("aria-label", i18n.t("linkUrl"));
    const remove = button("×", "icon-button");
    remove.title = i18n.t("removeLink");
    remove.setAttribute("aria-label", i18n.t("removeLink"));
    remove.addEventListener("click", () => row.remove());
    row.append(icon, title, url, remove);
    list.append(row);
  };

  initial.forEach(appendRow);
  add.addEventListener("click", () => appendRow({ id: makeId("link"), icon: "", title: "", url: "" }));
  root.append(list, add);

  return {
    root,
    read: () => Array.from(list.querySelectorAll<HTMLElement>(".collection-row")).map((row) => {
      const inputs = row.querySelectorAll<HTMLInputElement>("input");
      return {
        id: row.dataset.itemId || makeId("link"),
        icon: inputs[0]?.value ?? "",
        title: inputs[1]?.value ?? "",
        url: inputs[2]?.value ?? "",
      };
    }),
  };
}

export function providerSelectionIndexAfterEdit(
  selectedId: string,
  selectedIndex: number,
  providers: readonly SearchProvider[],
): number {
  if (providers.length === 0) return -1;
  if (selectedIndex >= 0 && providers[selectedIndex]?.id === selectedId) return selectedIndex;
  const matchingIndex = providers.findIndex((provider) => provider.id === selectedId);
  if (matchingIndex >= 0) return matchingIndex;
  return Math.min(Math.max(selectedIndex, 0), providers.length - 1);
}

function providersEditor(
  i18n: I18n,
  initial: readonly SearchProvider[],
  onChange: (providers: SearchProvider[]) => void,
): { root: HTMLElement; read: () => SearchProvider[] } {
  const root = element("div", "collection-editor");
  const list = element("div", "collection-editor__list");
  const add = button(i18n.t("addSearchProvider"), "button button--secondary");

  const read = (): SearchProvider[] => Array.from(list.querySelectorAll<HTMLElement>(".collection-row")).map((row) => {
    const inputs = row.querySelectorAll<HTMLInputElement>("input");
    return {
      id: inputs[0]?.value ?? "",
      title: inputs[1]?.value ?? "",
      urlTemplate: inputs[2]?.value ?? "",
    };
  });
  const notify = (): void => onChange(read());

  const appendRow = (provider: SearchProvider): void => {
    const row = element("div", "collection-row collection-row--provider");
    const id = textInput(provider.id);
    id.placeholder = i18n.t("searchProviderId");
    id.setAttribute("aria-label", i18n.t("searchProviderId"));
    const title = textInput(provider.title);
    title.placeholder = i18n.t("searchProviderTitle");
    title.setAttribute("aria-label", i18n.t("searchProviderTitle"));
    const url = textInput(provider.urlTemplate, "url");
    url.placeholder = "https://example.com/?q={query}";
    url.setAttribute("aria-label", i18n.t("searchProviderTemplate"));
    const remove = button("×", "icon-button");
    remove.title = i18n.t("removeSearchProvider");
    remove.setAttribute("aria-label", i18n.t("removeSearchProvider"));
    for (const input of [id, title, url]) input.addEventListener("input", notify);
    remove.addEventListener("click", () => { row.remove(); notify(); });
    row.append(id, title, url, remove);
    list.append(row);
  };

  initial.forEach(appendRow);
  add.addEventListener("click", () => { appendRow({ id: "", title: "", urlTemplate: "" }); notify(); });
  root.append(list, add);

  return { root, read };
}

function configFields(
  block: BlockInstance,
  i18n: I18n,
): { fields: HTMLElement[]; read: () => BlockConfig } {
  switch (block.type) {
    case "dateTime": {
      const mode = selectInput(block.config.mode, [
        ["both", i18n.t("dateTimeBoth")],
        ["date", i18n.t("dateTimeDate")],
        ["time", i18n.t("dateTimeTime")],
      ]);
      const dateFormat = textInput(block.config.dateFormat);
      const timeFormat = textInput(block.config.timeFormat);
      const timeZone = textInput(block.config.timeZone);
      const locale = textInput(block.config.locale);
      const fontSize = numberInput(block.config.timeFontSize, { min: 12, max: 160, step: 1 });
      return {
        fields: [
          field(i18n.t("dateTimeMode"), mode),
          field(i18n.t("dateFormat"), dateFormat),
          field(i18n.t("timeFormat"), timeFormat),
          field(i18n.t("timeZone"), timeZone, { description: i18n.t("timeZoneDescription") }),
          field(i18n.t("dateTimeLocale"), locale, { description: i18n.t("dateTimeLocaleDescription") }),
          field(i18n.t("dateTimeFontSize"), fontSize),
        ],
        read: () => ({ type: block.type, mode: mode.value as typeof block.config.mode, dateFormat: dateFormat.value, timeFormat: timeFormat.value, timeZone: timeZone.value, locale: locale.value, timeFontSize: readNumber(fontSize, block.config.timeFontSize) }),
      };
    }
    case "ip": {
      const endpoint = textInput(block.config.endpoint, "url");
      return { fields: [field(i18n.t("ipEndpoint"), endpoint, { wide: true })], read: () => ({ type: block.type, endpoint: endpoint.value }) };
    }
    case "links": {
      const columns = numberInput(block.config.columns, { min: 1, max: 12 });
      const rows = numberInput(block.config.rows, { min: 1, max: 12 });
      const direction = selectInput(block.config.pageDirection, [["horizontal", i18n.t("directionHorizontal")], ["vertical", i18n.t("directionVertical")]]);
      const fontFamily = textInput(block.config.fontFamily);
      const fontSize = numberInput(block.config.fontSize, { min: 8, max: 48, step: 1 });
      const iconSize = numberInput(block.config.iconSize, { min: 12, max: 128, step: 1 });
      const links = linksEditor(i18n, block.config.items);
      return {
        fields: [field(i18n.t("linkColumns"), columns), field(i18n.t("linkRows"), rows), field(i18n.t("linkDirection"), direction), field(i18n.t("linkFontFamily"), fontFamily), field(i18n.t("linkFontSize"), fontSize), field(i18n.t("linkIconSize"), iconSize), field(i18n.t("links"), links.root, { wide: true })],
        read: () => ({ type: block.type, columns: readNumber(columns, block.config.columns), rows: readNumber(rows, block.config.rows), pageDirection: direction.value as typeof block.config.pageDirection, fontFamily: fontFamily.value, fontSize: readNumber(fontSize, block.config.fontSize), iconSize: readNumber(iconSize, block.config.iconSize), items: links.read() }),
      };
    }
    case "search": {
      const provider = selectInput(block.config.provider, block.config.providers.map((item) => [item.id, item.title]));
      const syncProviderOptions = (items: SearchProvider[]): void => {
        const selectedId = provider.value;
        const selectedIndex = provider.selectedIndex;
        provider.replaceChildren(...items.map((item) => {
          const option = element("option", "", item.title || item.id);
          option.value = item.id;
          return option;
        }));
        provider.selectedIndex = providerSelectionIndexAfterEdit(selectedId, selectedIndex, items);
      };
      const providers = providersEditor(i18n, block.config.providers, syncProviderOptions);
      const placeholder = textInput(block.config.placeholder);
      return {
        fields: [field(i18n.t("searchProvider"), provider), field(i18n.t("searchPlaceholderLabel"), placeholder), field(i18n.t("searchProviders"), providers.root, { wide: true })],
        read: () => ({ type: block.type, provider: provider.value, providers: providers.read(), placeholder: placeholder.value }),
      };
    }
    case "timer": {
      const duration = numberInput(block.config.durationSeconds, { min: 1, max: 604800, step: 1 });
      const notify = checkboxInput(block.config.notifyOnComplete);
      return { fields: [field(i18n.t("timerSeconds"), duration), field(i18n.t("notifyOnComplete"), notify)], read: () => ({ type: block.type, durationSeconds: readNumber(duration, block.config.durationSeconds), notifyOnComplete: notify.checked }) };
    }
    case "stopwatch":
      return { fields: [element("p", "settings-note", i18n.t("stopwatchSettingsNote"))], read: () => ({ type: block.type }) };
    case "pomodoro": {
      const work = numberInput(block.config.workSeconds, { min: 60, max: 86400, step: 1 });
      const rest = numberInput(block.config.breakSeconds, { min: 30, max: 43200, step: 1 });
      const notify = checkboxInput(block.config.notifyOnComplete);
      const auto = checkboxInput(block.config.autoStartNextPhase);
      return { fields: [field(i18n.t("pomodoroWorkSeconds"), work), field(i18n.t("pomodoroBreakSeconds"), rest), field(i18n.t("notifyOnComplete"), notify), field(i18n.t("pomodoroAutoStart"), auto)], read: () => ({ type: block.type, workSeconds: readNumber(work, block.config.workSeconds), breakSeconds: readNumber(rest, block.config.breakSeconds), notifyOnComplete: notify.checked, autoStartNextPhase: auto.checked }) };
    }
    case "note": {
      const placeholder = textInput(block.config.placeholder);
      const confirmDelete = checkboxInput(block.config.confirmDeleteWithContent);
      return { fields: [field(i18n.t("notePlaceholderLabel"), placeholder, { wide: true }), field(i18n.t("confirmDeleteWithContent"), confirmDelete)], read: () => ({ type: block.type, placeholder: placeholder.value, confirmDeleteWithContent: confirmDelete.checked }) };
    }
    case "localTasks": {
      const placeholder = textInput(block.config.placeholder);
      const showCompleted = checkboxInput(block.config.showCompleted);
      const confirmDelete = checkboxInput(block.config.confirmDeleteWithContent);
      return { fields: [field(i18n.t("taskPlaceholderLabel"), placeholder, { wide: true }), field(i18n.t("showCompletedTasks"), showCompleted), field(i18n.t("confirmDeleteWithContent"), confirmDelete)], read: () => ({ type: block.type, placeholder: placeholder.value, showCompleted: showCompleted.checked, confirmDeleteWithContent: confirmDelete.checked }) };
    }
    case "googleCalendar": {
      const calendarId = textInput(block.config.calendarId);
      const accountLabel = textInput(block.config.accountLabel);
      const query = textInput(block.config.query);
      const maxResults = numberInput(block.config.maxResults, { min: 1, max: 25 });
      return { fields: [field(i18n.t("calendarId"), calendarId), field(i18n.t("calendarAccountLabel"), accountLabel), field(i18n.t("calendarQuery"), query, { wide: true }), field(i18n.t("calendarMaxResults"), maxResults)], read: () => ({ type: block.type, calendarId: calendarId.value, accountLabel: accountLabel.value, query: query.value, maxResults: readNumber(maxResults, block.config.maxResults) }) };
    }
    case "weather": {
      const city = textInput(block.config.city);
      const latitude = numberInput(block.config.latitude, { min: -90, max: 90, step: "any" });
      const longitude = numberInput(block.config.longitude, { min: -180, max: 180, step: "any" });
      const displayMode = selectInput(block.config.displayMode, [["current", i18n.t("weatherModeCurrent")], ["day", i18n.t("weatherModeDay")], ["week", i18n.t("weatherModeWeek")]]);
      const forecast = textInput(block.config.forecastEndpoint, "url");
      const geocoding = textInput(block.config.geocodingEndpoint, "url");
      return { fields: [field(i18n.t("weatherCity"), city), field(i18n.t("weatherLatitude"), latitude), field(i18n.t("weatherLongitude"), longitude), field(i18n.t("weatherDisplayMode"), displayMode), field(i18n.t("weatherForecastEndpoint"), forecast, { wide: true }), field(i18n.t("weatherGeocodingEndpoint"), geocoding, { wide: true })], read: () => ({ type: block.type, provider: "open-meteo", city: city.value, latitude: readNumber(latitude, block.config.latitude), longitude: readNumber(longitude, block.config.longitude), displayMode: displayMode.value as typeof block.config.displayMode, forecastEndpoint: forecast.value, geocodingEndpoint: geocoding.value }) };
    }
    case "commands":
    case "browserPinned":
    case "stats":
      return { fields: [element("p", "settings-note", i18n.t("blockNoAdditionalSettings"))], read: () => ({ type: block.type }) };
    case "recent": {
      const maxResults = numberInput(block.config.maxResults, { min: 1, max: 50 });
      return { fields: [field(i18n.t("recentMaxResults"), maxResults)], read: () => ({ type: block.type, maxResults: readNumber(maxResults, block.config.maxResults) }) };
    }
    case "startPinned": {
      const columns = numberInput(block.config.columns, { min: 1, max: 12 });
      const rows = numberInput(block.config.rows, { min: 1, max: 12 });
      const direction = selectInput(block.config.pageDirection, [["horizontal", i18n.t("directionHorizontal")], ["vertical", i18n.t("directionVertical")]]);
      const fontFamily = textInput(block.config.fontFamily);
      const fontSize = numberInput(block.config.fontSize, { min: 8, max: 48, step: 1 });
      const iconSize = numberInput(block.config.iconSize, { min: 12, max: 128, step: 1 });
      const links = linksEditor(i18n, block.config.items);
      return { fields: [field(i18n.t("linkColumns"), columns), field(i18n.t("linkRows"), rows), field(i18n.t("linkDirection"), direction), field(i18n.t("linkFontFamily"), fontFamily), field(i18n.t("linkFontSize"), fontSize), field(i18n.t("linkIconSize"), iconSize), field(i18n.t("links"), links.root, { wide: true })], read: () => ({ type: block.type, columns: readNumber(columns, block.config.columns), rows: readNumber(rows, block.config.rows), pageDirection: direction.value as typeof block.config.pageDirection, fontFamily: fontFamily.value, fontSize: readNumber(fontSize, block.config.fontSize), iconSize: readNumber(iconSize, block.config.iconSize), items: links.read() }) };
    }
  }
}

export async function editBlockInstance(block: BlockInstance, i18n: I18n): Promise<BlockInstance | null> {
  return new Promise<BlockInstance | null>((resolve) => {
    const result: DialogResult = { block: null };
    const dialog = element("dialog", "settings-dialog");
    dialog.setAttribute("aria-labelledby", "block-settings-title");
    const form = element("form", "settings-dialog__form");
    form.method = "dialog";
    const header = element("header", "settings-dialog__header");
    const heading = element("div", "settings-dialog__heading");
    const defaultTitleKey = blockTitleKey(block.type);
    const localizedDefaultTitle = i18n.t(defaultTitleKey);
    const usesDefaultTitle = blockUsesDefaultTitle(block);
    const displayedTitle = usesDefaultTitle ? localizedDefaultTitle : block.title;
    const title = element("h2", "settings-dialog__title", i18n.t("instanceSettingsTitle", { title: displayedTitle }));
    title.id = "block-settings-title";
    heading.append(title, element("p", "settings-dialog__subtitle", i18n.t("instanceSettingsSubtitle", { type: localizedDefaultTitle, id: block.id })));
    const close = button("×", "icon-button settings-dialog__close");
    close.title = i18n.t("close");
    close.setAttribute("aria-label", i18n.t("close"));
    header.append(heading, close);

    const body = element("div", "settings-dialog__body");
    const grid = element("div", "settings-grid");
    const titleInput = textInput(displayedTitle);
    const enabled = checkboxInput(block.enabled);
    const configured = configFields(block, i18n);
    grid.append(field(i18n.t("instanceName"), titleInput, { wide: true }), field(i18n.t("blockEnabled"), enabled), ...configured.fields);
    const error = element("p", "form-error");
    error.hidden = true;
    body.append(grid, error);

    const footer = element("footer", "settings-dialog__footer");
    const cancel = button(i18n.t("cancel"), "button button--secondary");
    const save = button(i18n.t("save"), "button button--primary", "submit");
    footer.append(cancel, save);
    form.append(header, body, footer);
    dialog.append(form);
    document.body.append(dialog);

    let dirty = false;
    const markDirty = (): void => { dirty = true; };
    form.addEventListener("input", markDirty);
    form.addEventListener("change", markDirty);

    const confirmDiscard = (): boolean => !dirty || window.confirm(i18n.t("discardChangesConfirm"));
    const closeWithoutSave = (): void => {
      if (!confirmDiscard()) return;
      result.block = null;
      dialog.close("cancel");
    };
    close.addEventListener("click", closeWithoutSave);
    cancel.addEventListener("click", closeWithoutSave);
    dialog.addEventListener("cancel", (event) => {
      if (!confirmDiscard()) event.preventDefault();
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const validation: ValidationIssue[] = [];
      const config = normalizeBlockConfig(block.type, configured.read(), {}, "config", validation);
      if (validation.length > 0) {
        error.textContent = issuesText(i18n, validation);
        error.hidden = false;
        return;
      }
      const next = cloneBlock(block);
      const requestedTitle = titleInput.value.trim();
      next.title = usesDefaultTitle && requestedTitle === localizedDefaultTitle
        ? (block.title || defaultTitleKey)
        : (requestedTitle || defaultTitleKey);
      next.enabled = enabled.checked;
      next.config = config as never;
      result.block = next;
      dirty = false;
      dialog.close("save");
    });

    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(result.block);
    }, { once: true });
    dialog.showModal();
    titleInput.focus();
    titleInput.select();
  });
}
