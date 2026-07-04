export type BackgroundEffect = "none" | "gradient" | "aurora" | "mesh" | "spotlight" | "noise";
export type SettingsButtonVisibility = "always" | "hover";
export type SearchProviderId = string;
export type DateTimeMode = "both" | "date" | "time";
export type LinkPageDirection = "horizontal" | "vertical";
export type WeatherDisplayMode = "current" | "day" | "week";
export type WeatherProviderId = "open-meteo";
export type LayoutPresetId = "work" | "minimal" | "focus" | "dashboard" | "development" | "rest";
export type LayoutMode = "grid" | "free";
export type LayoutZone = "contained" | "full";
export type BlockType =
  | "dateTime"
  | "ip"
  | "links"
  | "search"
  | "timer"
  | "stopwatch"
  | "pomodoro"
  | "note"
  | "localTasks"
  | "googleCalendar"
  | "weather"
  | "commands"
  | "recent"
  | "browserPinned"
  | "startPinned"
  | "stats";

export interface FreeBlockRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutBlock {
  id: string;
  type: BlockType;
  title: string;
  enabled: boolean;
  column: number;
  row: number;
  width: number;
  height: number;
  free?: FreeBlockRect;
  config?: Record<string, unknown>;
}

export interface LayoutPreset {
  id: LayoutPresetId;
  title: string;
  columns: number;
  blocks: LayoutBlock[];
}

export interface StartLink {
  icon: string;
  title: string;
  url: string;
}

export interface SearchProvider {
  id: SearchProviderId;
  title: string;
  urlTemplate: string;
}

export interface StartPageSettings {
  startTab: {
    enabled: boolean;
  };
  appearance: {
    fontFamily: string;
    baseFontSize: number;
    textColor: string;
    backgroundColor: string;
    backgroundImage: string;
    backgroundEffect: BackgroundEffect;
  };
  settingsButton: {
    visibility: SettingsButtonVisibility;
    hoverArea: "top" | "top-right" | "right";
  };
  dateTime: {
    mode: DateTimeMode;
    dateFormat: string;
    timeFormat: string;
  };
  ip: {
    endpoint: string;
  };
  links: {
    columns: number;
    rows: number;
    pageDirection: LinkPageDirection;
    fontFamily: string;
    fontSize: number;
    iconSize: number;
    items: StartLink[];
  };
  startPinned: {
    items: StartLink[];
  };
  search: {
    provider: SearchProviderId;
    providers: SearchProvider[];
  };
  googleCalendar: {
    calendarId: string;
    maxResults: number;
  };
  weather: {
    provider: WeatherProviderId;
    city: string;
    latitude: number;
    longitude: number;
    displayMode: WeatherDisplayMode;
    forecastEndpoint: string;
    geocodingEndpoint: string;
  };
  timers: {
    timerSeconds: number;
    pomodoroWorkSeconds: number;
    pomodoroBreakSeconds: number;
    notifyOnComplete: boolean;
  };
  focusStats: {
    defaultMinutesPerAvoidedVisit: number;
    avoidedVisitDedupeSeconds: number;
    domainMinutes: Record<string, number>;
  };
  layout: {
    columns: number;
    profile: string;
    mode: LayoutMode;
    zone: LayoutZone;
    showBlockTitles: boolean;
    blocks: LayoutBlock[];
  };
}

const SETTINGS_KEY = "startPageSettings";
const BACKGROUND_EFFECTS: readonly BackgroundEffect[] = ["none", "gradient", "aurora", "mesh", "spotlight", "noise"];
const SETTINGS_BUTTON_VISIBILITIES: readonly SettingsButtonVisibility[] = ["always", "hover"];
const SETTINGS_BUTTON_HOVER_AREAS = ["top", "top-right", "right"] as const;
const DATE_TIME_MODES: readonly DateTimeMode[] = ["both", "date", "time"];
const LINK_PAGE_DIRECTIONS: readonly LinkPageDirection[] = ["horizontal", "vertical"];
const WEATHER_DISPLAY_MODES: readonly WeatherDisplayMode[] = ["current", "day", "week"];
const WEATHER_PROVIDERS: readonly WeatherProviderId[] = ["open-meteo"];
const LAYOUT_MODES: readonly LayoutMode[] = ["grid", "free"];
const LAYOUT_ZONES: readonly LayoutZone[] = ["contained", "full"];
const BLOCK_TYPES: readonly BlockType[] = [
  "dateTime",
  "ip",
  "links",
  "search",
  "timer",
  "stopwatch",
  "pomodoro",
  "note",
  "localTasks",
  "googleCalendar",
  "weather",
  "commands",
  "recent",
  "browserPinned",
  "startPinned",
  "stats",
];

