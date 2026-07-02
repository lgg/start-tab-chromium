export type BackgroundEffect = "none" | "gradient" | "aurora" | "mesh" | "spotlight" | "noise";
export type SettingsButtonVisibility = "always" | "hover";
export type SearchProviderId = "google" | "yandex" | "perplexity" | "duckduckgo" | "brave";
export type DateTimeMode = "both" | "date" | "time";
export type LinkPageDirection = "horizontal" | "vertical";
export type BlockType =
  | "dateTime"
  | "ip"
  | "links"
  | "search"
  | "timer"
  | "stopwatch"
  | "pomodoro"
  | "note"
  | "agenda"
  | "weather"
  | "commands"
  | "recent"
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
  search: {
    provider: SearchProviderId;
    providers: SearchProvider[];
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
  search: {
    provider: "google",
    providers: [
      { id: "google", title: "Google", urlTemplate: "https://www.google.com/search?q={query}" },
      { id: "yandex", title: "Yandex", urlTemplate: "https://yandex.ru/search/?text={query}" },
      { id: "perplexity", title: "Perplexity", urlTemplate: "https://www.perplexity.ai/search?q={query}" },
      { id: "duckduckgo", title: "DuckDuckGo", urlTemplate: "https://duckduckgo.com/?q={query}" },
      { id: "brave", title: "Brave", urlTemplate: "https://search.brave.com/search?q={query}" }
    ],
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
    blocks: [
      { id: "dateTime", type: "dateTime", title: "Date & Time", enabled: true, column: 1, row: 1, width: 4, height: 2 },
      { id: "search", type: "search", title: "Search", enabled: true, column: 5, row: 1, width: 5, height: 2 },
      { id: "ip", type: "ip", title: "IP", enabled: true, column: 10, row: 1, width: 3, height: 2 },
      { id: "links", type: "links", title: "Links", enabled: true, column: 1, row: 3, width: 6, height: 4 },
      { id: "timer", type: "timer", title: "Timer", enabled: true, column: 7, row: 3, width: 2, height: 2 },
      { id: "stopwatch", type: "stopwatch", title: "Stopwatch", enabled: true, column: 9, row: 3, width: 2, height: 2 },
      { id: "pomodoro", type: "pomodoro", title: "Pomodoro", enabled: true, column: 11, row: 3, width: 2, height: 2 },
      { id: "note", type: "note", title: "Scratchpad", enabled: true, column: 7, row: 5, width: 3, height: 3 },
      { id: "agenda", type: "agenda", title: "Agenda", enabled: true, column: 10, row: 5, width: 3, height: 3 },
      { id: "weather", type: "weather", title: "Weather", enabled: false, column: 1, row: 7, width: 3, height: 2 },
      { id: "commands", type: "commands", title: "Commands", enabled: true, column: 4, row: 7, width: 3, height: 2 },
      { id: "recent", type: "recent", title: "Recent", enabled: false, column: 7, row: 7, width: 3, height: 2 },
      { id: "stats", type: "stats", title: "Focus Stats", enabled: true, column: 10, row: 7, width: 3, height: 2 }
    ],
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
    search: { ...base.search, ...(isRecord(value.search) ? value.search : {}) },
    timers: { ...base.timers, ...(isRecord(value.timers) ? value.timers : {}) },
    focusStats: { ...base.focusStats, ...(isRecord(value.focusStats) ? value.focusStats : {}) },
    layout: { ...base.layout, ...(isRecord(value.layout) ? value.layout : {}) },
  } as StartPageSettings;
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
