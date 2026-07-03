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
import { loadI18n, type I18n } from "../lib/i18n.js";
import {
  getStartPageSettings,
  type LayoutBlock,
  type SearchProvider,
  type StartLink,
  type StartPageSettings,
} from "../lib/start-page-settings.js";

const STATE_KEY = "startPageRuntimeState";
const SWIPE_THRESHOLD = 44;

type ClockId = "timer" | "stopwatch" | "pomodoro";
type PomodoroPhase = "work" | "break";

interface ClockState {
  running: boolean;
  startedAt: number | null;
  elapsedMs: number;
  durationMs: number;
  pomodoroPhase?: PomodoroPhase;
  focusSessionStarted?: boolean;
}

interface LocalTask {
  id: string;
  title: string;
  done: boolean;
}

interface RuntimeState {
  clocks: Record<string, ClockState>;
  notes: Record<string, string>;
  linkPages: Record<string, number>;
  localTasks: LocalTask[];
}

interface WeatherLocation {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
}

interface GeocodingResponse {
  results?: Array<{
    name?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
  }>;
}

interface WeatherResponse {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
  };
  current_units?: {
    temperature_2m?: string;
  };
  daily?: {
    time?: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    weather_code?: number[];
  };
}

const gridEl = requireElement<HTMLDivElement>("grid");
const backgroundEl = requireElement<HTMLDivElement>("background");
const settingsEl = requireElement<HTMLButtonElement>("settings");