export const DEFAULT_SEARCH_PROVIDERS: SearchProvider[] = [
  { id: "google", title: "Google", urlTemplate: "https://www.google.com/search?q={query}" },
  { id: "yandex", title: "Yandex", urlTemplate: "https://yandex.ru/search/?text={query}" },
  { id: "perplexity", title: "Perplexity", urlTemplate: "https://www.perplexity.ai/search?q={query}" },
  { id: "duckduckgo", title: "DuckDuckGo", urlTemplate: "https://duckduckgo.com/?q={query}" },
  { id: "brave", title: "Brave", urlTemplate: "https://search.brave.com/search?q={query}" },
  { id: "bing", title: "Bing", urlTemplate: "https://www.bing.com/search?q={query}" },
  { id: "kagi", title: "Kagi", urlTemplate: "https://kagi.com/search?q={query}" },
];

export const DEFAULT_LAYOUT_BLOCKS: LayoutBlock[] = [
  { id: "dateTime", type: "dateTime", title: "Date & Time", enabled: true, column: 1, row: 1, width: 4, height: 2 },
  { id: "search", type: "search", title: "Search", enabled: true, column: 5, row: 1, width: 5, height: 2 },
  { id: "ip", type: "ip", title: "IP", enabled: true, column: 10, row: 1, width: 3, height: 2 },
  { id: "links", type: "links", title: "Links", enabled: true, column: 1, row: 3, width: 6, height: 4 },
  { id: "timer", type: "timer", title: "Timer", enabled: true, column: 7, row: 3, width: 2, height: 2 },
  { id: "stopwatch", type: "stopwatch", title: "Stopwatch", enabled: true, column: 9, row: 3, width: 2, height: 2 },
  { id: "pomodoro", type: "pomodoro", title: "Pomodoro", enabled: true, column: 11, row: 3, width: 2, height: 2 },
  { id: "note", type: "note", title: "Scratchpad", enabled: true, column: 7, row: 5, width: 3, height: 3 },
  { id: "localTasks", type: "localTasks", title: "Local Tasks", enabled: true, column: 10, row: 5, width: 3, height: 3 },
  { id: "startPinned", type: "startPinned", title: "Start Tab Pinned", enabled: true, column: 1, row: 7, width: 3, height: 2 },
  { id: "commands", type: "commands", title: "Commands", enabled: true, column: 4, row: 7, width: 3, height: 2 },
  { id: "recent", type: "recent", title: "Recent History", enabled: true, column: 7, row: 7, width: 3, height: 2 },
  { id: "stats", type: "stats", title: "Focus Stats", enabled: true, column: 10, row: 7, width: 3, height: 2 },
  { id: "browserPinned", type: "browserPinned", title: "Browser Pinned", enabled: false, column: 1, row: 9, width: 3, height: 2 },
  { id: "googleCalendar", type: "googleCalendar", title: "Google Calendar", enabled: false, column: 4, row: 9, width: 3, height: 2 },
  { id: "weather", type: "weather", title: "Weather", enabled: false, column: 7, row: 9, width: 3, height: 2 },
];

