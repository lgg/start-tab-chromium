import { backupFileName, exportBackup } from "../lib/backup.js";
import {
  getFocusStats,
  recordFocusSessionCompleted,
  recordFocusSessionInterrupted,
  recordFocusSessionStarted,
  resetFocusStats,
} from "../lib/focus-stats.js";
import {
  isGoogleIntegrationConfigured,
  listCalendarEvents,
  type GoogleCalendarEvent,
} from "../lib/google-integration.js";
import type { I18n } from "../lib/i18n.js";
import {
  clearClockAlarm,
  completeClockInstance,
  defaultClockForBlock,
  elapsedClockMs,
  getStartPageRuntimeState,
  pauseClockState,
  remainingClockMs,
  resetClockState,
  scheduleClockAlarm,
  setStartPageRuntimeState,
  startClockState,
  type ClockCompletionResult,
} from "../lib/start-page-runtime.js";
import type {
  BlockInstance,
  ClockRuntimeState,
  LocalTask,
  StartLink,
  StartPageRuntimeState,
  StartPageSettings,
} from "../lib/start-page-settings.js";

export interface BlockRenderContext {
  i18n: I18n;
  settings: StartPageSettings;
  runtime: StartPageRuntimeState;
  setRuntime: (runtime: StartPageRuntimeState) => Promise<void>;
  requestRender: () => void;
  registerCleanup: (cleanup: () => void) => void;
}

interface IpResult {
  ip: string;
  country: string;
}

interface WeatherDay {
  date: string;
  min: number;
  max: number;
  code: number;
}

interface WeatherResult {
  currentTemperature: number | null;
  currentCode: number | null;
  unit: string;
  days: WeatherDay[];
}