let i18n: I18n;
let settings: StartPageSettings;
let state: RuntimeState;
let saveTimer: number | undefined;

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: ${id}`);
  return element as T;
}

function secondsToMs(seconds: number): number {
  return Math.max(1, seconds) * 1000;
}

function defaultClock(id: ClockId): ClockState {
  const durationMs = id === "timer"
    ? secondsToMs(settings.timers.timerSeconds)
    : secondsToMs(settings.timers.pomodoroWorkSeconds);
  return {
    running: false,
    startedAt: null,
    elapsedMs: 0,
    durationMs,
    pomodoroPhase: id === "pomodoro" ? "work" : undefined,
    focusSessionStarted: false,
  };
}

async function loadRuntimeState(): Promise<RuntimeState> {
  const items = await chrome.storage.local.get(STATE_KEY);
  const stored = items[STATE_KEY] as Partial<RuntimeState> | undefined;
  return {
    clocks: stored?.clocks ?? {},
    notes: stored?.notes ?? {},
    linkPages: stored?.linkPages ?? {},
    localTasks: Array.isArray(stored?.localTasks) ? stored.localTasks : [],
  };
}

function saveStateNow(): void {
  window.clearTimeout(saveTimer);
  void chrome.storage.local.set({ [STATE_KEY]: state });
}

function queueSaveState(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveStateNow, 120);
}

function applyAppearance(): void {
  document.body.style.setProperty("--text-color", settings.appearance.textColor);
  document.body.style.setProperty("--base-font-size", `${settings.appearance.baseFontSize}px`);
  document.body.style.setProperty("--font-family", settings.appearance.fontFamily);
  document.body.style.setProperty("--background-color", settings.appearance.backgroundColor);
  backgroundEl.style.backgroundImage = settings.appearance.backgroundImage
    ? `url("${settings.appearance.backgroundImage}")`
    : "";
  document.body.className = `effect-${settings.appearance.backgroundEffect}`;
  if (settings.settingsButton.visibility === "hover") document.body.classList.add("settings-hover");
}

function titleFor(block: LayoutBlock): string {
  const key = `blockTitle${block.type[0]?.toUpperCase() ?? ""}${block.type.slice(1)}`;
  const translated = i18n.t(key);
  return translated === key ? block.title : translated;
}

function card(block: LayoutBlock): HTMLElement {
  const element = document.createElement("section");
  element.className = `card card--${block.type}`;
  element.style.gridColumn = `${block.column} / span ${block.width}`;
  element.style.gridRow = `${block.row} / span ${block.height}`;

  const title = document.createElement("h2");
  title.className = "card__title";
  title.textContent = titleFor(block);
  element.append(title);
  return element;
}

function render(): void {
  gridEl.innerHTML = "";
  gridEl.style.setProperty("--grid-columns", String(settings.layout.columns));

  for (const block of settings.layout.blocks.filter((item) => item.enabled)) {
    const element = card(block);
    renderBlock(block, element);
    gridEl.append(element);
  }

  updateDynamicBlocks();
  void loadIp();
}

function renderBlock(block: LayoutBlock, element: HTMLElement): void {
  switch (block.type) {
    case "dateTime":
      element.append(el("div", "date-time__time", "", { id: "dateTimeTime" }));
      element.append(el("div", "date-time__date", "", { id: "dateTimeDate" }));
      break;
    case "search":
      renderSearch(element);
      break;
    case "ip":
      element.append(el("div", "ip__detail", i18n.t("ipLoading"), { id: "ipDetail" }));
      break;
    case "links":
      renderLinks(element);
      break;
    case "timer":
    case "stopwatch":
    case "pomodoro":
      renderClock(block.type, element);
      break;
    case "note":
      renderNote(block.id, element);
      break;
    case "localTasks":
      renderLocalTasks(element);
      break;
    case "googleCalendar":
      void renderGoogleCalendar(element);
      break;
    case "weather":
      void renderWeather(element);
      break;
    case "commands":
      renderCommands(element);
      break;
    case "recent":
      void renderRecent(element);
      break;
    case "browserPinned":
      void renderBrowserPinned(element);
      break;
    case "startPinned":
      renderStartPinned(element);
      break;
    case "stats":
      void renderStats(element);
      break;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = "",
  attributes: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function renderSearch(container: HTMLElement): void {
  const form = document.createElement("form");
  form.className = "search";
  const input = el("input", "input") as HTMLInputElement;
  input.type = "search";
  input.placeholder = i18n.t("searchPlaceholder");
  input.autocomplete = "off";
  const button = el("button", "button", i18n.t("searchButton")) as HTMLButtonElement;
  button.type = "submit";
  form.append(input, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    const provider = activeSearchProvider();
    location.href = provider.urlTemplate.replace("{query}", encodeURIComponent(query));
  });
  container.append(form);
}

function activeSearchProvider(): SearchProvider {
  return settings.search.providers.find((provider) => provider.id === settings.search.provider)
    ?? settings.search.providers[0]
    ?? { id: "google", title: "Google", urlTemplate: "https://www.google.com/search?q={query}" };
}

async function loadIp(): Promise<void> {
  const target = document.getElementById("ipDetail");
  if (!target) return;
  try {
    const response = await fetch(settings.ip.endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error(`IP endpoint failed: ${response.status}`);
    const payload = await response.json() as { ip?: string; country_name?: string; country?: string };
    const ip = payload.ip ?? i18n.t("ipUnknown");
    const country = payload.country_name ?? payload.country ?? i18n.t("ipUnknownCountry");
    target.textContent = i18n.t("ipResult", { ip, country });
  } catch {
    target.textContent = i18n.t("ipUnavailable");
  }
}

function renderLinks(container: HTMLElement): void {
  container.style.setProperty("--link-columns", String(settings.links.columns));
  container.style.setProperty("--link-font-family", settings.links.fontFamily);
  container.style.setProperty("--link-font-size", `${settings.links.fontSize}px`);
  container.style.setProperty("--link-icon-size", `${settings.links.iconSize}px`);
  const list = document.createElement("div");
  list.className = `links links--${settings.links.pageDirection}`;
  const perPage = Math.max(1, settings.links.columns * settings.links.rows);
  const totalPages = Math.max(1, Math.ceil(settings.links.items.length / perPage));
  const page = Math.min(state.linkPages.links ?? 0, totalPages - 1);
  state.linkPages.links = page;
  appendLinkTiles(list, settings.links.items.slice(page * perPage, (page + 1) * perPage));
  if (totalPages > 1) attachLinkSwipe(list, totalPages);
  container.append(list);

  if (totalPages > 1) {
    const pager = el("div", "pager");
    const previous = el("button", "button", i18n.t("previousPage")) as HTMLButtonElement;
    const next = el("button", "button", i18n.t("nextPage")) as HTMLButtonElement;
    const label = el("span", "pager__label", i18n.t("pageCounter", { page: page + 1, pages: totalPages }));
    previous.type = "button";
    next.type = "button";
    previous.addEventListener("click", () => changeLinkPage(totalPages, -1));
    next.addEventListener("click", () => changeLinkPage(totalPages, 1));
    pager.append(previous, label, next);
    container.append(pager);
  }
}

function appendLinkTiles(container: HTMLElement, links: StartLink[]): void {
  for (const link of links) {
    const anchor = document.createElement("a");
    anchor.className = "link-tile";
    anchor.href = link.url;
    anchor.innerHTML = `<span class="link-tile__icon"></span><span class="link-tile__title"></span>`;
    const icon = anchor.querySelector(".link-tile__icon");
    const title = anchor.querySelector(".link-tile__title");
    if (icon) icon.textContent = link.icon;
    if (title) title.textContent = link.title;
    container.append(anchor);
  }
}

function attachLinkSwipe(element: HTMLElement, totalPages: number): void {
  let startX = 0;
  let startY = 0;
  element.addEventListener("pointerdown", (event) => {
    startX = event.clientX;
    startY = event.clientY;
  });
  element.addEventListener("pointerup", (event) => {
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    const primaryDelta = settings.links.pageDirection === "vertical" ? deltaY : deltaX;
    if (Math.abs(primaryDelta) < SWIPE_THRESHOLD) return;
    changeLinkPage(totalPages, primaryDelta < 0 ? 1 : -1);
  });
}

function changeLinkPage(totalPages: number, delta: number): void {
  const current = state.linkPages.links ?? 0;
  state.linkPages.links = (current + delta + totalPages) % totalPages;
  queueSaveState();
  render();
}

function renderClock(id: ClockId, container: HTMLElement): void {
  ensureClock(id);
  const value = el("div", "clock-value", "", { id: `${id}Value` });
  const actions = el("div", "clock-actions");
  const start = el("button", "button", i18n.t("clockStart")) as HTMLButtonElement;
  const pause = el("button", "button", i18n.t("clockPause")) as HTMLButtonElement;
  const reset = el("button", "button", i18n.t("clockReset")) as HTMLButtonElement;
  start.type = "button";
  pause.type = "button";
  reset.type = "button";
  start.addEventListener("click", () => startClock(id));
  pause.addEventListener("click", () => pauseClock(id));
  reset.addEventListener("click", () => resetClock(id));
  actions.append(start, pause, reset);
  container.append(value, actions);
}

function ensureClock(id: ClockId): ClockState {
  const clock = state.clocks[id];
  if (clock) return clock;
  const created = defaultClock(id);
  state.clocks[id] = created;
  return created;
}

function clockElapsed(clock: ClockState): number {
  return clock.running && clock.startedAt ? clock.elapsedMs + Date.now() - clock.startedAt : clock.elapsedMs;
}

function startClock(id: ClockId): void {
  const clock = ensureClock(id);
  const elapsedBeforeStart = clockElapsed(clock);
  if (id !== "stopwatch" && elapsedBeforeStart >= clock.durationMs) clock.elapsedMs = 0;
  if (id === "pomodoro" && clock.pomodoroPhase !== "break" && !clock.focusSessionStarted && elapsedBeforeStart === 0) {
    clock.focusSessionStarted = true;
    void recordFocusSessionStarted();
  }
  clock.running = true;
  clock.startedAt = Date.now();
  saveStateNow();
  updateDynamicBlocks();
}

function pauseClock(id: ClockId): void {
  const clock = ensureClock(id);
  clock.elapsedMs = clockElapsed(clock);
  clock.running = false;
  clock.startedAt = null;
  saveStateNow();
  updateDynamicBlocks();
}

function resetClock(id: ClockId): void {
  const clock = ensureClock(id);
  const elapsedMs = clockElapsed(clock);
  if (id === "pomodoro" && clock.focusSessionStarted && clock.pomodoroPhase !== "break" && elapsedMs > 0 && elapsedMs < clock.durationMs) {
    void recordFocusSessionInterrupted(elapsedMs);
  }
  const fresh = defaultClock(id);
  if (id === "pomodoro") fresh.pomodoroPhase = clock.pomodoroPhase ?? "work";
  state.clocks[id] = fresh;
  saveStateNow();
  updateDynamicBlocks();
}

function resetAllClocks(): void {
  for (const id of ["timer", "stopwatch", "pomodoro"] as const) {
    state.clocks[id] = defaultClock(id);
  }
  saveStateNow();
  updateDynamicBlocks();
}

function updateDynamicBlocks(): void {
  updateDateTime();
  updateClocks();
}

function updateDateTime(): void {
  const now = new Date();
  const timeEl = document.getElementById("dateTimeTime");
  const dateEl = document.getElementById("dateTimeDate");
  if (timeEl) {
    timeEl.textContent = settings.dateTime.mode === "date" ? "" : formatTime(now, settings.dateTime.timeFormat);
  }
  if (dateEl) {
    dateEl.textContent = settings.dateTime.mode === "time" ? "" : formatDate(now, settings.dateTime.dateFormat);
  }
}

function updateClocks(): void {
  for (const id of ["timer", "stopwatch", "pomodoro"] as const) {
    const target = document.getElementById(`${id}Value`);
    if (!target) continue;
    const clock = ensureClock(id);
    const elapsedMs = clockElapsed(clock);
    if (id === "stopwatch") {
      target.textContent = formatDuration(elapsedMs);
      continue;
    }
    const remainingMs = Math.max(0, clock.durationMs - elapsedMs);
    target.textContent = id === "pomodoro"
      ? `${i18n.t(clock.pomodoroPhase === "break" ? "pomodoroBreak" : "pomodoroWork")} ${formatDuration(remainingMs)}`
      : formatDuration(remainingMs);
    if (clock.running && remainingMs <= 0) finishClock(id, clock);
  }
}

function finishClock(id: ClockId, clock: ClockState): void {
  const completedFocus = id === "pomodoro" && clock.focusSessionStarted && clock.pomodoroPhase !== "break";
  clock.running = false;
  clock.startedAt = null;
  clock.elapsedMs = clock.durationMs;
  if (completedFocus) void recordFocusSessionCompleted(clock.durationMs);
  if (id === "pomodoro") {
    const nextPhase: PomodoroPhase = clock.pomodoroPhase === "break" ? "work" : "break";
    clock.pomodoroPhase = nextPhase;
    clock.focusSessionStarted = false;
    clock.durationMs = secondsToMs(nextPhase === "work"
      ? settings.timers.pomodoroWorkSeconds
      : settings.timers.pomodoroBreakSeconds);
    clock.elapsedMs = 0;
  }
  saveStateNow();
  if (settings.timers.notifyOnComplete) void notify(i18n.t(`${id}Done`));
  void refreshStats();
}

async function notify(message: string): Promise<void> {
  if (!chrome.notifications) return;
  await chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon.128.png",
    title: i18n.t("appName"),
    message,
  });
}

function renderNote(id: string, container: HTMLElement): void {
  const textarea = el("textarea", "textarea") as HTMLTextAreaElement;
  textarea.placeholder = i18n.t("notePlaceholder");
  textarea.value = state.notes[id] ?? "";
  textarea.addEventListener("input", () => {
    state.notes[id] = textarea.value;
    queueSaveState();
  });
  container.append(textarea);
}

function renderLocalTasks(container: HTMLElement): void {
  const form = document.createElement("form");
  form.className = "inline-form";
  const input = el("input", "input") as HTMLInputElement;
  input.placeholder = i18n.t("localTaskPlaceholder");
  const add = el("button", "button", i18n.t("addTask")) as HTMLButtonElement;
  add.type = "submit";
  form.append(input, add);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    state.localTasks.unshift({ id: taskId(), title, done: false });
    queueSaveState();
    render();
  });

  const list = el("div", "task-list");
  for (const task of state.localTasks.slice(0, 8)) {
    const label = document.createElement("label");
    label.className = "task-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.addEventListener("change", () => {
      task.done = checkbox.checked;
      queueSaveState();
    });
    const title = el("span", "task-item__title", task.title);
    const remove = el("button", "button button--tiny", "×") as HTMLButtonElement;
    remove.type = "button";
    remove.title = i18n.t("removeTask");
    remove.addEventListener("click", () => {
      state.localTasks = state.localTasks.filter((item) => item.id !== task.id);
      queueSaveState();
      render();
    });
    label.append(checkbox, title, remove);
    list.append(label);
  }

  container.append(form, list);
}

function taskId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function renderGoogleCalendar(container: HTMLElement): Promise<void> {
  const list = el("div", "compact-list", i18n.t("googleCalendarLoading"));
  container.append(list);

  if (!isGoogleIntegrationConfigured()) {
    list.textContent = i18n.t("googleCalendarNotConfigured");
    appendSettingsButton(container);
    return;
  }

  try {
    const events = await listCalendarEvents(settings.googleCalendar.calendarId, settings.googleCalendar.maxResults);
    renderCalendarEvents(list, events);
  } catch {
    list.textContent = i18n.t("googleCalendarUnavailable");
    appendSettingsButton(container);
  }
}

function renderCalendarEvents(container: HTMLElement, events: GoogleCalendarEvent[]): void {
  container.textContent = "";
  if (events.length === 0) {
    container.textContent = i18n.t("emptyList");
    return;
  }
  for (const event of events) {
    const item = el("div", "compact-list__item", `${formatEventTime(event.start)} · ${event.title}`);
    container.append(item);
  }
}

function appendSettingsButton(container: HTMLElement): void {
  const button = el("button", "button", i18n.t("openSettings")) as HTMLButtonElement;
  button.type = "button";
  button.addEventListener("click", () => void chrome.runtime.openOptionsPage());
  container.append(button);
}

async function renderWeather(container: HTMLElement): Promise<void> {
  const target = el("div", "compact-list", i18n.t("weatherLoading"));
  container.append(target);
  try {
    const location = await resolveWeatherLocation();
    const forecast = await fetchWeather(location);
    renderWeatherForecast(target, location, forecast);
  } catch {
    target.textContent = i18n.t("weatherUnavailable");
  }
}

async function resolveWeatherLocation(): Promise<WeatherLocation> {
  const fallback = {
    name: settings.weather.city,
    country: "",
    latitude: settings.weather.latitude,
    longitude: settings.weather.longitude,
  };
  const city = settings.weather.city.trim();
  if (!city) return fallback;

  try {
    const url = new URL(settings.weather.geocodingEndpoint);
    url.searchParams.set("name", city);
    url.searchParams.set("count", "1");
    url.searchParams.set("language", i18n.locale);
    url.searchParams.set("format", "json");
    const response = await fetch(url.toString(), { cache: "force-cache" });
    if (!response.ok) return fallback;
    const payload = await response.json() as GeocodingResponse;
    const result = payload.results?.[0];
    if (typeof result?.latitude !== "number" || typeof result.longitude !== "number") return fallback;
    return {
      name: result.name ?? city,
      country: result.country ?? "",
      latitude: result.latitude,
      longitude: result.longitude,
    };
  } catch {
    return fallback;
  }
}

async function fetchWeather(location: WeatherLocation): Promise<WeatherResponse> {
  const url = new URL(settings.weather.forecastEndpoint);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,weather_code");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "7");
  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) throw new Error(`Weather request failed: ${response.status}`);
  return (await response.json()) as WeatherResponse;
}

function renderWeatherForecast(container: HTMLElement, location: WeatherLocation, forecast: WeatherResponse): void {
  container.textContent = "";
  const title = location.country ? `${location.name}, ${location.country}` : location.name;
  container.append(el("div", "compact-list__item", title));

  const unit = forecast.current_units?.temperature_2m ?? "°C";
  const currentTemp = forecast.current?.temperature_2m;
  const currentCode = forecast.current?.weather_code;
  if (typeof currentTemp === "number") {
    container.append(el("div", "compact-list__item", i18n.t("weatherCurrent", {
      temp: Math.round(currentTemp),
      unit,
      summary: weatherSummary(currentCode),
    })));
  }

  if (settings.weather.displayMode === "current") return;

  const dayCount = settings.weather.displayMode === "day" ? 1 : 7;
  const daily = forecast.daily;
  const days = daily?.time ?? [];
  const max = daily?.temperature_2m_max ?? [];
  const min = daily?.temperature_2m_min ?? [];
  const codes = daily?.weather_code ?? [];

  for (let index = 0; index < Math.min(dayCount, days.length); index += 1) {
    const day = days[index];
    if (!day) continue;
    const maxTemp = max[index];
    const minTemp = min[index];
    const code = codes[index];
    if (typeof maxTemp !== "number" || typeof minTemp !== "number") continue;
    container.append(el("div", "compact-list__item", i18n.t("weatherDay", {
      day: formatShortDate(day),
      max: Math.round(maxTemp),
      min: Math.round(minTemp),
      unit,
      summary: weatherSummary(code),
    })));
  }
}

function weatherSummary(code: number | undefined): string {
  if (code === 0) return i18n.t("weatherClear");
  if (code === 1 || code === 2 || code === 3) return i18n.t("weatherCloudy");
  if (code === 45 || code === 48) return i18n.t("weatherFog");
  if (code !== undefined && code >= 51 && code <= 67) return i18n.t("weatherRain");
  if (code !== undefined && code >= 71 && code <= 77) return i18n.t("weatherSnow");
  if (code !== undefined && code >= 80 && code <= 82) return i18n.t("weatherShowers");
  if (code !== undefined && code >= 95) return i18n.t("weatherThunderstorm");
  return i18n.t("weatherUnknown");
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(i18n.locale, { weekday: "short", day: "numeric" }).format(date);
}

function formatEventTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || i18n.t("calendarAllDay");
  return new Intl.DateTimeFormat(i18n.locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function renderRecent(container: HTMLElement): Promise<void> {
  const list = el("div", "compact-list", i18n.t("recentLoading"));
  container.append(list);
  try {
    const results = await chrome.history.search({ text: "", maxResults: 6, startTime: Date.now() - 1000 * 60 * 60 * 24 * 14 });
    renderUrlItems(list, results.map((item) => ({ title: item.title || item.url || "", url: item.url || "" })));
  } catch {
    list.textContent = i18n.t("recentUnavailable");
  }
}

async function renderBrowserPinned(container: HTMLElement): Promise<void> {
  const list = el("div", "compact-list", i18n.t("browserPinnedLoading"));
  container.append(list);
  try {
    const tabs = await chrome.tabs.query({ pinned: true });
    renderUrlItems(list, tabs.map((tab) => ({ title: tab.title || tab.url || "", url: tab.url || "" })));
  } catch {
    list.textContent = i18n.t("browserPinnedUnavailable");
  }
}

function renderStartPinned(container: HTMLElement): void {
  const list = el("div", "compact-list");
  renderUrlItems(list, settings.startPinned.items);
  container.append(list);
}

function renderUrlItems(container: HTMLElement, items: Array<{ title: string; url: string }>): void {
  container.textContent = "";
  const valid = items.filter((item) => item.url.startsWith("http://") || item.url.startsWith("https://"));
  if (valid.length === 0) {
    container.textContent = i18n.t("emptyList");
    return;
  }
  for (const item of valid) {
    const anchor = document.createElement("a");
    anchor.className = "compact-list__item";
    anchor.href = item.url;
    anchor.textContent = item.title || item.url;
    container.append(anchor);
  }
}

function commandButton(label: string, handler: () => void | Promise<void>): HTMLButtonElement {
  const button = el("button", "button", label) as HTMLButtonElement;
  button.type = "button";
  button.addEventListener("click", () => void handler());
  return button;
}

async function downloadBackup(): Promise<void> {
  const bundle = await exportBackup();
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = backupFileName();
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function handleResetStats(): Promise<void> {
  await resetFocusStats();
  await refreshStats();
}

function renderCommands(container: HTMLElement): void {
  const actions = el("div", "clock-actions");
  actions.append(
    commandButton(i18n.t("openSettings"), () => chrome.runtime.openOptionsPage()),
    commandButton(i18n.t("exportBackup"), downloadBackup),
    commandButton(i18n.t("commandResetClocks"), resetAllClocks),
    commandButton(i18n.t("commandResetStats"), handleResetStats),
  );
  container.append(el("p", "placeholder", i18n.t("commandsPlaceholder")), actions);
}

async function renderStats(container: HTMLElement): Promise<void> {
  const stats = el("div", "stats", "", { id: "statsContent" });
  container.append(stats);
  await refreshStats();
}

async function refreshStats(): Promise<void> {
  const target = document.getElementById("statsContent");
  if (!target) return;
  const { totals } = await getFocusStats();
  target.textContent = [
    i18n.t("statsBlockHits", { value: totals.blockHits }),
    i18n.t("statsAvoidedVisits", { value: totals.avoidedVisits }),
    i18n.t("statsTimeSaved", { value: totals.estimatedMinutesSaved }),
    i18n.t("statsPomodoros", { value: totals.focusSessionsCompleted }),
    i18n.t("statsInterrupted", { value: totals.focusSessionsInterrupted }),
    i18n.t("statsFocusTime", { value: formatDuration(totals.focusTimeMs) }),
    i18n.t("statsUnblocks", { value: totals.unblocksAfterCountdown }),
  ].join("\n");
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTime(date: Date, format: string): string {
  const hours = date.getHours();
  return replaceTokens(format, {
    HH: String(hours).padStart(2, "0"),
    H: String(hours),
    mm: String(date.getMinutes()).padStart(2, "0"),
    ss: String(date.getSeconds()).padStart(2, "0"),
  });
}

function formatDate(date: Date, format: string): string {
  const monthLong = new Intl.DateTimeFormat(i18n.locale, { month: "long" }).format(date);
  const monthShort = new Intl.DateTimeFormat(i18n.locale, { month: "short" }).format(date);
  const weekdayLong = new Intl.DateTimeFormat(i18n.locale, { weekday: "long" }).format(date);
  const weekdayShort = new Intl.DateTimeFormat(i18n.locale, { weekday: "short" }).format(date);
  return replaceTokens(format, {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MMMM: monthLong,
    MMM: monthShort,
    MM: String(date.getMonth() + 1).padStart(2, "0"),
    DD: String(date.getDate()).padStart(2, "0"),
    D: String(date.getDate()),
    dddd: weekdayLong,
    ddd: weekdayShort,
  });
}

function replaceTokens(format: string, tokens: Record<string, string>): string {
  return Object.keys(tokens)
    .sort((left, right) => right.length - left.length)
    .reduce((result, token) => result.split(token).join(tokens[token] ?? ""), format);
}

settingsEl.title = "";
settingsEl.addEventListener("click", () => void chrome.runtime.openOptionsPage());

void (async () => {
  [i18n, settings, state] = await Promise.all([
    loadI18n(),
    getStartPageSettings(),
    loadRuntimeState(),
  ]);
  document.title = i18n.t("appName");
  settingsEl.title = i18n.t("openSettings");
  applyAppearance();
  render();
  window.addEventListener("pagehide", saveStateNow);
  window.setInterval(updateDynamicBlocks, 1000);
})();
