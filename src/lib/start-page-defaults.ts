import {
  BLOCK_INSTANCE_SCHEMA_VERSION,
  SINGLETON_BLOCK_TYPES,
  START_PAGE_SCHEMA_VERSION,
  THEME_SCHEMA_VERSION,
  type BlockConfig,
  type BlockConfigFor,
  type BlockDescriptor,
  type BlockInstance,
  type BlockInstanceFor,
  type BlockType,
  type LayoutPreset,
  type LayoutZone,
  type SearchProvider,
  type StartLink,
  type StartPageSettings,
  type StartPageTheme,
} from "./start-page-types.js";

const DEFAULT_FONT = "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const DEFAULT_CREATED_AT = 0;

export const DEFAULT_SEARCH_PROVIDERS: SearchProvider[] = [
  { id: "google", title: "Google", urlTemplate: "https://www.google.com/search?q={query}" },
  { id: "yandex", title: "Yandex", urlTemplate: "https://yandex.ru/search/?text={query}" },
  { id: "perplexity", title: "Perplexity", urlTemplate: "https://www.perplexity.ai/search?q={query}" },
  { id: "duckduckgo", title: "DuckDuckGo", urlTemplate: "https://duckduckgo.com/?q={query}" },
  { id: "brave", title: "Brave", urlTemplate: "https://search.brave.com/search?q={query}" },
  { id: "bing", title: "Bing", urlTemplate: "https://www.bing.com/search?q={query}" },
  { id: "kagi", title: "Kagi", urlTemplate: "https://kagi.com/search?q={query}" },
];

function link(id: string, icon: string, title: string, url: string): StartLink {
  return { id, icon, title, url };
}

export const DEFAULT_LINKS: StartLink[] = [
  link("google", "G", "Google", "https://google.com"),
  link("yandex", "Y", "Yandex", "https://yandex.ru"),
  link("perplexity", "P", "Perplexity", "https://www.perplexity.ai"),
  link("github", "GH", "GitHub", "https://github.com"),
  link("youtube", "YT", "YouTube", "https://youtube.com"),
  link("telegram", "TG", "Telegram", "https://web.telegram.org"),
  link("chatgpt", "AI", "ChatGPT", "https://chatgpt.com"),
  link("duckduckgo", "DDG", "DuckDuckGo", "https://duckduckgo.com"),
];

export const DEFAULT_PINNED_LINKS: StartLink[] = [
  link("chatgpt", "AI", "ChatGPT", "https://chatgpt.com"),
  link("github", "GH", "GitHub", "https://github.com"),
  link("docs", "DOC", "Docs", "https://docs.google.com"),
];