interface UrlItem {
  title: string;
  url: string;
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

function actionButton(text: string, action: () => void | Promise<void>, className = "button"): HTMLButtonElement {
  const button = element("button", className, text);
  button.type = "button";
  button.addEventListener("click", () => void Promise.resolve(action()).catch(() => undefined));
  return button;
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatDuration(milliseconds: number, includeHours = true): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = includeHours || hours > 0
    ? [hours, minutes, seconds]
    : [minutes, seconds];
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}

function localeFor(block: Extract<BlockInstance, { type: "dateTime" }>, i18n: I18n): string {
  return block.config.locale.trim() || i18n.locale;
}

function dateParts(date: Date, timeZone: string, locale: string): Record<string, string> {
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: timeZone || undefined,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dateFormatter.formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function formatPattern(date: Date, pattern: string, timeZone: string, locale: string): string {
  const parts = dateParts(date, timeZone, locale);
  const replacements: Record<string, string> = {
    dddd: parts.weekday ?? "",
    YYYY: parts.year ?? "",
    MMMM: parts.month ?? "",
    DD: parts.day ?? "",
    HH: parts.hour === "24" ? "00" : parts.hour ?? "",
    mm: parts.minute ?? "",
    ss: parts.second ?? "",
  };
  return Object.entries(replacements)
    .sort(([left], [right]) => right.length - left.length)
    .reduce((result, [token, replacement]) => result.split(token).join(replacement), pattern);
}

function renderDateTime(
  block: Extract<BlockInstance, { type: "dateTime" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const time = element("div", "date-time__time");
  const date = element("div", "date-time__date");
  time.style.fontSize = `${block.config.timeFontSize}px`;
  const update = (): void => {
    const now = new Date();
    const locale = localeFor(block, context.i18n);
    if (block.config.mode !== "date") time.textContent = formatPattern(now, block.config.timeFormat, block.config.timeZone, locale);
    if (block.config.mode !== "time") date.textContent = formatPattern(now, block.config.dateFormat, block.config.timeZone, locale);
  };
  if (block.config.mode !== "date") container.append(time);
  if (block.config.mode !== "time") container.append(date);
  update();
  const timer = window.setInterval(update, 1000);
  context.registerCleanup(() => window.clearInterval(timer));
}

function renderSearch(
  block: Extract<BlockInstance, { type: "search" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const form = element("form", "search");
  const input = element("input", "input search__input");
  input.type = "search";
  input.placeholder = block.config.placeholder || context.i18n.t("searchPlaceholder");
  input.autocomplete = "off";
  input.setAttribute("aria-label", context.i18n.t("searchPlaceholder"));
  const submit = element("button", "button button--primary", context.i18n.t("searchButton"));
  submit.type = "submit";
  form.append(input, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    const provider = block.config.providers.find((candidate) => candidate.id === block.config.provider)
      ?? block.config.providers[0];
    if (!provider) return;
    location.href = provider.urlTemplate.split("{query}").join(encodeURIComponent(query));
  });
  container.append(form);
}

function parseIpPayload(payload: unknown): IpResult | null {
  if (typeof payload !== "object" || payload === null) return null;
  const source = payload as Record<string, unknown>;
  const ip = [source.ip, source.query, source.address].find((value): value is string => typeof value === "string" && value.length > 0);
  const country = [source.country_name, source.country, source.countryCode, source.country_code]
    .find((value): value is string => typeof value === "string" && value.length > 0) ?? "";
  return ip ? { ip, country } : null;
}

async function fetchIp(endpoint: string): Promise<IpResult> {
  const endpoints = [...new Set([
    endpoint,
    "https://ipapi.co/json/",
    "https://ipwho.is/",
    "https://api.ipify.org?format=json",
  ].filter(Boolean))];
  let lastError: unknown = null;
  for (const candidate of endpoints) {
    try {
      const response = await fetch(candidate, { cache: "no-store" });
      if (!response.ok) throw new Error(`IP provider returned ${response.status}`);
      const parsed = parseIpPayload(await response.json());
      if (parsed) return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("IP lookup failed");
}

function renderIp(
  block: Extract<BlockInstance, { type: "ip" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const detail = element("div", "ip__detail", context.i18n.t("ipLoading"));
  container.append(detail);
  void fetchIp(block.config.endpoint).then((result) => {
    detail.textContent = context.i18n.t("ipResult", {
      ip: result.ip || context.i18n.t("ipUnknown"),
      country: result.country || context.i18n.t("ipUnknownCountry"),
    });
  }).catch(() => {
    detail.textContent = context.i18n.t("ipUnavailable");
  });
}

function pageItems<T>(items: readonly T[], page: number, perPage: number): T[] {
  return items.slice(page * perPage, (page + 1) * perPage);
}

function linkTile(item: StartLink): HTMLAnchorElement {
  const anchor = element("a", "link-tile");
  anchor.href = item.url;
  const icon = element("span", "link-tile__icon", item.icon || item.title.slice(0, 2).toUpperCase());
  icon.setAttribute("aria-hidden", "true");
  const title = element("span", "link-tile__title", item.title);
  anchor.append(icon, title);
  return anchor;
}

function renderLinkCollection(
  block: Extract<BlockInstance, { type: "links" | "startPinned" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const config = block.config;
  container.style.setProperty("--link-columns", String(config.columns));
  container.style.setProperty("--link-font-family", config.fontFamily);
  container.style.setProperty("--link-font-size", `${config.fontSize}px`);
  container.style.setProperty("--link-icon-size", `${config.iconSize}px`);
  const perPage = Math.max(1, config.columns * config.rows);
  const totalPages = Math.max(1, Math.ceil(config.items.length / perPage));
  let page = Math.min(context.runtime.linkPages[block.id] ?? 0, totalPages - 1);
  const list = element("div", `links links--${config.pageDirection}`);
  const pager = element("div", "pager");
  const previous = actionButton(context.i18n.t("previousPage"), async () => {
    page = (page - 1 + totalPages) % totalPages;
    context.runtime.linkPages[block.id] = page;
    await context.setRuntime(context.runtime);
    draw();
  }, "button button--secondary");
  const next = actionButton(context.i18n.t("nextPage"), async () => {
    page = (page + 1) % totalPages;
    context.runtime.linkPages[block.id] = page;
    await context.setRuntime(context.runtime);
    draw();
  }, "button button--secondary");
  const label = element("span", "pager__label");
  const draw = (): void => {
    list.replaceChildren(...pageItems(config.items, page, perPage).map(linkTile));
    label.textContent = context.i18n.t("pageCounter", { page: page + 1, pages: totalPages });
  };
  draw();
  container.append(list);
  if (totalPages > 1) {
    pager.append(previous, label, next);
    container.append(pager);
  }
}

function notificationMessage(block: Extract<BlockInstance, { type: "timer" | "pomodoro" }>, context: BlockRenderContext): string {
  return block.type === "pomodoro" ? context.i18n.t("pomodoroDone") : context.i18n.t("timerDone");
}

async function applyCompletion(result: ClockCompletionResult, context: BlockRenderContext): Promise<void> {
  if (!result.completed || !result.block) return;
  if (result.focusTimeMs > 0) await recordFocusSessionCompleted(result.focusTimeMs);
  if (result.notify && (result.block.type === "timer" || result.block.type === "pomodoro")) {
    await chrome.notifications.create(`start-tab-clock-${result.block.id}-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon.128.png",
      title: result.block.title,
      message: notificationMessage(result.block, context),
    });
  }
  context.runtime = await getStartPageRuntimeState(context.settings);
  context.requestRender();
}

function renderClock(
  block: Extract<BlockInstance, { type: "timer" | "stopwatch" | "pomodoro" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  let clock = context.runtime.clocks[block.id] ?? defaultClockForBlock(block);
  context.runtime.clocks[block.id] = clock;
  const phase = element("div", "clock__phase");
  const display = element("div", "clock__display");
  const actions = element("div", "clock__actions");
  const startPause = actionButton("", async () => {
    const now = Date.now();
    if (clock.running) {
      const wasWork = block.type === "pomodoro" && clock.phase === "work" && clock.focusSessionStartedAt !== null;
      const focusElapsed = wasWork ? Math.max(0, now - (clock.focusSessionStartedAt ?? now)) : 0;
      clock = pauseClockState(clock, now);
      if (wasWork && focusElapsed > 0) {
        await recordFocusSessionInterrupted(focusElapsed);
        clock.focusSessionStartedAt = null;
      }
      await clearClockAlarm(block.id);
    } else {
      const startingWork = block.type === "pomodoro" && (clock.phase ?? "work") === "work";
      clock = startClockState(clock, now);
      if (startingWork) await recordFocusSessionStarted();
      await scheduleClockAlarm(block.id, clock);
    }
    context.runtime.clocks[block.id] = clock;
    await context.setRuntime(context.runtime);
    update();
  });
  const reset = actionButton(context.i18n.t("clockReset"), async () => {
    if (block.type === "pomodoro" && clock.running && clock.phase === "work" && clock.focusSessionStartedAt !== null) {
      await recordFocusSessionInterrupted(Math.max(0, Date.now() - clock.focusSessionStartedAt));
    }
    clock = resetClockState(block);
    context.runtime.clocks[block.id] = clock;
    await clearClockAlarm(block.id);
    await context.setRuntime(context.runtime);
    update();
  }, "button button--secondary");
  actions.append(startPause, reset);
  if (block.type === "pomodoro") container.append(phase);
  container.append(display, actions);

  let completionPending = false;
  const update = (): void => {
    const now = Date.now();
    const value = block.type === "stopwatch" ? elapsedClockMs(clock, now) : remainingClockMs(clock, now);
    display.textContent = formatDuration(value, block.type === "stopwatch");
    startPause.textContent = context.i18n.t(clock.running ? "clockPause" : "clockStart");
    if (block.type === "pomodoro") phase.textContent = context.i18n.t(clock.phase === "break" ? "pomodoroBreak" : "pomodoroWork");
    if (clock.running && block.type !== "stopwatch" && value <= 0 && !completionPending) {
      completionPending = true;
      void completeClockInstance(block.id, clock.completionToken).then(async (result) => {
        await applyCompletion(result, context);
      }).finally(() => { completionPending = false; });
    }
  };
  update();
  const timer = window.setInterval(update, 250);
  context.registerCleanup(() => window.clearInterval(timer));
}

function renderNote(
  block: Extract<BlockInstance, { type: "note" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const textarea = element("textarea", "note");
  textarea.value = context.runtime.notes[block.id] ?? "";
  textarea.placeholder = block.config.placeholder || context.i18n.t("notePlaceholder");
  textarea.setAttribute("aria-label", block.title);
  let saveTimer = 0;
  textarea.addEventListener("input", () => {
    window.clearTimeout(saveTimer);
    context.runtime.notes[block.id] = textarea.value;
    saveTimer = window.setTimeout(() => void context.setRuntime(context.runtime), 180);
  });
  context.registerCleanup(() => window.clearTimeout(saveTimer));
  container.append(textarea);
}

function taskRow(
  block: Extract<BlockInstance, { type: "localTasks" }>,
  task: LocalTask,
  context: BlockRenderContext,
  redraw: () => void,
): HTMLElement {
  const row = element("div", "task");
  const checkbox = element("input", "task__check");
  checkbox.type = "checkbox";
  checkbox.checked = task.done;
  checkbox.setAttribute("aria-label", context.i18n.t("toggleTask", { title: task.title }));
  const title = element("span", task.done ? "task__title task__title--done" : "task__title", task.title);
  const remove = actionButton("×", async () => {
    context.runtime.tasks[block.id] = (context.runtime.tasks[block.id] ?? []).filter((candidate) => candidate.id !== task.id);
    await context.setRuntime(context.runtime);
    redraw();
  }, "icon-button");
  remove.title = context.i18n.t("removeTask");
  remove.setAttribute("aria-label", context.i18n.t("removeTask"));
  checkbox.addEventListener("change", () => {
    task.done = checkbox.checked;
    task.updatedAt = Date.now();
    void context.setRuntime(context.runtime).then(redraw);
  });
  row.append(checkbox, title, remove);
  return row;
}

function renderLocalTasks(
  block: Extract<BlockInstance, { type: "localTasks" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const form = element("form", "task-form");
  const input = element("input", "input");
  input.placeholder = block.config.placeholder || context.i18n.t("localTaskPlaceholder");
  input.setAttribute("aria-label", context.i18n.t("localTaskPlaceholder"));
  const add = element("button", "button button--primary", context.i18n.t("addTask"));
  add.type = "submit";
  const list = element("div", "task-list");
  const redraw = (): void => {
    const tasks = (context.runtime.tasks[block.id] ?? []).filter((task) => block.config.showCompleted || !task.done);
    list.replaceChildren(...tasks.map((task) => taskRow(block, task, context, redraw)));
    if (tasks.length === 0) list.append(element("p", "empty-state", context.i18n.t("emptyList")));
  };
  form.append(input, add);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    const now = Date.now();
    const task: LocalTask = {
      id: globalThis.crypto?.randomUUID?.() ?? `task-${now.toString(36)}-${Math.random().toString(36).slice(2)}`,
      title,
      done: false,
      createdAt: now,
      updatedAt: now,
    };
    context.runtime.tasks[block.id] = [...(context.runtime.tasks[block.id] ?? []), task];
    input.value = "";
    void context.setRuntime(context.runtime).then(redraw);
  });
  container.append(form, list);
  redraw();
}

function eventLabel(event: GoogleCalendarEvent, i18n: I18n): string {
  if (!event.start) return event.title;
  const start = new Date(event.start);
  if (!Number.isFinite(start.getTime())) return `${event.title} · ${i18n.t("calendarAllDay")}`;
  return `${event.title} · ${new Intl.DateTimeFormat(i18n.locale, { dateStyle: "short", timeStyle: "short" }).format(start)}`;
}

function renderGoogleCalendar(
  block: Extract<BlockInstance, { type: "googleCalendar" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const status = element("p", "empty-state", context.i18n.t("googleCalendarLoading"));
  container.append(status);
  if (!isGoogleIntegrationConfigured()) {
    status.textContent = context.i18n.t("googleCalendarNotConfigured");
    return;
  }
  void listCalendarEvents(block.config.calendarId, block.config.maxResults).then((events) => {
    const query = block.config.query.trim().toLocaleLowerCase();
    const filtered = query ? events.filter((event) => event.title.toLocaleLowerCase().includes(query)) : events;
    const list = element("div", "calendar-list");
    if (block.config.accountLabel) list.append(element("p", "block-meta", block.config.accountLabel));
    list.append(...filtered.map((event) => element("div", "calendar-event", eventLabel(event, context.i18n))));
    if (filtered.length === 0) list.append(element("p", "empty-state", context.i18n.t("emptyList")));
    status.replaceWith(list);
  }).catch(() => {
    status.textContent = context.i18n.t("googleCalendarUnavailable");
  });
}

async function geocodeCity(endpoint: string, city: string): Promise<{ latitude: number; longitude: number } | null> {
  if (!city.trim()) return null;
  const url = new URL(endpoint);
  url.searchParams.set("name", city.trim());
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) throw new Error(`Geocoding returned ${response.status}`);
  const payload = await response.json() as { results?: Array<{ latitude?: number; longitude?: number }> };
  const first = payload.results?.[0];
  return typeof first?.latitude === "number" && typeof first.longitude === "number"
    ? { latitude: first.latitude, longitude: first.longitude }
    : null;
}

async function fetchWeather(block: Extract<BlockInstance, { type: "weather" }>): Promise<WeatherResult> {
  const geocoded = await geocodeCity(block.config.geocodingEndpoint, block.config.city).catch(() => null);
  const latitude = geocoded?.latitude ?? block.config.latitude;
  const longitude = geocoded?.longitude ?? block.config.longitude;
  const url = new URL(block.config.forecastEndpoint);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min");
  url.searchParams.set("timezone", "auto");
  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) throw new Error(`Weather provider returned ${response.status}`);
  const payload = await response.json() as {
    current?: { temperature_2m?: number; weather_code?: number };
    current_units?: { temperature_2m?: string };
    daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[] };
  };
  const dates = payload.daily?.time ?? [];
  return {
    currentTemperature: typeof payload.current?.temperature_2m === "number" ? payload.current.temperature_2m : null,
    currentCode: typeof payload.current?.weather_code === "number" ? payload.current.weather_code : null,
    unit: payload.current_units?.temperature_2m ?? "°C",
    days: dates.flatMap((date, index) => {
      const min = payload.daily?.temperature_2m_min?.[index];
      const max = payload.daily?.temperature_2m_max?.[index];
      const code = payload.daily?.weather_code?.[index];
      return typeof min === "number" && typeof max === "number" && typeof code === "number"
        ? [{ date, min, max, code }]
        : [];
    }),
  };
}

function weatherSummary(code: number | null, i18n: I18n): string {
  if (code === null) return i18n.t("weatherUnknown");
  if (code === 0) return i18n.t("weatherClear");
  if ([1, 2, 3].includes(code)) return i18n.t("weatherCloudy");
  if ([45, 48].includes(code)) return i18n.t("weatherFog");
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67].includes(code)) return i18n.t("weatherRain");
  if ([71, 73, 75, 77, 85, 86].includes(code)) return i18n.t("weatherSnow");
  if ([80, 81, 82].includes(code)) return i18n.t("weatherShowers");
  if ([95, 96, 99].includes(code)) return i18n.t("weatherThunderstorm");
  return i18n.t("weatherUnknown");
}

function renderWeather(
  block: Extract<BlockInstance, { type: "weather" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const status = element("p", "empty-state", context.i18n.t("weatherLoading"));
  container.append(status);
  void fetchWeather(block).then((weather) => {
    const content = element("div", "weather");
    if (block.config.city) content.append(element("p", "block-meta", block.config.city));
    if (block.config.displayMode === "current") {
      if (weather.currentTemperature === null) throw new Error("Missing current weather");
      content.append(element("p", "weather__current", context.i18n.t("weatherCurrent", { temp: Math.round(weather.currentTemperature), unit: weather.unit, summary: weatherSummary(weather.currentCode, context.i18n) })));
    } else {
      const count = block.config.displayMode === "day" ? 1 : 7;
      content.append(...weather.days.slice(0, count).map((day) => element("p", "weather__day", context.i18n.t("weatherDay", {
        day: new Intl.DateTimeFormat(context.i18n.locale, { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${day.date}T12:00:00`)),
        min: Math.round(day.min),
        max: Math.round(day.max),
        unit: weather.unit,
        summary: weatherSummary(day.code, context.i18n),
      }))));
    }
    status.replaceWith(content);
  }).catch(() => {
    status.textContent = context.i18n.t("weatherUnavailable");
  });
}

