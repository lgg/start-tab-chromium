export type BackgroundEffect = "none" | "gradient" | "aurora" | "mesh" | "spotlight" | "noise";
export type SettingsButtonVisibility = "always" | "hover";
export type SearchProviderId = string;
export type DateTimeMode = "both" | "date" | "time";
export type LinkPageDirection = "horizontal" | "vertical";
export type WeatherDisplayMode = "current" | "day" | "week";
export type WeatherProviderId = "open-meteo";
export type LayoutPresetId = "work" | "minimal" | "focus" | "dashboard";
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

export interface LayoutBlock {
  id: string;
  type: BlockType;
  title: string;
  enabled: boolean;
  column: number;
  row: number;
  width: number;
  height: number;
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
    blocks: LayoutBlock[];
  };
}

const SETTINGS_KEY = "startPageSettings";

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

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: "work", title: "Work", columns: 12, blocks: DEFAULT_LAYOUT_BLOCKS },
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
];

export const DEFAULT_SETTINGS: StartPageSettings = {
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
      { icon: "DDG", title: "DuckDuckGo", url: "https://duckduckgo.com" }
    ],
  },
  startPinned: {
    items: [
      { icon: "AI", title: "ChatGPT", url: "https://chatgpt.com" },
      { icon: "GH", title: "GitHub", url: "https://github.com" },
      { icon: "DOC", title: "Docs", url: "https://docs.google.com" }
    ],
  },
  search: {
    provider: "google",
    providers: DEFAULT_SEARCH_PROVIDERS,
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
    blocks: DEFAULT_LAYOUT_BLOCKS,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mergeSettings(base: StartPageSettings, value: unknown): StartPageSettings {
  if (!isRecord(value)) return base;
  return {
    ...base,
    ...value,
    appearance: { ...base.appearance, ...(isRecord(value.appearance) ? value.appearance : {}) },
    settingsButton: { ...base.settingsButton, ...(isRecord(value.settingsButton) ? value.settingsButton : {}) },
    dateTime: { ...base.dateTime, ...(isRecord(value.dateTime) ? value.dateTime : {}) },
    ip: { ...base.ip, ...(isRecord(value.ip) ? value.ip : {}) },
    links: { ...base.links, ...(isRecord(value.links) ? value.links : {}) },
    startPinned: { ...base.startPinned, ...(isRecord(value.startPinned) ? value.startPinned : {}) },
    search: { ...base.search, ...(isRecord(value.search) ? value.search : {}) },
    googleCalendar: { ...base.googleCalendar, ...(isRecord(value.googleCalendar) ? value.googleCalendar : {}) },
    weather: { ...base.weather, ...(isRecord(value.weather) ? value.weather : {}) },
    timers: { ...base.timers, ...(isRecord(value.timers) ? value.timers : {}) },
    focusStats: { ...base.focusStats, ...(isRecord(value.focusStats) ? value.focusStats : {}) },
    layout: { ...base.layout, ...(isRecord(value.layout) ? value.layout : {}) },
  } as StartPageSettings;
}

export function cloneLayoutBlocks(blocks: LayoutBlock[]): LayoutBlock[] {
  return blocks.map((block) => ({ ...block }));
}

export async function getStartPageSettings(): Promise<StartPageSettings> {
  const items = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeSettings(DEFAULT_SETTINGS, items[SETTINGS_KEY]);
}

export async function setStartPageSettings(settings: StartPageSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function resetStartPageSettings(): Promise<StartPageSettings> {
  await setStartPageSettings(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}