export const BLOCK_DESCRIPTORS: readonly BlockDescriptor[] = [
  { type: "dateTime", titleKey: "blockTitleDateTime", descriptionKey: "blockDescriptionDateTime", repeatable: true, minGridWidth: 2, minGridHeight: 2, defaultGridWidth: 4, defaultGridHeight: 2, minFreeWidth: 220, minFreeHeight: 130, containsUserData: false },
  { type: "ip", titleKey: "blockTitleIp", descriptionKey: "blockDescriptionIp", repeatable: true, minGridWidth: 2, minGridHeight: 2, defaultGridWidth: 3, defaultGridHeight: 2, minFreeWidth: 220, minFreeHeight: 130, containsUserData: false },
  { type: "links", titleKey: "blockTitleLinks", descriptionKey: "blockDescriptionLinks", repeatable: true, minGridWidth: 2, minGridHeight: 2, defaultGridWidth: 6, defaultGridHeight: 4, minFreeWidth: 280, minFreeHeight: 220, containsUserData: true },
  { type: "search", titleKey: "blockTitleSearch", descriptionKey: "blockDescriptionSearch", repeatable: true, minGridWidth: 3, minGridHeight: 2, defaultGridWidth: 5, defaultGridHeight: 2, minFreeWidth: 300, minFreeHeight: 130, containsUserData: false },
  { type: "timer", titleKey: "blockTitleTimer", descriptionKey: "blockDescriptionTimer", repeatable: true, minGridWidth: 2, minGridHeight: 2, defaultGridWidth: 2, defaultGridHeight: 2, minFreeWidth: 210, minFreeHeight: 160, containsUserData: false },
  { type: "stopwatch", titleKey: "blockTitleStopwatch", descriptionKey: "blockDescriptionStopwatch", repeatable: true, minGridWidth: 2, minGridHeight: 2, defaultGridWidth: 2, defaultGridHeight: 2, minFreeWidth: 210, minFreeHeight: 160, containsUserData: false },
  { type: "pomodoro", titleKey: "blockTitlePomodoro", descriptionKey: "blockDescriptionPomodoro", repeatable: true, minGridWidth: 2, minGridHeight: 2, defaultGridWidth: 3, defaultGridHeight: 2, minFreeWidth: 240, minFreeHeight: 170, containsUserData: false },
  { type: "note", titleKey: "blockTitleNote", descriptionKey: "blockDescriptionNote", repeatable: true, minGridWidth: 2, minGridHeight: 2, defaultGridWidth: 3, defaultGridHeight: 3, minFreeWidth: 250, minFreeHeight: 210, containsUserData: true },
  { type: "localTasks", titleKey: "blockTitleLocalTasks", descriptionKey: "blockDescriptionLocalTasks", repeatable: true, minGridWidth: 2, minGridHeight: 2, defaultGridWidth: 3, defaultGridHeight: 3, minFreeWidth: 260, minFreeHeight: 230, containsUserData: true },
  { type: "googleCalendar", titleKey: "blockTitleGoogleCalendar", descriptionKey: "blockDescriptionGoogleCalendar", repeatable: true, minGridWidth: 2, minGridHeight: 2, defaultGridWidth: 3, defaultGridHeight: 3, minFreeWidth: 270, minFreeHeight: 230, containsUserData: false },
  { type: "weather", titleKey: "blockTitleWeather", descriptionKey: "blockDescriptionWeather", repeatable: true, minGridWidth: 2, minGridHeight: 2, defaultGridWidth: 3, defaultGridHeight: 2, minFreeWidth: 240, minFreeHeight: 170, containsUserData: false },
  { type: "commands", titleKey: "blockTitleCommands", descriptionKey: "blockDescriptionCommands", repeatable: false, minGridWidth: 2, minGridHeight: 2, defaultGridWidth: 3, defaultGridHeight: 2, minFreeWidth: 240, minFreeHeight: 160, containsUserData: false },
  { type: "recent", titleKey: "blockTitleRecent", descriptionKey: "blockDescriptionRecent", repeatable: false, minGridWidth: 2, minGridHeight: 2, defaultGridWidth: 3, defaultGridHeight: 2, minFreeWidth: 260, minFreeHeight: 180, containsUserData: false },
  { type: "browserPinned", titleKey: "blockTitleBrowserPinned", descriptionKey: "blockDescriptionBrowserPinned", repeatable: false, minGridWidth: 2, minGridHeight: 2, defaultGridWidth: 3, defaultGridHeight: 2, minFreeWidth: 260, minFreeHeight: 180, containsUserData: false },
  { type: "startPinned", titleKey: "blockTitleStartPinned", descriptionKey: "blockDescriptionStartPinned", repeatable: true, minGridWidth: 2, minGridHeight: 2, defaultGridWidth: 3, defaultGridHeight: 2, minFreeWidth: 260, minFreeHeight: 180, containsUserData: true },
  { type: "stats", titleKey: "blockTitleStats", descriptionKey: "blockDescriptionStats", repeatable: false, minGridWidth: 2, minGridHeight: 2, defaultGridWidth: 3, defaultGridHeight: 2, minFreeWidth: 260, minFreeHeight: 190, containsUserData: false },
];

const DESCRIPTOR_BY_TYPE = new Map(BLOCK_DESCRIPTORS.map((descriptor) => [descriptor.type, descriptor]));

export function blockDescriptor(type: BlockType): BlockDescriptor {
  const descriptor = DESCRIPTOR_BY_TYPE.get(type);
  if (!descriptor) throw new Error(`Unknown block type: ${type}`);
  return descriptor;
}

