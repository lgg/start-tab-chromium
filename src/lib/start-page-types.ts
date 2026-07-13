export const START_PAGE_SCHEMA_VERSION = 4 as const;
export const BLOCK_INSTANCE_SCHEMA_VERSION = 1 as const;
export const RUNTIME_SCHEMA_VERSION = 2 as const;
export const THEME_SCHEMA_VERSION = 1 as const;

export type LayoutMode = "grid" | "free";
export type LayoutZone = "contained" | "full";
export type DateTimeMode = "both" | "date" | "time";
export type LinkPageDirection = "horizontal" | "vertical";
export type WeatherDisplayMode = "current" | "day" | "week";
export type WeatherProviderId = "open-meteo";
export type SearchProviderId = string;
export type SettingsButtonVisibility = "always" | "hover";
export type SettingsButtonHoverArea = "top" | "top-right" | "right";
export type LayoutPresetId = "work" | "minimal" | "focus" | "dashboard" | "development" | "rest";

export const BLOCK_TYPES = [
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
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export const SINGLETON_BLOCK_TYPES = ["commands", "recent", "browserPinned", "stats"] as const satisfies readonly BlockType[];
export type SingletonBlockType = (typeof SINGLETON_BLOCK_TYPES)[number];
export type RepeatableBlockType = Exclude<BlockType, SingletonBlockType>;

export interface FreeBlockRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StartLink {
  id: string;
  icon: string;
  title: string;
  url: string;
}

export interface SearchProvider {
  id: SearchProviderId;
  title: string;
  urlTemplate: string;
}

export interface DateTimeBlockConfig {
  type: "dateTime";
  mode: DateTimeMode;
  dateFormat: string;
  timeFormat: string;
  timeZone: string;
  locale: string;
  timeFontSize: number;
}

export interface IpBlockConfig {
  type: "ip";
  endpoint: string;
}

export interface LinksBlockConfig {
  type: "links";
  columns: number;
  rows: number;
  pageDirection: LinkPageDirection;
  fontFamily: string;
  fontSize: number;
  iconSize: number;
  items: StartLink[];
}

export interface SearchBlockConfig {
  type: "search";
  provider: SearchProviderId;
  providers: SearchProvider[];
  placeholder: string;
}

export interface TimerBlockConfig {
  type: "timer";
  durationSeconds: number;
  notifyOnComplete: boolean;
}

export interface StopwatchBlockConfig {
  type: "stopwatch";
}

export interface PomodoroBlockConfig {
  type: "pomodoro";
  workSeconds: number;
  breakSeconds: number;
  notifyOnComplete: boolean;
  autoStartNextPhase: boolean;
}

export interface NoteBlockConfig {
  type: "note";
  placeholder: string;
  confirmDeleteWithContent: boolean;
}

export interface LocalTasksBlockConfig {
  type: "localTasks";
  placeholder: string;
  showCompleted: boolean;
  confirmDeleteWithContent: boolean;
}

export interface GoogleCalendarBlockConfig {
  type: "googleCalendar";
  calendarId: string;
  accountLabel: string;
  query: string;
  maxResults: number;
}

export interface WeatherBlockConfig {
  type: "weather";
  provider: WeatherProviderId;
  city: string;
  latitude: number;
  longitude: number;
  displayMode: WeatherDisplayMode;
  forecastEndpoint: string;
  geocodingEndpoint: string;
}

export interface CommandsBlockConfig {
  type: "commands";
}

export interface RecentBlockConfig {
  type: "recent";
  maxResults: number;
}

export interface BrowserPinnedBlockConfig {
  type: "browserPinned";
}

export interface StartPinnedBlockConfig {
  type: "startPinned";
  columns: number;
  rows: number;
  pageDirection: LinkPageDirection;
  fontFamily: string;
  fontSize: number;
  iconSize: number;
  items: StartLink[];
}

export interface StatsBlockConfig {
  type: "stats";
}

export type BlockConfig =
  | DateTimeBlockConfig
  | IpBlockConfig
  | LinksBlockConfig
  | SearchBlockConfig
  | TimerBlockConfig
  | StopwatchBlockConfig
  | PomodoroBlockConfig
  | NoteBlockConfig
  | LocalTasksBlockConfig
  | GoogleCalendarBlockConfig
  | WeatherBlockConfig
  | CommandsBlockConfig
  | RecentBlockConfig
  | BrowserPinnedBlockConfig
  | StartPinnedBlockConfig
  | StatsBlockConfig;

export interface BlockInstanceBase<TType extends BlockType, TConfig extends BlockConfig> {
  schemaVersion: typeof BLOCK_INSTANCE_SCHEMA_VERSION;
  id: string;
  type: TType;
  title: string;
  enabled: boolean;
  zone: LayoutZone;
  column: number;
  row: number;
  width: number;
  height: number;
  order: number;
  free: FreeBlockRect;
  config: TConfig;
  createdAt: number;
  updatedAt: number;
}

export type BlockInstance =
  | BlockInstanceBase<"dateTime", DateTimeBlockConfig>
  | BlockInstanceBase<"ip", IpBlockConfig>
  | BlockInstanceBase<"links", LinksBlockConfig>
  | BlockInstanceBase<"search", SearchBlockConfig>
  | BlockInstanceBase<"timer", TimerBlockConfig>
  | BlockInstanceBase<"stopwatch", StopwatchBlockConfig>
  | BlockInstanceBase<"pomodoro", PomodoroBlockConfig>
  | BlockInstanceBase<"note", NoteBlockConfig>
  | BlockInstanceBase<"localTasks", LocalTasksBlockConfig>
  | BlockInstanceBase<"googleCalendar", GoogleCalendarBlockConfig>
  | BlockInstanceBase<"weather", WeatherBlockConfig>
  | BlockInstanceBase<"commands", CommandsBlockConfig>
  | BlockInstanceBase<"recent", RecentBlockConfig>
  | BlockInstanceBase<"browserPinned", BrowserPinnedBlockConfig>
  | BlockInstanceBase<"startPinned", StartPinnedBlockConfig>
  | BlockInstanceBase<"stats", StatsBlockConfig>;

export type BlockInstanceFor<T extends BlockType> = Extract<BlockInstance, { type: T }>;
export type BlockConfigFor<T extends BlockType> = Extract<BlockConfig, { type: T }>;

export interface BlockDescriptor {
  type: BlockType;
  titleKey: string;
  descriptionKey: string;
  repeatable: boolean;
  minGridWidth: number;
  minGridHeight: number;
  defaultGridWidth: number;
  defaultGridHeight: number;
  minFreeWidth: number;
  minFreeHeight: number;
  containsUserData: boolean;
}

export type AnimatedEffectId = "animated-gradient" | "aurora" | "mesh" | "spotlight" | "noise" | "matrix" | "cyberpunk";

export interface AnimatedGradientEffect {
  effect: "animated-gradient";
  speed: number;
  intensity: number;
  angle: number;
  colors: string[];
}

export interface AuroraEffect {
  effect: "aurora";
  speed: number;
  intensity: number;
  blur: number;
}

export interface MeshEffect {
  effect: "mesh";
  speed: number;
  intensity: number;
  scale: number;
}

export interface SpotlightEffect {
  effect: "spotlight";
  speed: number;
  intensity: number;
  size: number;
}

export interface NoiseEffect {
  effect: "noise";
  intensity: number;
  animated: boolean;
  speed: number;
}

export interface MatrixEffect {
  effect: "matrix";
  speed: number;
  intensity: number;
  density: number;
}

export interface CyberpunkEffect {
  effect: "cyberpunk";
  speed: number;
  intensity: number;
  scanlines: boolean;
}

export type AnimatedEffectConfig =
  | AnimatedGradientEffect
  | AuroraEffect
  | MeshEffect
  | SpotlightEffect
  | NoiseEffect
  | MatrixEffect
  | CyberpunkEffect;

export type BackgroundTile =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; css: string }
  | { kind: "image"; url: string; fit: "cover" | "contain"; position: string }
  | { kind: "effect"; baseColor: string; config: AnimatedEffectConfig };

