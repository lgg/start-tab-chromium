import { backupFileName, exportBackup } from "../lib/backup.js";
import { getFocusStats } from "../lib/focus-stats.js";
import { safeWebUrl } from "../lib/start-page-validation-primitives.js";
import { isGoogleIntegrationConfigured, listCalendarEvents, type GoogleCalendarEvent } from "../lib/google-integration.js";
import type { I18n } from "../lib/i18n.js";
import { sendMessage } from "../lib/messages.js";
import { getStartPageRuntimeState } from "../lib/start-page-runtime.js";
import type { BlockInstance } from "../lib/start-page-settings.js";
import { actionButton, downloadJson, element, formatDuration } from "./block-renderer-common.js";
import type { BlockRenderContext, UrlItem } from "./block-renderer-types.js";

interface WeatherDay {
  date: string;
  min: number;
  max: number;
  code: number;
}

interface CacheEntry {
  expiresAt: number;
  promise: Promise<unknown>;
}

const requestCache = new Map<string, CacheEntry>();

function cachedRequest<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const existing = requestCache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.promise as Promise<T>;
  const promise = loader();
  requestCache.set(key, { expiresAt: Date.now() + ttlMs, promise });
  void promise.catch(() => {
    if (requestCache.get(key)?.promise === promise) requestCache.delete(key);
  });
  return promise;
}

function attached(node: Node): boolean {
  return node.isConnected;
}

interface WeatherResult {
  currentTemperature: number | null;
  currentCode: number | null;
  unit: string;
  days: WeatherDay[];
}

function calendarDate(value: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12)
    : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function calendarEventLabel(event: GoogleCalendarEvent, i18n: I18n): string {
  if (!event.start) return event.title;
  const start = calendarDate(event.start);
  if (event.allDay) {
    if (!start) return `${event.title} · ${i18n.t("calendarAllDay")}`;
    const date = new Intl.DateTimeFormat(i18n.locale, { dateStyle: "short" }).format(start);
    return `${event.title} · ${date} · ${i18n.t("calendarAllDay")}`;
  }
  if (!start) return `${event.title} · ${i18n.t("calendarAllDay")}`;
  return `${event.title} · ${new Intl.DateTimeFormat(i18n.locale, { dateStyle: "short", timeStyle: "short" }).format(start)}`;
}

export function renderGoogleCalendar(
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
  const query = block.config.query.trim();
  const cacheKey = `calendar:${JSON.stringify([block.config.calendarId, block.config.maxResults, query])}`;
  void cachedRequest(cacheKey, 60_000, () => listCalendarEvents(block.config.calendarId, block.config.maxResults, query)).then((events) => {
    if (!attached(status)) return;
    const list = element("div", "calendar-list");
    if (block.config.accountLabel) list.append(element("p", "block-meta", block.config.accountLabel));
    list.append(...events.map((event) => element("div", "calendar-event", calendarEventLabel(event, context.i18n))));
    if (events.length === 0) list.append(element("p", "empty-state", context.i18n.t("emptyList")));
    status.replaceWith(list);
  }).catch(() => {
    if (attached(status)) status.textContent = context.i18n.t("googleCalendarUnavailable");
  });
}

export function validatedWeatherCoordinates(
  latitude: unknown,
  longitude: unknown,
): { latitude: number; longitude: number } | null {
  return typeof latitude === "number"
    && Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
    && typeof longitude === "number"
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180
    ? { latitude, longitude }
    : null;
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
  return validatedWeatherCoordinates(first?.latitude, first?.longitude);
}

async function weatherCoordinates(block: Extract<BlockInstance, { type: "weather" }>): Promise<{ latitude: number; longitude: number }> {
  if (!block.config.city.trim()) return { latitude: block.config.latitude, longitude: block.config.longitude };
  const geocoded = await geocodeCity(block.config.geocodingEndpoint, block.config.city);
  if (!geocoded) throw new Error("The configured weather city could not be geocoded");
  return geocoded;
}