export function cloneLayoutBlocks(blocks: LayoutBlock[]): LayoutBlock[] {
  return blocks.map((block) => ({
    ...block,
    free: block.free ? { ...block.free } : undefined,
    config: block.config ? { ...block.config } : undefined,
  }));
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: "work", title: "Work", columns: 12, blocks: cloneLayoutBlocks(DEFAULT_LAYOUT_BLOCKS) },
  {
    id: "minimal",
    title: "Minimal",
    columns: 12,
    blocks: [
      { id: "dateTime", type: "dateTime", title: "Date & Time", enabled: true, column: 1, row: 1, width: 4, height: 2 },
      { id: "search", type: "search", title: "Search", enabled: true, column: 5, row: 1, width: 5, height: 2 },
      { id: "links", type: "links", title: "Links", enabled: true, column: 1, row: 3, width: 6, height: 4 },
      { id: "commands", type: "commands", title: "Commands", enabled: true, column: 7, row: 3, width: 3, height: 2 },
    ],
  },
  {
    id: "focus",
    title: "Focus",
    columns: 12,
    blocks: [
      { id: "dateTime", type: "dateTime", title: "Date & Time", enabled: true, column: 1, row: 1, width: 3, height: 2 },
      { id: "pomodoro", type: "pomodoro", title: "Pomodoro", enabled: true, column: 4, row: 1, width: 3, height: 2 },
      { id: "timer", type: "timer", title: "Timer", enabled: true, column: 7, row: 1, width: 2, height: 2 },
      { id: "note", type: "note", title: "Scratchpad", enabled: true, column: 1, row: 3, width: 5, height: 4 },
      { id: "localTasks", type: "localTasks", title: "Local Tasks", enabled: true, column: 6, row: 3, width: 4, height: 4 },
      { id: "stats", type: "stats", title: "Focus Stats", enabled: true, column: 10, row: 1, width: 3, height: 3 },
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    columns: 12,
    blocks: [
      { id: "dateTime", type: "dateTime", title: "Date & Time", enabled: true, column: 1, row: 1, width: 3, height: 2 },
      { id: "weather", type: "weather", title: "Weather", enabled: true, column: 4, row: 1, width: 3, height: 2 },
      { id: "ip", type: "ip", title: "IP", enabled: true, column: 7, row: 1, width: 3, height: 2 },
      { id: "search", type: "search", title: "Search", enabled: true, column: 1, row: 3, width: 5, height: 2 },
      { id: "links", type: "links", title: "Links", enabled: true, column: 1, row: 5, width: 6, height: 4 },
      { id: "googleCalendar", type: "googleCalendar", title: "Google Calendar", enabled: true, column: 7, row: 3, width: 3, height: 3 },
      { id: "recent", type: "recent", title: "Recent History", enabled: true, column: 10, row: 3, width: 3, height: 3 },
      { id: "browserPinned", type: "browserPinned", title: "Browser Pinned", enabled: true, column: 7, row: 6, width: 3, height: 2 },
      { id: "startPinned", type: "startPinned", title: "Start Tab Pinned", enabled: true, column: 10, row: 6, width: 3, height: 2 },
    ],
  },
  {
    id: "development",
    title: "Development",
    columns: 12,
    blocks: [
      { id: "search", type: "search", title: "Search", enabled: true, column: 1, row: 1, width: 5, height: 2 },
      { id: "links", type: "links", title: "Links", enabled: true, column: 1, row: 3, width: 5, height: 4 },
      { id: "note", type: "note", title: "Scratchpad", enabled: true, column: 6, row: 1, width: 4, height: 4 },
      { id: "localTasks", type: "localTasks", title: "Local Tasks", enabled: true, column: 10, row: 1, width: 3, height: 4 },
      { id: "recent", type: "recent", title: "Recent History", enabled: true, column: 6, row: 5, width: 3, height: 2 },
      { id: "commands", type: "commands", title: "Commands", enabled: true, column: 9, row: 5, width: 4, height: 2 },
    ],
  },
  {
    id: "rest",
    title: "Rest",
    columns: 12,
    blocks: [
      { id: "dateTime", type: "dateTime", title: "Date & Time", enabled: true, column: 1, row: 1, width: 4, height: 2 },
      { id: "weather", type: "weather", title: "Weather", enabled: true, column: 5, row: 1, width: 4, height: 2 },
      { id: "links", type: "links", title: "Links", enabled: true, column: 1, row: 3, width: 5, height: 4 },
      { id: "startPinned", type: "startPinned", title: "Start Tab Pinned", enabled: true, column: 6, row: 3, width: 3, height: 2 },
      { id: "timer", type: "timer", title: "Timer", enabled: true, column: 9, row: 3, width: 2, height: 2 },
      { id: "commands", type: "commands", title: "Commands", enabled: true, column: 6, row: 5, width: 5, height: 2 },
    ],
  },
];