async function recentHistory(maxResults: number): Promise<UrlItem[]> {
  const items = await chrome.history.search({ text: "", maxResults, startTime: Date.now() - 30 * 24 * 60 * 60 * 1000 });
  return items.flatMap((item) => item.url ? [{ title: item.title || item.url, url: item.url }] : []);
}

async function browserPinnedTabs(): Promise<UrlItem[]> {
  const tabs = await chrome.tabs.query({ pinned: true });
  return tabs.flatMap((tab) => tab.url ? [{ title: tab.title || tab.url, url: tab.url }] : []);
}

function urlList(items: readonly UrlItem[], i18n: I18n): HTMLElement {
  const list = element("div", "url-list");
  if (items.length === 0) {
    list.append(element("p", "empty-state", i18n.t("emptyList")));
    return list;
  }
  for (const item of items) {
    const anchor = element("a", "url-list__item", item.title);
    anchor.href = item.url;
    anchor.title = item.url;
    list.append(anchor);
  }
  return list;
}

function renderRecent(
  block: Extract<BlockInstance, { type: "recent" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const status = element("p", "empty-state", context.i18n.t("recentLoading"));
  container.append(status);
  void recentHistory(block.config.maxResults).then((items) => status.replaceWith(urlList(items, context.i18n))).catch(() => {
    status.textContent = context.i18n.t("recentUnavailable");
  });
}

function renderBrowserPinned(
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const status = element("p", "empty-state", context.i18n.t("browserPinnedLoading"));
  container.append(status);
  void browserPinnedTabs().then((items) => status.replaceWith(urlList(items, context.i18n))).catch(() => {
    status.textContent = context.i18n.t("browserPinnedUnavailable");
  });
}

function renderCommands(container: HTMLElement, context: BlockRenderContext): void {
  const actions = element("div", "command-list");
  actions.append(
    actionButton(context.i18n.t("openSettings"), () => chrome.runtime.openOptionsPage()),
    actionButton(context.i18n.t("exportBackup"), async () => downloadJson(backupFileName(), await exportBackup())),
    actionButton(context.i18n.t("commandResetClocks"), async () => {
      for (const block of context.settings.layout.blocks) {
        if (block.type === "timer" || block.type === "stopwatch" || block.type === "pomodoro") {
          context.runtime.clocks[block.id] = resetClockState(block);
          await clearClockAlarm(block.id);
        }
      }
      await context.setRuntime(context.runtime);
      context.requestRender();
    }),
    actionButton(context.i18n.t("commandResetStats"), async () => {
      await resetFocusStats();
      context.requestRender();
    }),
  );
  container.append(actions);
}

function renderStats(container: HTMLElement, context: BlockRenderContext): void {
  const status = element("p", "empty-state", context.i18n.t("statsPlaceholder"));
  container.append(status);
  void getFocusStats().then((stats) => {
    const list = element("div", "stats-list");
    const rows = [
      context.i18n.t("statsBlockHits", { value: stats.totals.blockHits }),
      context.i18n.t("statsAvoidedVisits", { value: stats.totals.avoidedVisits }),
      context.i18n.t("statsTimeSaved", { value: Math.round(stats.totals.estimatedMinutesSaved) }),
      context.i18n.t("statsPomodoros", { value: stats.totals.focusSessionsCompleted }),
      context.i18n.t("statsInterrupted", { value: stats.totals.focusSessionsInterrupted }),
      context.i18n.t("statsFocusTime", { value: formatDuration(stats.totals.focusTimeMs) }),
      context.i18n.t("statsUnblocks", { value: stats.totals.unblocksAfterCountdown }),
    ];
    list.append(...rows.map((row) => element("div", "stats-list__item", row)));
    status.replaceWith(list);
  }).catch(() => {
    status.textContent = context.i18n.t("somethingWentWrong");
  });
}

export function renderBlockContent(
  block: BlockInstance,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  switch (block.type) {
    case "dateTime":
      renderDateTime(block, container, context);
      break;
    case "search":
      renderSearch(block, container, context);
      break;
    case "ip":
      renderIp(block, container, context);
      break;
    case "links":
    case "startPinned":
      renderLinkCollection(block, container, context);
      break;
    case "timer":
    case "stopwatch":
    case "pomodoro":
      renderClock(block, container, context);
      break;
    case "note":
      renderNote(block, container, context);
      break;
    case "localTasks":
      renderLocalTasks(block, container, context);
      break;
    case "googleCalendar":
      renderGoogleCalendar(block, container, context);
      break;
    case "weather":
      renderWeather(block, container, context);
      break;
    case "commands":
      renderCommands(container, context);
      break;
    case "recent":
      renderRecent(block, container, context);
      break;
    case "browserPinned":
      renderBrowserPinned(container, context);
      break;
    case "stats":
      renderStats(container, context);
      break;
  }
}

export async function refreshRuntime(context: BlockRenderContext): Promise<void> {
  context.runtime = await getStartPageRuntimeState(context.settings);
}

export async function persistRuntime(runtime: StartPageRuntimeState): Promise<void> {
  await setStartPageRuntimeState(runtime);
}