export function isSingletonBlockType(type: BlockType): boolean {
  return (SINGLETON_BLOCK_TYPES as readonly BlockType[]).includes(type);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function cloneTheme(theme: StartPageTheme): StartPageTheme {
  return cloneJson(theme);
}

export function cloneBlock<T extends BlockInstance>(block: T): T {
  return cloneJson(block);
}

export function cloneBlocks(blocks: readonly BlockInstance[]): BlockInstance[] {
  return blocks.map((block) => cloneBlock(block));
}

export function cloneSettings(settings: StartPageSettings): StartPageSettings {
  return cloneJson(settings);
}

function uniqueSuffix(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createBlockId(type: BlockType): string {
  return `${type}-${uniqueSuffix()}`;
}

export function createThemeId(): string {
  return `theme-${uniqueSuffix()}`;
}

export function defaultBlockConfig<T extends BlockType>(type: T): BlockConfigFor<T> {
  let config: BlockConfig;
  switch (type) {
    case "dateTime":
      config = { type, mode: "both", dateFormat: "dddd, DD MMMM YYYY", timeFormat: "HH:mm", timeZone: "", locale: "", timeFontSize: 48 };
      break;
    case "ip":
      config = { type, endpoint: "https://ipapi.co/json/" };
      break;
    case "links":
      config = { type, columns: 4, rows: 2, pageDirection: "horizontal", fontFamily: "inherit", fontSize: 13, iconSize: 28, items: cloneJson(DEFAULT_LINKS) };
      break;
    case "search":
      config = { type, provider: "google", providers: cloneJson(DEFAULT_SEARCH_PROVIDERS), placeholder: "" };
      break;
    case "timer":
      config = { type, durationSeconds: 5 * 60, notifyOnComplete: true };
      break;
    case "stopwatch":
      config = { type };
      break;
    case "pomodoro":
      config = { type, workSeconds: 25 * 60, breakSeconds: 5 * 60, notifyOnComplete: true, autoStartNextPhase: false };
      break;
    case "note":
      config = { type, placeholder: "", confirmDeleteWithContent: true };
      break;
    case "localTasks":
      config = { type, placeholder: "", showCompleted: true, confirmDeleteWithContent: true };
      break;
    case "googleCalendar":
      config = { type, calendarId: "primary", accountLabel: "", query: "", maxResults: 6 };
      break;
    case "weather":
      config = { type, provider: "open-meteo", city: "Amsterdam", latitude: 52.3676, longitude: 4.9041, displayMode: "current", forecastEndpoint: "https://api.open-meteo.com/v1/forecast", geocodingEndpoint: "https://geocoding-api.open-meteo.com/v1/search" };
      break;
    case "commands":
      config = { type };
      break;
    case "recent":
      config = { type, maxResults: 10 };
      break;
    case "browserPinned":
      config = { type };
      break;
    case "startPinned":
      config = { type, columns: 3, rows: 2, pageDirection: "horizontal", fontFamily: "inherit", fontSize: 13, iconSize: 28, items: cloneJson(DEFAULT_PINNED_LINKS) };
      break;
    case "stats":
      config = { type };
      break;
  }
  return config as BlockConfigFor<T>;
}

export interface CreateBlockOptions {
  id?: string;
  title?: string;
  enabled?: boolean;
  zone?: LayoutZone;
  column?: number;
  row?: number;
  width?: number;
  height?: number;
  order?: number;
  free?: { x: number; y: number; width: number; height: number };
  createdAt?: number;
  updatedAt?: number;
  config?: BlockConfig;
}

export function createBlockInstance<T extends BlockType>(type: T, options: CreateBlockOptions = {}): BlockInstanceFor<T> {
  const descriptor = blockDescriptor(type);
  const createdAt = options.createdAt ?? Date.now();
  const width = options.width ?? descriptor.defaultGridWidth;
  const height = options.height ?? descriptor.defaultGridHeight;
  const config = options.config?.type === type ? cloneJson(options.config) : defaultBlockConfig(type);
  return {
    schemaVersion: BLOCK_INSTANCE_SCHEMA_VERSION,
    id: options.id ?? createBlockId(type),
    type,
    title: options.title ?? descriptor.titleKey,
    enabled: options.enabled ?? true,
    zone: options.zone ?? "contained",
    column: options.column ?? 1,
    row: options.row ?? 1,
    width,
    height,
    order: options.order ?? 0,
    free: options.free ? { ...options.free } : {
      x: Math.max(0, ((options.column ?? 1) - 1) * 92),
      y: Math.max(0, ((options.row ?? 1) - 1) * 76),
      width: Math.max(descriptor.minFreeWidth, width * 90),
      height: Math.max(descriptor.minFreeHeight, height * 72),
    },
    config,
    createdAt,
    updatedAt: options.updatedAt ?? createdAt,
  } as BlockInstanceFor<T>;
}

function builtInTheme(
  id: string,
  name: string,
  background: StartPageTheme["background"],
  tokens: Partial<StartPageTheme["tokens"]> = {},
): StartPageTheme {
  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    id,
    name,
    builtIn: true,
    background,
    tokens: {
      textPrimary: "#f8fafc",
      textSecondary: "#a9b3c4",
      cardSurface: "#101827",
      cardBorder: "rgba(255,255,255,0.12)",
      cardOpacity: 0.82,
      shadow: "0 18px 50px rgba(0,0,0,0.28)",
      accent: "#7dd3fc",
      hover: "rgba(125,211,252,0.14)",
      active: "rgba(125,211,252,0.24)",
      fontFamily: DEFAULT_FONT,
      baseFontSize: 16,
      headingScale: 1.08,
      borderRadius: 18,
      spacing: 16,
      ...tokens,
    },
    createdAt: DEFAULT_CREATED_AT,
    updatedAt: DEFAULT_CREATED_AT,
  };
}

export const BUILT_IN_THEMES: readonly StartPageTheme[] = [
  builtInTheme("start-tab-dark", "Start Tab dark", { kind: "effect", baseColor: "#08111f", config: { effect: "aurora", speed: 1, intensity: 0.65, blur: 72 } }),
  builtInTheme("chatgpt-dark", "ChatGPT dark", { kind: "solid", color: "#212121" }, { cardSurface: "#2f2f2f", cardBorder: "rgba(255,255,255,0.08)", accent: "#10a37f", hover: "rgba(16,163,127,0.15)", active: "rgba(16,163,127,0.25)", borderRadius: 16 }),
  builtInTheme("chatgpt-light", "ChatGPT light", { kind: "solid", color: "#f7f7f8" }, { textPrimary: "#202123", textSecondary: "#6b6c70", cardSurface: "#ffffff", cardBorder: "rgba(0,0,0,0.1)", shadow: "0 16px 45px rgba(0,0,0,0.08)", accent: "#10a37f", hover: "rgba(16,163,127,0.1)", active: "rgba(16,163,127,0.18)" }),
  builtInTheme("pastel-slate", "Pastel slate", { kind: "gradient", css: "linear-gradient(145deg, #dbeafe 0%, #e2e8f0 48%, #ddd6fe 100%)" }, { textPrimary: "#1e293b", textSecondary: "#64748b", cardSurface: "#ffffff", cardBorder: "rgba(71,85,105,0.15)", cardOpacity: 0.72, shadow: "0 20px 55px rgba(71,85,105,0.14)", accent: "#6366f1", hover: "rgba(99,102,241,0.1)", active: "rgba(99,102,241,0.18)" }),
  builtInTheme("pastel-rose", "Pastel rose", { kind: "gradient", css: "linear-gradient(145deg, #ffe4e6 0%, #fce7f3 52%, #ede9fe 100%)" }, { textPrimary: "#4c1d2f", textSecondary: "#7f5262", cardSurface: "#fff8fa", cardBorder: "rgba(190,24,93,0.12)", cardOpacity: 0.76, shadow: "0 20px 55px rgba(190,24,93,0.12)", accent: "#db2777", hover: "rgba(219,39,119,0.1)", active: "rgba(219,39,119,0.18)" }),
  builtInTheme("matrix", "Matrix", { kind: "effect", baseColor: "#020b05", config: { effect: "matrix", speed: 1, intensity: 0.7, density: 0.55 } }, { textPrimary: "#c7ffd5", textSecondary: "#70ba83", cardSurface: "#03170a", cardBorder: "rgba(66,255,119,0.28)", shadow: "0 20px 55px rgba(0,255,80,0.08)", accent: "#42ff77", hover: "rgba(66,255,119,0.12)", active: "rgba(66,255,119,0.22)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", borderRadius: 10 }),
  builtInTheme("cyberpunk", "Cyberpunk", { kind: "effect", baseColor: "#090414", config: { effect: "cyberpunk", speed: 1.1, intensity: 0.72, scanlines: true } }, { textPrimary: "#f8f4ff", textSecondary: "#bea9d6", cardSurface: "#160a29", cardBorder: "rgba(255,48,211,0.34)", shadow: "0 18px 55px rgba(0,229,255,0.13)", accent: "#00e5ff", hover: "rgba(0,229,255,0.13)", active: "rgba(255,48,211,0.2)", borderRadius: 10 }),
  builtInTheme("black", "Black", { kind: "solid", color: "#000000" }, { cardSurface: "#0a0a0a", cardBorder: "rgba(255,255,255,0.14)", shadow: "0 16px 50px rgba(0,0,0,0.6)", accent: "#ffffff", hover: "rgba(255,255,255,0.1)", active: "rgba(255,255,255,0.18)" }),
  builtInTheme("aurora", "Aurora", { kind: "effect", baseColor: "#07131f", config: { effect: "aurora", speed: 0.9, intensity: 0.82, blur: 88 } }, { accent: "#5eead4" }),
  builtInTheme("mesh", "Mesh", { kind: "effect", baseColor: "#0b1020", config: { effect: "mesh", speed: 0.7, intensity: 0.75, scale: 1 } }, { accent: "#a78bfa" }),
  builtInTheme("spotlight", "Spotlight", { kind: "effect", baseColor: "#070b14", config: { effect: "spotlight", speed: 0.65, intensity: 0.72, size: 62 } }, { accent: "#93c5fd" }),
  builtInTheme("noise", "Noise", { kind: "effect", baseColor: "#10131a", config: { effect: "noise", intensity: 0.22, animated: false, speed: 0.5 } }, { accent: "#d1d5db" }),
  builtInTheme("animated-gradient", "Animated gradient", { kind: "effect", baseColor: "#10152b", config: { effect: "animated-gradient", speed: 1, intensity: 0.8, angle: 135, colors: ["#111827", "#312e81", "#0f766e", "#111827"] } }, { accent: "#67e8f9" }),
];

export function getBuiltInTheme(id: string): StartPageTheme | null {
  const theme = BUILT_IN_THEMES.find((item) => item.id === id);
  return theme ? cloneTheme(theme) : null;
}

export function getTheme(settings: StartPageSettings, id = settings.themes.selectedThemeId): StartPageTheme {
  return getBuiltInTheme(id)
    ?? cloneTheme(settings.themes.customThemes.find((theme) => theme.id === id) ?? BUILT_IN_THEMES[0]!);
}

const DEFAULT_BLOCK_SPECS: Array<{
  id: string;
  type: BlockType;
  title: string;
  enabled: boolean;
  column: number;
  row: number;
  width: number;
  height: number;
}> = [
  { id: "dateTime-main", type: "dateTime", title: "Date & Time", enabled: true, column: 1, row: 1, width: 4, height: 2 },
  { id: "search-main", type: "search", title: "Search", enabled: true, column: 5, row: 1, width: 5, height: 2 },
  { id: "ip-main", type: "ip", title: "IP", enabled: true, column: 10, row: 1, width: 3, height: 2 },
  { id: "links-main", type: "links", title: "Links", enabled: true, column: 1, row: 3, width: 6, height: 4 },
  { id: "timer-main", type: "timer", title: "Timer", enabled: true, column: 7, row: 3, width: 2, height: 2 },
  { id: "stopwatch-main", type: "stopwatch", title: "Stopwatch", enabled: true, column: 9, row: 3, width: 2, height: 2 },
  { id: "pomodoro-main", type: "pomodoro", title: "Pomodoro", enabled: true, column: 11, row: 3, width: 2, height: 2 },
  { id: "note-main", type: "note", title: "Scratchpad", enabled: true, column: 7, row: 5, width: 3, height: 3 },
  { id: "localTasks-main", type: "localTasks", title: "Local Tasks", enabled: true, column: 10, row: 5, width: 3, height: 3 },
  { id: "startPinned-main", type: "startPinned", title: "Start Tab Pinned", enabled: true, column: 1, row: 7, width: 3, height: 2 },
  { id: "commands-main", type: "commands", title: "Commands", enabled: true, column: 4, row: 7, width: 3, height: 2 },
  { id: "recent-main", type: "recent", title: "Recent History", enabled: true, column: 7, row: 7, width: 3, height: 2 },
  { id: "stats-main", type: "stats", title: "Focus Stats", enabled: true, column: 10, row: 7, width: 3, height: 2 },
  { id: "browserPinned-main", type: "browserPinned", title: "Browser Pinned", enabled: false, column: 1, row: 9, width: 3, height: 2 },
  { id: "googleCalendar-main", type: "googleCalendar", title: "Google Calendar", enabled: false, column: 4, row: 9, width: 3, height: 2 },
  { id: "weather-main", type: "weather", title: "Weather", enabled: false, column: 7, row: 9, width: 3, height: 2 },
];

export const DEFAULT_LAYOUT_BLOCKS: BlockInstance[] = DEFAULT_BLOCK_SPECS.map((spec, order) => createBlockInstance(spec.type, {
  ...spec,
  order,
  createdAt: DEFAULT_CREATED_AT,
  updatedAt: DEFAULT_CREATED_AT,
}));

export const LAYOUT_PRESETS: readonly LayoutPreset[] = [
  { id: "work", titleKey: "layoutPresetWork", columns: 12, blocks: DEFAULT_BLOCK_SPECS.map(({ type, column, row, width, height, enabled }) => ({ type, column, row, width, height, enabled })) },
  { id: "minimal", titleKey: "layoutPresetMinimal", columns: 12, blocks: [
    { type: "dateTime", column: 1, row: 1, width: 4, height: 2 },
    { type: "search", column: 5, row: 1, width: 5, height: 2 },
    { type: "links", column: 1, row: 3, width: 6, height: 4 },
    { type: "commands", column: 7, row: 3, width: 3, height: 2 },
  ] },
  { id: "focus", titleKey: "layoutPresetFocus", columns: 12, blocks: [
    { type: "dateTime", column: 1, row: 1, width: 3, height: 2 },
    { type: "pomodoro", column: 4, row: 1, width: 3, height: 2 },
    { type: "timer", column: 7, row: 1, width: 2, height: 2 },
    { type: "stats", column: 10, row: 1, width: 3, height: 3 },
    { type: "note", column: 1, row: 3, width: 5, height: 4 },
    { type: "localTasks", column: 6, row: 3, width: 4, height: 4 },
  ] },
  { id: "dashboard", titleKey: "layoutPresetDashboard", columns: 12, blocks: [
    { type: "dateTime", column: 1, row: 1, width: 3, height: 2 },
    { type: "weather", column: 4, row: 1, width: 3, height: 2 },
    { type: "ip", column: 7, row: 1, width: 3, height: 2 },
    { type: "search", column: 1, row: 3, width: 5, height: 2 },
    { type: "links", column: 1, row: 5, width: 6, height: 4 },
    { type: "googleCalendar", column: 7, row: 3, width: 3, height: 3 },
    { type: "recent", column: 10, row: 3, width: 3, height: 3 },
    { type: "browserPinned", column: 7, row: 6, width: 3, height: 2 },
    { type: "startPinned", column: 10, row: 6, width: 3, height: 2 },
  ] },
  { id: "development", titleKey: "layoutPresetDevelopment", columns: 12, blocks: [
    { type: "search", column: 1, row: 1, width: 5, height: 2 },
    { type: "links", column: 1, row: 3, width: 5, height: 4 },
    { type: "note", column: 6, row: 1, width: 4, height: 4 },
    { type: "localTasks", column: 10, row: 1, width: 3, height: 4 },
    { type: "recent", column: 6, row: 5, width: 3, height: 2 },
    { type: "commands", column: 9, row: 5, width: 4, height: 2 },
  ] },
  { id: "rest", titleKey: "layoutPresetRest", columns: 12, blocks: [
    { type: "dateTime", column: 1, row: 1, width: 4, height: 2 },
    { type: "weather", column: 5, row: 1, width: 4, height: 2 },
    { type: "links", column: 1, row: 3, width: 5, height: 4 },
    { type: "startPinned", column: 6, row: 3, width: 3, height: 2 },
    { type: "timer", column: 9, row: 3, width: 2, height: 2 },
    { type: "commands", column: 6, row: 5, width: 5, height: 2 },
  ] },
];

export function blocksFromPreset(preset: LayoutPreset, zone: LayoutZone): BlockInstance[] {
  return preset.blocks.map((spec, order) => createBlockInstance(spec.type, {
    ...spec,
    enabled: spec.enabled ?? true,
    zone,
    order,
  }));
}

export const DEFAULT_SETTINGS: StartPageSettings = {
  schemaVersion: START_PAGE_SCHEMA_VERSION,
  updatedAt: DEFAULT_CREATED_AT,
  startTab: { enabled: true },
  settingsButton: { visibility: "hover", hoverArea: "top-right" },
  focusStats: {
    defaultMinutesPerAvoidedVisit: 10,
    avoidedVisitDedupeSeconds: 5 * 60,
    domainMinutes: {},
  },
  layout: {
    columns: 12,
    rowHeight: 72,
    gap: 14,
    profile: "work",
    mode: "grid",
    zone: "contained",
    showBlockTitles: true,
    containedMaxWidth: 1440,
    blocks: cloneBlocks(DEFAULT_LAYOUT_BLOCKS),
  },
  themes: {
    selectedThemeId: "start-tab-dark",
    customThemes: [],
  },
};