export interface ThemeTokens {
  textPrimary: string;
  textSecondary: string;
  cardSurface: string;
  cardBorder: string;
  cardOpacity: number;
  shadow: string;
  accent: string;
  hover: string;
  active: string;
  fontFamily: string;
  baseFontSize: number;
  headingScale: number;
  borderRadius: number;
  spacing: number;
}

export interface StartPageTheme {
  schemaVersion: typeof THEME_SCHEMA_VERSION;
  id: string;
  name: string;
  builtIn: boolean;
  background: BackgroundTile;
  tokens: ThemeTokens;
  createdAt: number;
  updatedAt: number;
}

export interface ThemeBundle {
  app: "Start Tab Theme";
  version: 1;
  exportedAt: string;
  theme: StartPageTheme;
}

export interface LayoutSettings {
  columns: number;
  rowHeight: number;
  gap: number;
  profile: string;
  mode: LayoutMode;
  zone: LayoutZone;
  showBlockTitles: boolean;
  containedMaxWidth: number;
  blocks: BlockInstance[];
}

export interface StartPageSettings {
  schemaVersion: typeof START_PAGE_SCHEMA_VERSION;
  updatedAt: number;
  startTab: {
    enabled: boolean;
  };
  settingsButton: {
    visibility: SettingsButtonVisibility;
    hoverArea: SettingsButtonHoverArea;
  };
  focusStats: {
    defaultMinutesPerAvoidedVisit: number;
    avoidedVisitDedupeSeconds: number;
    domainMinutes: Record<string, number>;
  };
  layout: LayoutSettings;
  themes: {
    selectedThemeId: string;
    customThemes: StartPageTheme[];
  };
}

export type ClockBlockType = "timer" | "stopwatch" | "pomodoro";
export type PomodoroPhase = "work" | "break";

export interface ClockRuntimeState {
  type: ClockBlockType;
  running: boolean;
  startedAt: number | null;
  accumulatedMs: number;
  durationMs: number;
  targetAt: number | null;
  phase: PomodoroPhase | null;
  focusSessionStartedAt: number | null;
  completionToken: string | null;
  lastCompletedToken: string | null;
}

export interface LocalTask {
  id: string;
  title: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface StartPageRuntimeState {
  version: typeof RUNTIME_SCHEMA_VERSION;
  updatedAt: number;
  clocks: Record<string, ClockRuntimeState>;
  notes: Record<string, string>;
  tasks: Record<string, LocalTask[]>;
  linkPages: Record<string, number>;
}

export interface LayoutPreset {
  id: LayoutPresetId;
  titleKey: string;
  columns: number;
  blocks: Array<{
    type: BlockType;
    column: number;
    row: number;
    width: number;
    height: number;
    enabled?: boolean;
  }>;
}

export interface MigrationIssue {
  path: string;
  reason: string;
}

export interface MigrationReport {
  fromVersion: number;
  toVersion: number;
  migratedBlocks: number;
  skippedBlocks: number;
  issues: MigrationIssue[];
}

export interface ValidationIssue {
  path: string;
  messageKey: string;
  replacements?: Record<string, string | number>;
}

export interface ValidationResult<T> {
  value: T;
  issues: ValidationIssue[];
}