async function fetchWeather(block: Extract<BlockInstance, { type: "weather" }>): Promise<WeatherResult> {
  const { latitude, longitude } = await weatherCoordinates(block);
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

export function renderWeather(
  block: Extract<BlockInstance, { type: "weather" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const status = element("p", "empty-state", context.i18n.t("weatherLoading"));
  container.append(status);
  const cacheKey = `weather:${JSON.stringify(block.config)}`;
  void cachedRequest(cacheKey, 10 * 60_000, () => fetchWeather(block)).then((weather) => {
    if (!attached(status)) return;
    const content = element("div", "weather");
    const city = block.config.city.trim();
    if (city) content.append(element("p", "block-meta", city));
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
    if (attached(status)) status.textContent = context.i18n.t("weatherUnavailable");
  });
}

export function visibleWebUrlItems(
  items: readonly { title?: string; url?: string }[],
  maxResults = Number.MAX_SAFE_INTEGER,
): UrlItem[] {
  const result: UrlItem[] = [];
  const limit = Number.isFinite(maxResults) ? Math.max(0, Math.floor(maxResults)) : 0;
  if (limit === 0) return result;
  for (const item of items) {
    const url = item.url ? safeWebUrl(item.url) : null;
    if (!url) continue;
    result.push({ title: item.title?.trim() || url, url });
    if (result.length >= limit) break;
  }
  return result;
}

export function recentHistorySearchLimit(maxResults: number): number {
  const requested = Number.isFinite(maxResults) ? Math.max(0, Math.ceil(maxResults)) : 0;
  return requested === 0 ? 0 : Math.min(500, Math.max(100, requested * 10));
}

async function recentHistory(maxResults: number): Promise<UrlItem[]> {
  const items = await chrome.history.search({
    text: "",
    maxResults: recentHistorySearchLimit(maxResults),
    startTime: Date.now() - 30 * 24 * 60 * 60 * 1000,
  });
  return visibleWebUrlItems(items, maxResults);
}

async function browserPinnedTabs(): Promise<UrlItem[]> {
  const tabs = await chrome.tabs.query({ pinned: true });
  return visibleWebUrlItems(tabs);
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

export function renderRecent(
  block: Extract<BlockInstance, { type: "recent" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const status = element("p", "empty-state", context.i18n.t("recentLoading"));
  container.append(status);
  void cachedRequest(`recent:${block.config.maxResults}`, 30_000, () => recentHistory(block.config.maxResults)).then((items) => {
    if (attached(status)) status.replaceWith(urlList(items, context.i18n));
  }).catch(() => {
    if (attached(status)) status.textContent = context.i18n.t("recentUnavailable");
  });
}

export function renderBrowserPinned(container: HTMLElement, context: BlockRenderContext): void {
  const status = element("p", "empty-state", context.i18n.t("browserPinnedLoading"));
  container.append(status);
  void cachedRequest("browser-pinned", 15_000, browserPinnedTabs).then((items) => {
    if (attached(status)) status.replaceWith(urlList(items, context.i18n));
  }).catch(() => {
    if (attached(status)) status.textContent = context.i18n.t("browserPinnedUnavailable");
  });
}

export function renderCommands(container: HTMLElement, context: BlockRenderContext): void {
  const actions = element("div", "command-list");
  actions.append(
    actionButton(context.i18n.t("openSettings"), () => chrome.runtime.openOptionsPage(), "button", context.reportError),
    actionButton(context.i18n.t("exportBackup"), async () => downloadJson(backupFileName(), await exportBackup()), "button", context.reportError),
    actionButton(context.i18n.t("commandResetClocks"), async () => {
      await sendMessage({ type: "reset-clocks" });
      context.runtime = await getStartPageRuntimeState(context.settings);
      context.requestRender();
    }, "button", context.reportError),
    actionButton(context.i18n.t("commandResetStats"), async () => {
      await sendMessage({ type: "reset-stats" });
      context.requestRender();
    }, "button", context.reportError),
  );
  container.append(actions);
}

export function renderStats(container: HTMLElement, context: BlockRenderContext): void {
  const status = element("p", "empty-state", context.i18n.t("statsPlaceholder"));
  container.append(status);
  void getFocusStats().then((stats) => {
    if (!attached(status)) return;
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
    if (attached(status)) status.textContent = context.i18n.t("somethingWentWrong");
  });
}
