import { DEFAULT_SEARCH_PROVIDERS, defaultBlockConfig } from "./start-page-defaults.js";
import type { BlockConfig, BlockConfigFor, BlockType, ValidationIssue } from "./start-page-types.js";
import {
  booleanValue,
  finiteInteger,
  finiteNumber,
  isRecord,
  legacyConfigSource,
  normalizeSearchProviders,
  normalizeStartLinks,
  normalizeTimeZone,
  oneOf,
  safeCssToken,
  safeWebUrl,
  stringValue,
  trimmedString,
} from "./start-page-validation-primitives.js";

const DATE_TIME_MODES = ["both", "date", "time"] as const;
const LINK_DIRECTIONS = ["horizontal", "vertical"] as const;
const WEATHER_MODES = ["current", "day", "week"] as const;

export function normalizeBlockConfig<T extends BlockType>(
  type: T,
  value: unknown,
  legacyRoot?: Record<string, unknown>,
  path?: string,
  issues?: ValidationIssue[],
): BlockConfigFor<T>;
export function normalizeBlockConfig(
  type: BlockType,
  value: unknown,
  legacyRoot: Record<string, unknown> = {},
  path = "config",
  issues: ValidationIssue[] = [],
): BlockConfig {
  const source = isRecord(value) ? value : legacyConfigSource(type, legacyRoot);
  switch (type) {
    case "dateTime": {
      const fallback = defaultBlockConfig("dateTime");
      return { type, mode: oneOf(source.mode, DATE_TIME_MODES, fallback.mode), dateFormat: stringValue(source.dateFormat, fallback.dateFormat, 100), timeFormat: stringValue(source.timeFormat, fallback.timeFormat, 100), timeZone: normalizeTimeZone(source.timeZone, fallback.timeZone, `${path}.timeZone`, issues), locale: trimmedString(source.locale, fallback.locale, 50), timeFontSize: finiteNumber(source.timeFontSize ?? source.fontSize, fallback.timeFontSize, 12, 160) };
    }
    case "ip": {
      const fallback = defaultBlockConfig("ip");
      const endpoint = safeWebUrl(stringValue(source.endpoint, fallback.endpoint));
      if (!endpoint) issues.push({ path: `${path}.endpoint`, messageKey: "validationInvalidUrl" });
      return { type, endpoint: endpoint ?? fallback.endpoint };
    }
    case "links": {
      const fallback = defaultBlockConfig("links");
      return { type, columns: finiteInteger(source.columns, fallback.columns, 1, 12), rows: finiteInteger(source.rows, fallback.rows, 1, 12), pageDirection: oneOf(source.pageDirection, LINK_DIRECTIONS, fallback.pageDirection), fontFamily: safeCssToken(source.fontFamily, fallback.fontFamily, 200), fontSize: finiteNumber(source.fontSize, fallback.fontSize, 8, 48), iconSize: finiteNumber(source.iconSize, fallback.iconSize, 12, 128), items: normalizeStartLinks(source.items, fallback.items, `${path}.items`, issues) };
    }
    case "search": {
      const fallback = defaultBlockConfig("search");
      const providers = normalizeSearchProviders(source.providers, fallback.providers.length ? fallback.providers : DEFAULT_SEARCH_PROVIDERS, `${path}.providers`, issues);
      const requested = trimmedString(source.provider, fallback.provider, 100);
      return { type, provider: providers.some((provider) => provider.id === requested) ? requested : providers[0]?.id ?? fallback.provider, providers, placeholder: stringValue(source.placeholder, fallback.placeholder, 160) };
    }
    case "timer": {
      const fallback = defaultBlockConfig("timer");
      return { type, durationSeconds: finiteInteger(source.durationSeconds ?? source.timerSeconds, fallback.durationSeconds, 1, 604800), notifyOnComplete: booleanValue(source.notifyOnComplete, fallback.notifyOnComplete) };
    }
    case "stopwatch": return { type };
    case "pomodoro": {
      const fallback = defaultBlockConfig("pomodoro");
      return { type, workSeconds: finiteInteger(source.workSeconds ?? source.pomodoroWorkSeconds, fallback.workSeconds, 60, 86400), breakSeconds: finiteInteger(source.breakSeconds ?? source.pomodoroBreakSeconds, fallback.breakSeconds, 30, 43200), notifyOnComplete: booleanValue(source.notifyOnComplete, fallback.notifyOnComplete), autoStartNextPhase: booleanValue(source.autoStartNextPhase, fallback.autoStartNextPhase) };
    }
    case "note": {
      const fallback = defaultBlockConfig("note");
      return { type, placeholder: stringValue(source.placeholder, fallback.placeholder, 300), confirmDeleteWithContent: booleanValue(source.confirmDeleteWithContent, fallback.confirmDeleteWithContent) };
    }
    case "localTasks": {
      const fallback = defaultBlockConfig("localTasks");
      return { type, placeholder: stringValue(source.placeholder, fallback.placeholder, 300), showCompleted: booleanValue(source.showCompleted, fallback.showCompleted), confirmDeleteWithContent: booleanValue(source.confirmDeleteWithContent, fallback.confirmDeleteWithContent) };
    }
    case "googleCalendar": {
      const fallback = defaultBlockConfig("googleCalendar");
      return { type, calendarId: trimmedString(source.calendarId, fallback.calendarId, 300) || "primary", accountLabel: stringValue(source.accountLabel, fallback.accountLabel, 120), query: stringValue(source.query, fallback.query, 300), maxResults: finiteInteger(source.maxResults, fallback.maxResults, 1, 25) };
    }
    case "weather": {
      const fallback = defaultBlockConfig("weather");
      const forecastEndpoint = safeWebUrl(stringValue(source.forecastEndpoint, fallback.forecastEndpoint));
      const geocodingEndpoint = safeWebUrl(stringValue(source.geocodingEndpoint, fallback.geocodingEndpoint));
      if (!forecastEndpoint) issues.push({ path: `${path}.forecastEndpoint`, messageKey: "validationInvalidUrl" });
      if (!geocodingEndpoint) issues.push({ path: `${path}.geocodingEndpoint`, messageKey: "validationInvalidUrl" });
      return { type, provider: "open-meteo", city: stringValue(source.city, fallback.city, 160), latitude: finiteNumber(source.latitude, fallback.latitude, -90, 90), longitude: finiteNumber(source.longitude, fallback.longitude, -180, 180), displayMode: oneOf(source.displayMode, WEATHER_MODES, fallback.displayMode), forecastEndpoint: forecastEndpoint ?? fallback.forecastEndpoint, geocodingEndpoint: geocodingEndpoint ?? fallback.geocodingEndpoint };
    }
    case "commands": return { type };
    case "recent": {
      const fallback = defaultBlockConfig("recent");
      return { type, maxResults: finiteInteger(source.maxResults, fallback.maxResults, 1, 50) };
    }
    case "browserPinned": return { type };
    case "startPinned": {
      const fallback = defaultBlockConfig("startPinned");
      return { type, columns: finiteInteger(source.columns, fallback.columns, 1, 12), rows: finiteInteger(source.rows, fallback.rows, 1, 12), pageDirection: oneOf(source.pageDirection, LINK_DIRECTIONS, fallback.pageDirection), fontFamily: safeCssToken(source.fontFamily, fallback.fontFamily, 200), fontSize: finiteNumber(source.fontSize, fallback.fontSize, 8, 48), iconSize: finiteNumber(source.iconSize, fallback.iconSize, 12, 128), items: normalizeStartLinks(source.items, fallback.items, `${path}.items`, issues) };
    }
    case "stats": return { type };
  }
}