export const DEFAULT_SETTINGS: StartPageSettings = {
  startTab: {
    enabled: true,
  },
  appearance: {
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    baseFontSize: 16,
    textColor: "#f8fafc",
    backgroundColor: "#08111f",
    backgroundImage: "",
    backgroundEffect: "aurora",
  },
  settingsButton: {
    visibility: "hover",
    hoverArea: "top-right",
  },
  dateTime: {
    mode: "both",
    dateFormat: "dddd, DD MMMM YYYY",
    timeFormat: "HH:mm",
  },
  ip: {
    endpoint: "https://ipapi.co/json/",
  },
  links: {
    columns: 4,
    rows: 2,
    pageDirection: "horizontal",
    fontFamily: "inherit",
    fontSize: 13,
    iconSize: 28,
    items: [
      { icon: "G", title: "Google", url: "https://google.com" },
      { icon: "Y", title: "Yandex", url: "https://yandex.ru" },
      { icon: "P", title: "Perplexity", url: "https://www.perplexity.ai" },
      { icon: "GH", title: "GitHub", url: "https://github.com" },
      { icon: "YT", title: "YouTube", url: "https://youtube.com" },
      { icon: "TG", title: "Telegram", url: "https://web.telegram.org" },
      { icon: "AI", title: "ChatGPT", url: "https://chatgpt.com" },
      { icon: "DDG", title: "DuckDuckGo", url: "https://duckduckgo.com" },
    ],
  },
  startPinned: {
    items: [
      { icon: "AI", title: "ChatGPT", url: "https://chatgpt.com" },
      { icon: "GH", title: "GitHub", url: "https://github.com" },
      { icon: "DOC", title: "Docs", url: "https://docs.google.com" },
    ],
  },
  search: {
    provider: "google",
    providers: [...DEFAULT_SEARCH_PROVIDERS],
  },
  googleCalendar: {
    calendarId: "primary",
    maxResults: 6,
  },
  weather: {
    provider: "open-meteo",
    city: "Amsterdam",
    latitude: 52.3676,
    longitude: 4.9041,
    displayMode: "current",
    forecastEndpoint: "https://api.open-meteo.com/v1/forecast",
    geocodingEndpoint: "https://geocoding-api.open-meteo.com/v1/search",
  },
  timers: {
    timerSeconds: 5 * 60,
    pomodoroWorkSeconds: 25 * 60,
    pomodoroBreakSeconds: 5 * 60,
    notifyOnComplete: true,
  },
  focusStats: {
    defaultMinutesPerAvoidedVisit: 10,
    avoidedVisitDedupeSeconds: 5 * 60,
    domainMinutes: {},
  },
  layout: {
    columns: 12,
    profile: "work",
    mode: "grid",
    zone: "contained",
    showBlockTitles: true,
    blocks: cloneLayoutBlocks(DEFAULT_LAYOUT_BLOCKS),
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function finiteInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(finiteNumber(value, fallback, min, max));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

function recordValue(value: unknown, fallback?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (isRecord(value)) return { ...value };
  return fallback ? { ...fallback } : undefined;
}

function safeWebUrl(value: string): string | null {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

function safeWebUrlTemplate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.includes("{query}")) return null;
  return safeWebUrl(trimmed.split("{query}").join("start-tab-query")) ? trimmed : null;
}

function freeRectValue(value: unknown, fallback?: FreeBlockRect): FreeBlockRect | undefined {
  const source = isRecord(value) ? value : fallback;
  if (!source) return undefined;
  return {
    x: finiteNumber(source.x, fallback?.x ?? 0, 0, 100_000),
    y: finiteNumber(source.y, fallback?.y ?? 0, 0, 100_000),
    width: finiteNumber(source.width, fallback?.width ?? 260, 120, 100_000),
    height: finiteNumber(source.height, fallback?.height ?? 180, 80, 100_000),
  };
}

function isStartLink(value: unknown): value is StartLink {
  return isRecord(value)
    && typeof value.icon === "string"
    && typeof value.title === "string"
    && typeof value.url === "string"
    && safeWebUrl(value.url) !== null;
}

function mergeStartLinks(base: StartLink[], value: unknown): StartLink[] {
  if (!Array.isArray(value)) return base.map((item) => ({ ...item }));
  return value.filter(isStartLink).map((item) => ({ ...item, url: safeWebUrl(item.url) ?? item.url }));
}

function isSearchProvider(value: unknown): value is SearchProvider {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.title === "string"
    && typeof value.urlTemplate === "string"
    && safeWebUrlTemplate(value.urlTemplate) !== null;
}

function mergeSearchProviders(base: SearchProvider[], value: unknown): SearchProvider[] {
  const byId = new Map<string, SearchProvider>();
  for (const provider of base) byId.set(provider.id, { ...provider });
  if (Array.isArray(value)) {
    for (const provider of value) {
      if (isSearchProvider(provider)) byId.set(provider.id, { ...provider, urlTemplate: safeWebUrlTemplate(provider.urlTemplate) ?? provider.urlTemplate });
    }
  }
  return [...byId.values()];
}

function mergeDomainMinutes(value: unknown): Record<string, number> {
  const next: Record<string, number> = {};
  if (!isRecord(value)) return next;
  for (const [domain, minutes] of Object.entries(value)) {
    if (typeof minutes === "number" && Number.isFinite(minutes) && minutes >= 0) {
      next[domain] = Math.min(240, minutes);
    }
  }
  return next;
}

function cloneDisabledLayoutBlock(block: LayoutBlock): LayoutBlock {
  return cloneLayoutBlocks([{ ...block, enabled: false }])[0]!;
}

function uniqueLayoutBlockId(id: string, type: BlockType, seenIds: Set<string>): string {
  const base = id.trim() || type;
  if (!seenIds.has(base)) return base;

  let suffix = 2;
  let candidate = `${base}-${suffix}`;
  while (seenIds.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

function mergeLayoutBlocks(base: LayoutBlock[], value: unknown, columns: number): LayoutBlock[] {
  if (!Array.isArray(value)) return cloneLayoutBlocks(base);
  const fallbackById = new Map(base.map((block) => [block.id, block]));
  const seenIds = new Set<string>();
  const blocks = value.filter(isRecord).map((block, index) => {
    const fallback = fallbackById.get(stringValue(block.id, "")) ?? base[index] ?? DEFAULT_LAYOUT_BLOCKS[0]!;
    const type = oneOf(block.type, BLOCK_TYPES, fallback.type);
    const id = uniqueLayoutBlockId(stringValue(block.id, fallback.id), type, seenIds);
    const width = finiteInteger(block.width, fallback.width, 1, columns);
    const free = freeRectValue(block.free, fallback.free);
    const config = recordValue(block.config, fallback.config);
    const merged = {
      id,
      type,
      title: stringValue(block.title, fallback.title),
      enabled: booleanValue(block.enabled, fallback.enabled),
      column: finiteInteger(block.column, fallback.column, 1, Math.max(1, columns - width + 1)),
      row: finiteInteger(block.row, fallback.row, 1, 200),
      width,
      height: finiteInteger(block.height, fallback.height, 1, 80),
      ...(free ? { free } : {}),
      ...(config ? { config } : {}),
    };
    seenIds.add(merged.id);
    return merged;
  });

  for (const block of base) {
    if (!seenIds.has(block.id)) blocks.push(cloneDisabledLayoutBlock(block));
  }

  return blocks;
}

function mergeSettings(base: StartPageSettings, value: unknown): StartPageSettings {
  if (!isRecord(value)) return base;

  const startTab = isRecord(value.startTab) ? value.startTab : {};
  const appearance = isRecord(value.appearance) ? value.appearance : {};
  const settingsButton = isRecord(value.settingsButton) ? value.settingsButton : {};
  const dateTime = isRecord(value.dateTime) ? value.dateTime : {};
  const ip = isRecord(value.ip) ? value.ip : {};
  const links = isRecord(value.links) ? value.links : {};
  const startPinned = isRecord(value.startPinned) ? value.startPinned : {};
  const search = isRecord(value.search) ? value.search : {};
  const providers = mergeSearchProviders(base.search.providers, search.providers);
  const searchProvider = typeof search.provider === "string" && providers.some((provider) => provider.id === search.provider)
    ? search.provider
    : base.search.provider;
  const googleCalendar = isRecord(value.googleCalendar) ? value.googleCalendar : {};
  const weather = isRecord(value.weather) ? value.weather : {};
  const timers = isRecord(value.timers) ? value.timers : {};
  const focusStats = isRecord(value.focusStats) ? value.focusStats : {};
  const layout = isRecord(value.layout) ? value.layout : {};
  const columns = finiteInteger(layout.columns, base.layout.columns, 1, 80);

  return {
    startTab: {
      enabled: booleanValue(startTab.enabled, base.startTab.enabled),
    },
    appearance: {
      fontFamily: stringValue(appearance.fontFamily, base.appearance.fontFamily),
      baseFontSize: finiteNumber(appearance.baseFontSize, base.appearance.baseFontSize, 10, 32),
      textColor: stringValue(appearance.textColor, base.appearance.textColor),
      backgroundColor: stringValue(appearance.backgroundColor, base.appearance.backgroundColor),
      backgroundImage: stringValue(appearance.backgroundImage, base.appearance.backgroundImage),
      backgroundEffect: oneOf(appearance.backgroundEffect, BACKGROUND_EFFECTS, base.appearance.backgroundEffect),
    },
    settingsButton: {
      visibility: oneOf(settingsButton.visibility, SETTINGS_BUTTON_VISIBILITIES, base.settingsButton.visibility),
      hoverArea: oneOf(settingsButton.hoverArea, SETTINGS_BUTTON_HOVER_AREAS, base.settingsButton.hoverArea),
    },
    dateTime: {
      mode: oneOf(dateTime.mode, DATE_TIME_MODES, base.dateTime.mode),
      dateFormat: stringValue(dateTime.dateFormat, base.dateTime.dateFormat),
      timeFormat: stringValue(dateTime.timeFormat, base.dateTime.timeFormat),
    },
    ip: {
      endpoint: stringValue(ip.endpoint, base.ip.endpoint),
    },
    links: {
      columns: finiteInteger(links.columns, base.links.columns, 1, 12),
      rows: finiteInteger(links.rows, base.links.rows, 1, 8),
      pageDirection: oneOf(links.pageDirection, LINK_PAGE_DIRECTIONS, base.links.pageDirection),
      fontFamily: stringValue(links.fontFamily, base.links.fontFamily),
      fontSize: finiteNumber(links.fontSize, base.links.fontSize, 8, 48),
      iconSize: finiteNumber(links.iconSize, base.links.iconSize, 12, 128),
      items: mergeStartLinks(base.links.items, links.items),
    },
    startPinned: {
      items: mergeStartLinks(base.startPinned.items, startPinned.items),
    },
    search: {
      provider: searchProvider,
      providers,
    },
    googleCalendar: {
      calendarId: stringValue(googleCalendar.calendarId, base.googleCalendar.calendarId),
      maxResults: finiteInteger(googleCalendar.maxResults, base.googleCalendar.maxResults, 1, 25),
    },
    weather: {
      provider: oneOf(weather.provider, WEATHER_PROVIDERS, base.weather.provider),
      city: stringValue(weather.city, base.weather.city),
      latitude: finiteNumber(weather.latitude, base.weather.latitude, -90, 90),
      longitude: finiteNumber(weather.longitude, base.weather.longitude, -180, 180),
      displayMode: oneOf(weather.displayMode, WEATHER_DISPLAY_MODES, base.weather.displayMode),
      forecastEndpoint: stringValue(weather.forecastEndpoint, base.weather.forecastEndpoint),
      geocodingEndpoint: stringValue(weather.geocodingEndpoint, base.weather.geocodingEndpoint),
    },
    timers: {
      timerSeconds: finiteInteger(timers.timerSeconds, base.timers.timerSeconds, 1, 86400),
      pomodoroWorkSeconds: finiteInteger(timers.pomodoroWorkSeconds, base.timers.pomodoroWorkSeconds, 1, 86400),
      pomodoroBreakSeconds: finiteInteger(timers.pomodoroBreakSeconds, base.timers.pomodoroBreakSeconds, 1, 86400),
      notifyOnComplete: booleanValue(timers.notifyOnComplete, base.timers.notifyOnComplete),
    },
    focusStats: {
      defaultMinutesPerAvoidedVisit: finiteNumber(
        focusStats.defaultMinutesPerAvoidedVisit,
        base.focusStats.defaultMinutesPerAvoidedVisit,
        0,
        240,
      ),
      avoidedVisitDedupeSeconds: finiteInteger(
        focusStats.avoidedVisitDedupeSeconds,
        base.focusStats.avoidedVisitDedupeSeconds,
        0,
        86400,
      ),
      domainMinutes: mergeDomainMinutes(focusStats.domainMinutes),
    },
    layout: {
      columns,
      profile: stringValue(layout.profile, base.layout.profile),
      mode: oneOf(layout.mode, LAYOUT_MODES, base.layout.mode),
      zone: oneOf(layout.zone, LAYOUT_ZONES, base.layout.zone),
      showBlockTitles: booleanValue(layout.showBlockTitles, base.layout.showBlockTitles),
      blocks: mergeLayoutBlocks(base.layout.blocks, layout.blocks, columns),
    },
  };
}

export function normalizeStartPageSettings(value: unknown): StartPageSettings {
  return mergeSettings(DEFAULT_SETTINGS, value);
}

export async function getStartPageSettings(): Promise<StartPageSettings> {
  const items = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeStartPageSettings(items[SETTINGS_KEY]);
}

export async function setStartPageSettings(settings: StartPageSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalizeStartPageSettings(settings) });
}

export async function resetStartPageSettings(): Promise<StartPageSettings> {
  await setStartPageSettings(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}
