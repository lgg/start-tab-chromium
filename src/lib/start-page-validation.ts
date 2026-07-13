import {
  BLOCK_INSTANCE_SCHEMA_VERSION,
  BLOCK_TYPES,
  START_PAGE_SCHEMA_VERSION,
  THEME_SCHEMA_VERSION,
  type AnimatedEffectConfig,
  type BackgroundTile,
  type BlockConfig,
  type BlockConfigFor,
  type BlockInstance,
  type BlockType,
  type LayoutMode,
  type LayoutZone,
  type MigrationIssue,
  type MigrationReport,
  type SearchProvider,
  type StartLink,
  type StartPageSettings,
  type StartPageTheme,
  type ThemeBundle,
  type ValidationIssue,
  type ValidationResult,
} from "./start-page-types.js";
import {
  BLOCK_DESCRIPTORS,
  BUILT_IN_THEMES,
  DEFAULT_LAYOUT_BLOCKS,
  DEFAULT_SEARCH_PROVIDERS,
  DEFAULT_SETTINGS,
  blockDescriptor,
  cloneBlocks,
  cloneSettings,
  cloneTheme,
  defaultBlockConfig,
  getBuiltInTheme,
  isSingletonBlockType,
} from "./start-page-defaults.js";

const LAYOUT_MODES: readonly LayoutMode[] = ["grid", "free"];
const LAYOUT_ZONES: readonly LayoutZone[] = ["contained", "full"];
const SETTINGS_VISIBILITY = ["always", "hover"] as const;
const SETTINGS_HOVER_AREAS = ["top", "top-right", "right"] as const;
const DATE_TIME_MODES = ["both", "date", "time"] as const;
const LINK_DIRECTIONS = ["horizontal", "vertical"] as const;
const WEATHER_MODES = ["current", "day", "week"] as const;
const EFFECT_IDS = ["animated-gradient", "aurora", "mesh", "spotlight", "noise", "matrix", "cyberpunk"] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && (BLOCK_TYPES as readonly string[]).includes(value);
}

function stringValue(value: unknown, fallback: string, maxLength = 500): string {
  if (typeof value !== "string") return fallback;
  return value.slice(0, maxLength);
}

function trimmedString(value: unknown, fallback: string, maxLength = 500): string {
  return stringValue(value, fallback, maxLength).trim();
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

function timestampValue(value: unknown, fallback = 0): number {
  return finiteInteger(value, fallback, 0, Number.MAX_SAFE_INTEGER);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

export function safeWebUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

export function safeWebUrlTemplate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.includes("{query}")) return null;
  return safeWebUrl(trimmed.split("{query}").join("start-tab-query")) ? trimmed : null;
}

function safeGradient(value: unknown, fallback: string): string {
  const candidate = trimmedString(value, fallback, 1000);
  return /^(linear-gradient|radial-gradient|conic-gradient)\(/i.test(candidate) ? candidate : fallback;
}

function safeCssToken(value: unknown, fallback: string, maxLength = 300): string {
  const candidate = trimmedString(value, fallback, maxLength);
  if (!candidate || /[<>]/.test(candidate)) return fallback;
  return candidate;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableItemId(prefix: string, index: number, seed: string): string {
  return `${prefix}-${index + 1}-${stableHash(seed)}`;
}

function normalizeStartLinks(value: unknown, fallback: readonly StartLink[], path: string, issues: ValidationIssue[]): StartLink[] {
  if (!Array.isArray(value)) return fallback.map((item) => ({ ...item }));
  const result: StartLink[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push({ path: `${path}[${index}]`, messageKey: "validationInvalidLink" });
      continue;
    }
    const url = safeWebUrl(stringValue(item.url, ""));
    const title = trimmedString(item.title, "", 100);
    if (!url || !title) {
      issues.push({ path: `${path}[${index}]`, messageKey: "validationInvalidLink" });
      continue;
    }
    const icon = trimmedString(item.icon, title.slice(0, 2).toUpperCase(), 20);
    result.push({
      id: trimmedString(item.id, stableItemId("link", index, `${title}|${url}`), 150),
      icon,
      title,
      url,
    });
  }
  return result;
}

function normalizeSearchProviders(value: unknown, fallback: readonly SearchProvider[], path: string, issues: ValidationIssue[]): SearchProvider[] {
  const source = Array.isArray(value) ? value : fallback;
  const result: SearchProvider[] = [];
  const seen = new Set<string>();
  for (const [index, item] of source.entries()) {
    if (!isRecord(item)) {
      issues.push({ path: `${path}[${index}]`, messageKey: "validationInvalidSearchProvider" });
      continue;
    }
    const id = trimmedString(item.id, stableItemId("provider", index, String(item.title ?? "provider")), 100);
    const title = trimmedString(item.title, id, 100);
    const urlTemplate = safeWebUrlTemplate(stringValue(item.urlTemplate, ""));
    if (!id || !title || !urlTemplate || seen.has(id)) {
      issues.push({ path: `${path}[${index}]`, messageKey: "validationInvalidSearchProvider" });
      continue;
    }
    seen.add(id);
    result.push({ id, title, urlTemplate });
  }
  return result.length > 0 ? result : fallback.map((provider) => ({ ...provider }));
}

function normalizeDomainMinutes(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (!isRecord(value)) return result;
  for (const [domain, minutes] of Object.entries(value)) {
    const normalizedDomain = domain.trim().toLowerCase();
    if (!normalizedDomain || typeof minutes !== "number" || !Number.isFinite(minutes)) continue;
    result[normalizedDomain] = Math.min(1440, Math.max(0, minutes));
  }
  return result;
}

function normalizeTimeZone(value: unknown, fallback: string, path: string, issues: ValidationIssue[]): string {
  const timeZone = trimmedString(value, fallback, 100);
  if (!timeZone) return "";
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(0);
    return timeZone;
  } catch {
    issues.push({ path, messageKey: "validationInvalidTimeZone" });
    return fallback;
  }
}

function legacyConfigSource(type: BlockType, root: Record<string, unknown>): Record<string, unknown> {
  const source = root[type];
  if (isRecord(source)) return source;
  switch (type) {
    case "timer":
    case "stopwatch":
    case "pomodoro":
      return isRecord(root.timers) ? root.timers : {};
    case "startPinned":
      return isRecord(root.startPinned) ? root.startPinned : {};
    default:
      return {};
  }
}

export function normalizeBlockConfig<T extends BlockType>(
  type: T,
  value: unknown,
  legacyRoot: Record<string, unknown> = {},
  path = "config",
  issues: ValidationIssue[] = [],
): BlockConfigFor<T> {
  const fallback = defaultBlockConfig(type);
  const legacy = legacyConfigSource(type, legacyRoot);
  const source = isRecord(value) ? value : legacy;
  let config: BlockConfig;

  switch (type) {
    case "dateTime":
      config = {
        type,
        mode: oneOf(source.mode, DATE_TIME_MODES, fallback.type === type ? fallback.mode : "both"),
        dateFormat: stringValue(source.dateFormat, fallback.type === type ? fallback.dateFormat : "dddd, DD MMMM YYYY", 100),
        timeFormat: stringValue(source.timeFormat, fallback.type === type ? fallback.timeFormat : "HH:mm", 100),
        timeZone: normalizeTimeZone(source.timeZone, fallback.type === type ? fallback.timeZone : "", `${path}.timeZone`, issues),
        locale: trimmedString(source.locale, fallback.type === type ? fallback.locale : "", 50),
        timeFontSize: finiteNumber(source.timeFontSize ?? source.fontSize, fallback.type === type ? fallback.timeFontSize : 48, 12, 160),
      };
      break;
    case "ip": {
      const endpointCandidate = stringValue(source.endpoint, fallback.type === type ? fallback.endpoint : "https://ipapi.co/json/");
      const endpoint = safeWebUrl(endpointCandidate);
      if (!endpoint) issues.push({ path: `${path}.endpoint`, messageKey: "validationInvalidUrl" });
      config = { type, endpoint: endpoint ?? (fallback.type === type ? fallback.endpoint : "https://ipapi.co/json/") };
      break;
    }
    case "links":
      config = {
        type,
        columns: finiteInteger(source.columns, fallback.type === type ? fallback.columns : 4, 1, 12),
        rows: finiteInteger(source.rows, fallback.type === type ? fallback.rows : 2, 1, 12),
        pageDirection: oneOf(source.pageDirection, LINK_DIRECTIONS, fallback.type === type ? fallback.pageDirection : "horizontal"),
        fontFamily: safeCssToken(source.fontFamily, fallback.type === type ? fallback.fontFamily : "inherit", 200),
        fontSize: finiteNumber(source.fontSize, fallback.type === type ? fallback.fontSize : 13, 8, 48),
        iconSize: finiteNumber(source.iconSize, fallback.type === type ? fallback.iconSize : 28, 12, 128),
        items: normalizeStartLinks(source.items, fallback.type === type ? fallback.items : [], `${path}.items`, issues),
      };
      break;
    case "search": {
      const providers = normalizeSearchProviders(source.providers, fallback.type === type ? fallback.providers : DEFAULT_SEARCH_PROVIDERS, `${path}.providers`, issues);
      const candidate = trimmedString(source.provider, fallback.type === type ? fallback.provider : providers[0]?.id ?? "google", 100);
      config = {
        type,
        provider: providers.some((provider) => provider.id === candidate) ? candidate : providers[0]?.id ?? "google",
        providers,
        placeholder: stringValue(source.placeholder, fallback.type === type ? fallback.placeholder : "", 160),
      };
      break;
    }
    case "timer":
      config = {
        type,
        durationSeconds: finiteInteger(source.durationSeconds ?? source.timerSeconds, fallback.type === type ? fallback.durationSeconds : 300, 1, 7 * 24 * 60 * 60),
        notifyOnComplete: booleanValue(source.notifyOnComplete, fallback.type === type ? fallback.notifyOnComplete : true),
      };
      break;
    case "stopwatch":
      config = { type };
      break;
    case "pomodoro":
      config = {
        type,
        workSeconds: finiteInteger(source.workSeconds ?? source.pomodoroWorkSeconds, fallback.type === type ? fallback.workSeconds : 1500, 60, 24 * 60 * 60),
        breakSeconds: finiteInteger(source.breakSeconds ?? source.pomodoroBreakSeconds, fallback.type === type ? fallback.breakSeconds : 300, 30, 12 * 60 * 60),
        notifyOnComplete: booleanValue(source.notifyOnComplete, fallback.type === type ? fallback.notifyOnComplete : true),
        autoStartNextPhase: booleanValue(source.autoStartNextPhase, fallback.type === type ? fallback.autoStartNextPhase : false),
      };
      break;
    case "note":
      config = {
        type,
        placeholder: stringValue(source.placeholder, fallback.type === type ? fallback.placeholder : "", 300),
        confirmDeleteWithContent: booleanValue(source.confirmDeleteWithContent, fallback.type === type ? fallback.confirmDeleteWithContent : true),
      };
      break;
    case "localTasks":
      config = {
        type,
        placeholder: stringValue(source.placeholder, fallback.type === type ? fallback.placeholder : "", 300),
        showCompleted: booleanValue(source.showCompleted, fallback.type === type ? fallback.showCompleted : true),
        confirmDeleteWithContent: booleanValue(source.confirmDeleteWithContent, fallback.type === type ? fallback.confirmDeleteWithContent : true),
      };
      break;
    case "googleCalendar":
      config = {
        type,
        calendarId: trimmedString(source.calendarId, fallback.type === type ? fallback.calendarId : "primary", 300) || "primary",
        accountLabel: stringValue(source.accountLabel, fallback.type === type ? fallback.accountLabel : "", 120),
        query: stringValue(source.query, fallback.type === type ? fallback.query : "", 300),
        maxResults: finiteInteger(source.maxResults, fallback.type === type ? fallback.maxResults : 6, 1, 25),
      };
      break;
    case "weather": {
      const forecastCandidate = stringValue(source.forecastEndpoint, fallback.type === type ? fallback.forecastEndpoint : "https://api.open-meteo.com/v1/forecast");
      const geocodingCandidate = stringValue(source.geocodingEndpoint, fallback.type === type ? fallback.geocodingEndpoint : "https://geocoding-api.open-meteo.com/v1/search");
      const forecastEndpoint = safeWebUrl(forecastCandidate);
      const geocodingEndpoint = safeWebUrl(geocodingCandidate);
      if (!forecastEndpoint) issues.push({ path: `${path}.forecastEndpoint`, messageKey: "validationInvalidUrl" });
      if (!geocodingEndpoint) issues.push({ path: `${path}.geocodingEndpoint`, messageKey: "validationInvalidUrl" });
      config = {
        type,
        provider: "open-meteo",
        city: stringValue(source.city, fallback.type === type ? fallback.city : "Amsterdam", 160),
        latitude: finiteNumber(source.latitude, fallback.type === type ? fallback.latitude : 52.3676, -90, 90),
        longitude: finiteNumber(source.longitude, fallback.type === type ? fallback.longitude : 4.9041, -180, 180),
        displayMode: oneOf(source.displayMode, WEATHER_MODES, fallback.type === type ? fallback.displayMode : "current"),
        forecastEndpoint: forecastEndpoint ?? (fallback.type === type ? fallback.forecastEndpoint : "https://api.open-meteo.com/v1/forecast"),
        geocodingEndpoint: geocodingEndpoint ?? (fallback.type === type ? fallback.geocodingEndpoint : "https://geocoding-api.open-meteo.com/v1/search"),
      };
      break;
    }
    case "commands":
      config = { type };
      break;
    case "recent":
      config = { type, maxResults: finiteInteger(source.maxResults, fallback.type === type ? fallback.maxResults : 10, 1, 50) };
      break;
    case "browserPinned":
      config = { type };
      break;
    case "startPinned":
      config = {
        type,
        columns: finiteInteger(source.columns, fallback.type === type ? fallback.columns : 3, 1, 12),
        rows: finiteInteger(source.rows, fallback.type === type ? fallback.rows : 2, 1, 12),
        pageDirection: oneOf(source.pageDirection, LINK_DIRECTIONS, fallback.type === type ? fallback.pageDirection : "horizontal"),
        fontFamily: safeCssToken(source.fontFamily, fallback.type === type ? fallback.fontFamily : "inherit", 200),
        fontSize: finiteNumber(source.fontSize, fallback.type === type ? fallback.fontSize : 13, 8, 48),
        iconSize: finiteNumber(source.iconSize, fallback.type === type ? fallback.iconSize : 28, 12, 128),
        items: normalizeStartLinks(source.items, fallback.type === type ? fallback.items : [], `${path}.items`, issues),
      };
      break;
    case "stats":
      config = { type };
      break;
  }
  return config as BlockConfigFor<T>;
}

function normalizeBlockId(value: unknown, type: BlockType, seen: Set<string>): string {
  const requested = trimmedString(value, type, 160).replace(/[^a-zA-Z0-9_.:-]/g, "-") || type;
  if (!seen.has(requested)) return requested;
  let suffix = 2;
  while (seen.has(`${requested}-${suffix}`)) suffix += 1;
  return `${requested}-${suffix}`;
}

function normalizeBlock(
  value: unknown,
  index: number,
  root: Record<string, unknown>,
  columns: number,
  zone: LayoutZone,
  seenIds: Set<string>,
  seenSingletons: Set<BlockType>,
  issues: ValidationIssue[],
  migrationIssues: MigrationIssue[],
): BlockInstance | null {
  if (!isRecord(value) || !isBlockType(value.type)) {
    migrationIssues.push({ path: `layout.blocks[${index}]`, reason: "Unknown or missing block type" });
    issues.push({ path: `layout.blocks[${index}]`, messageKey: "validationUnknownBlock" });
    return null;
  }
  const type = value.type;
  if (isSingletonBlockType(type) && seenSingletons.has(type)) {
    migrationIssues.push({ path: `layout.blocks[${index}]`, reason: `Duplicate singleton block: ${type}` });
    issues.push({ path: `layout.blocks[${index}]`, messageKey: "validationDuplicateSingleton" });
    return null;
  }
  const descriptor = blockDescriptor(type);
  const id = normalizeBlockId(value.id, type, seenIds);
  const width = finiteInteger(value.width, descriptor.defaultGridWidth, descriptor.minGridWidth, Math.max(descriptor.minGridWidth, columns));
  const height = finiteInteger(value.height, descriptor.defaultGridHeight, descriptor.minGridHeight, 80);
  const blockZone = oneOf(value.zone, LAYOUT_ZONES, zone);
  const freeValue = isRecord(value.free) ? value.free : {};
  const createdAt = timestampValue(value.createdAt, 0);
  const configValue = isRecord(value.config) && value.config.type === type ? value.config : legacyConfigSource(type, root);
  const block = {
    schemaVersion: BLOCK_INSTANCE_SCHEMA_VERSION,
    id,
    type,
    title: stringValue(value.title, descriptor.titleKey, 160),
    enabled: booleanValue(value.enabled, true),
    zone: blockZone,
    column: finiteInteger(value.column, 1, 1, Math.max(1, columns - width + 1)),
    row: finiteInteger(value.row, index + 1, 1, 500),
    width,
    height,
    order: finiteInteger(value.order, index, 0, 10_000),
    free: {
      x: finiteNumber(freeValue.x, Math.max(0, (finiteInteger(value.column, 1, 1, columns) - 1) * 92), 0, 100_000),
      y: finiteNumber(freeValue.y, Math.max(0, (finiteInteger(value.row, index + 1, 1, 500) - 1) * 76), 0, 100_000),
      width: finiteNumber(freeValue.width, Math.max(descriptor.minFreeWidth, width * 90), descriptor.minFreeWidth, 100_000),
      height: finiteNumber(freeValue.height, Math.max(descriptor.minFreeHeight, height * 72), descriptor.minFreeHeight, 100_000),
    },
    config: normalizeBlockConfig(type, configValue, root, `layout.blocks[${index}].config`, issues),
    createdAt,
    updatedAt: timestampValue(value.updatedAt, createdAt),
  } as BlockInstance;
  seenIds.add(id);
  if (isSingletonBlockType(type)) seenSingletons.add(type);
  return block;
}

function ensureSingletonAvailability(blocks: BlockInstance[], zone: LayoutZone): BlockInstance[] {
  const next = [...blocks];
  const existingTypes = new Set(next.map((block) => block.type));
  for (const fallback of DEFAULT_LAYOUT_BLOCKS) {
    if (!isSingletonBlockType(fallback.type) || existingTypes.has(fallback.type)) continue;
    next.push({ ...cloneBlocks([fallback])[0]!, enabled: false, zone, order: next.length });
  }
  return next;
}

function normalizeBlocks(
  value: unknown,
  root: Record<string, unknown>,
  columns: number,
  zone: LayoutZone,
  issues: ValidationIssue[],
  migrationIssues: MigrationIssue[],
): BlockInstance[] {
  const source = Array.isArray(value) && value.length > 0 ? value : cloneBlocks(DEFAULT_LAYOUT_BLOCKS);
  const seenIds = new Set<string>();
  const seenSingletons = new Set<BlockType>();
  const blocks = source.flatMap((candidate, index) => {
    const block = normalizeBlock(candidate, index, root, columns, zone, seenIds, seenSingletons, issues, migrationIssues);
    return block ? [block] : [];
  });
  const safeBlocks = blocks.length > 0 ? blocks : cloneBlocks(DEFAULT_LAYOUT_BLOCKS);
  return ensureSingletonAvailability(safeBlocks, zone)
    .map((block, order) => ({ ...block, order }))
    .sort((left, right) => left.order - right.order);
}

function normalizeEffectConfig(value: unknown, fallback: AnimatedEffectConfig): AnimatedEffectConfig {
  const source = isRecord(value) ? value : {};
  const effect = oneOf(source.effect, EFFECT_IDS, fallback.effect);
  switch (effect) {
    case "animated-gradient": {
      const fallbackColors = fallback.effect === effect ? fallback.colors : ["#111827", "#312e81", "#0f766e", "#111827"];
      const colors = Array.isArray(source.colors)
        ? source.colors.filter((item): item is string => typeof item === "string").slice(0, 8).map((item) => safeCssToken(item, "#111827", 64))
        : fallbackColors;
      return { effect, speed: finiteNumber(source.speed, fallback.effect === effect ? fallback.speed : 1, 0.05, 4), intensity: finiteNumber(source.intensity, fallback.effect === effect ? fallback.intensity : 0.8, 0, 1), angle: finiteNumber(source.angle, fallback.effect === effect ? fallback.angle : 135, 0, 360), colors: colors.length >= 2 ? colors : fallbackColors };
    }
    case "aurora":
      return { effect, speed: finiteNumber(source.speed, fallback.effect === effect ? fallback.speed : 1, 0.05, 4), intensity: finiteNumber(source.intensity, fallback.effect === effect ? fallback.intensity : 0.65, 0, 1), blur: finiteNumber(source.blur, fallback.effect === effect ? fallback.blur : 72, 0, 160) };
    case "mesh":
      return { effect, speed: finiteNumber(source.speed, fallback.effect === effect ? fallback.speed : 0.7, 0.05, 4), intensity: finiteNumber(source.intensity, fallback.effect === effect ? fallback.intensity : 0.75, 0, 1), scale: finiteNumber(source.scale, fallback.effect === effect ? fallback.scale : 1, 0.25, 4) };
    case "spotlight":
      return { effect, speed: finiteNumber(source.speed, fallback.effect === effect ? fallback.speed : 0.65, 0.05, 4), intensity: finiteNumber(source.intensity, fallback.effect === effect ? fallback.intensity : 0.72, 0, 1), size: finiteNumber(source.size, fallback.effect === effect ? fallback.size : 62, 10, 180) };
    case "noise":
      return { effect, intensity: finiteNumber(source.intensity, fallback.effect === effect ? fallback.intensity : 0.22, 0, 0.65), animated: booleanValue(source.animated, fallback.effect === effect ? fallback.animated : false), speed: finiteNumber(source.speed, fallback.effect === effect ? fallback.speed : 0.5, 0.05, 2) };
    case "matrix":
      return { effect, speed: finiteNumber(source.speed, fallback.effect === effect ? fallback.speed : 1, 0.05, 4), intensity: finiteNumber(source.intensity, fallback.effect === effect ? fallback.intensity : 0.7, 0, 1), density: finiteNumber(source.density, fallback.effect === effect ? fallback.density : 0.55, 0.1, 1) };
    case "cyberpunk":
      return { effect, speed: finiteNumber(source.speed, fallback.effect === effect ? fallback.speed : 1.1, 0.05, 4), intensity: finiteNumber(source.intensity, fallback.effect === effect ? fallback.intensity : 0.72, 0, 1), scanlines: booleanValue(source.scanlines, fallback.effect === effect ? fallback.scanlines : true) };
  }
}

function normalizeBackground(value: unknown, fallback: BackgroundTile, path: string, issues: ValidationIssue[]): BackgroundTile {
  if (!isRecord(value)) return structuredClone(fallback);
  const kind = oneOf(value.kind, ["solid", "gradient", "image", "effect"] as const, fallback.kind);
  switch (kind) {
    case "solid":
      return { kind, color: safeCssToken(value.color, fallback.kind === kind ? fallback.color : "#08111f", 100) };
    case "gradient":
      return { kind, css: safeGradient(value.css, fallback.kind === kind ? fallback.css : "linear-gradient(145deg, #08111f, #1e293b)") };
    case "image": {
      const url = safeWebUrl(stringValue(value.url, fallback.kind === kind ? fallback.url : ""));
      if (!url) issues.push({ path: `${path}.url`, messageKey: "validationInvalidUrl" });
      if (!url && fallback.kind !== kind) return structuredClone(fallback);
      return { kind, url: url ?? (fallback.kind === kind ? fallback.url : ""), fit: oneOf(value.fit, ["cover", "contain"] as const, fallback.kind === kind ? fallback.fit : "cover"), position: safeCssToken(value.position, fallback.kind === kind ? fallback.position : "center", 100) };
    }
    case "effect": {
      const fallbackConfig = fallback.kind === kind ? fallback.config : BUILT_IN_THEMES[0]!.background.kind === "effect" ? BUILT_IN_THEMES[0]!.background.config : { effect: "aurora", speed: 1, intensity: 0.65, blur: 72 };
      return { kind, baseColor: safeCssToken(value.baseColor, fallback.kind === kind ? fallback.baseColor : "#08111f", 100), config: normalizeEffectConfig(value.config, fallbackConfig) };
    }
  }
}

export function normalizeTheme(value: unknown, fallback: StartPageTheme, path = "theme", issues: ValidationIssue[] = []): StartPageTheme {
  if (!isRecord(value)) return cloneTheme(fallback);
  const tokens = isRecord(value.tokens) ? value.tokens : {};
  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    id: trimmedString(value.id, fallback.id, 160).replace(/[^a-zA-Z0-9_.:-]/g, "-") || fallback.id,
    name: trimmedString(value.name, fallback.name, 160) || fallback.name,
    builtIn: booleanValue(value.builtIn, fallback.builtIn),
    background: normalizeBackground(value.background, fallback.background, `${path}.background`, issues),
    tokens: {
      textPrimary: safeCssToken(tokens.textPrimary, fallback.tokens.textPrimary, 100),
      textSecondary: safeCssToken(tokens.textSecondary, fallback.tokens.textSecondary, 100),
      cardSurface: safeCssToken(tokens.cardSurface, fallback.tokens.cardSurface, 100),
      cardBorder: safeCssToken(tokens.cardBorder, fallback.tokens.cardBorder, 200),
      cardOpacity: finiteNumber(tokens.cardOpacity, fallback.tokens.cardOpacity, 0, 1),
      shadow: safeCssToken(tokens.shadow, fallback.tokens.shadow, 300),
      accent: safeCssToken(tokens.accent, fallback.tokens.accent, 100),
      hover: safeCssToken(tokens.hover, fallback.tokens.hover, 100),
      active: safeCssToken(tokens.active, fallback.tokens.active, 100),
      fontFamily: safeCssToken(tokens.fontFamily, fallback.tokens.fontFamily, 300),
      baseFontSize: finiteNumber(tokens.baseFontSize, fallback.tokens.baseFontSize, 10, 32),
      headingScale: finiteNumber(tokens.headingScale, fallback.tokens.headingScale, 0.8, 2),
      borderRadius: finiteNumber(tokens.borderRadius, fallback.tokens.borderRadius, 0, 48),
      spacing: finiteNumber(tokens.spacing, fallback.tokens.spacing, 4, 40),
    },
    createdAt: timestampValue(value.createdAt, fallback.createdAt),
    updatedAt: timestampValue(value.updatedAt, fallback.updatedAt),
  };
}

function legacyTheme(root: Record<string, unknown>, issues: ValidationIssue[]): StartPageTheme | null {
  if (!isRecord(root.appearance)) return null;
  const appearance = root.appearance;
  const fallback = cloneTheme(BUILT_IN_THEMES[0]!);
  fallback.id = "migrated-legacy-theme";
  fallback.name = "Migrated theme";
  fallback.builtIn = false;
  const backgroundColor = safeCssToken(appearance.backgroundColor, "#08111f", 100);
  const backgroundImage = safeWebUrl(stringValue(appearance.backgroundImage, ""));
  const effect = stringValue(appearance.backgroundEffect, "none");
  if (backgroundImage) {
    fallback.background = { kind: "image", url: backgroundImage, fit: "cover", position: "center" };
  } else if (["gradient", "aurora", "mesh", "spotlight", "noise"].includes(effect)) {
    const mapped = effect === "gradient" ? "animated-gradient" : effect;
    fallback.background = normalizeBackground({ kind: "effect", baseColor: backgroundColor, config: { effect: mapped } }, fallback.background, "appearance", issues);
  } else {
    fallback.background = { kind: "solid", color: backgroundColor };
  }
  fallback.tokens.textPrimary = safeCssToken(appearance.textColor, fallback.tokens.textPrimary, 100);
  fallback.tokens.fontFamily = safeCssToken(appearance.fontFamily, fallback.tokens.fontFamily, 300);
  fallback.tokens.baseFontSize = finiteNumber(appearance.baseFontSize, fallback.tokens.baseFontSize, 10, 32);
  return fallback;
}

function normalizeCustomThemes(value: unknown, issues: ValidationIssue[]): StartPageTheme[] {
  if (!Array.isArray(value)) return [];
  const result: StartPageTheme[] = [];
  const seen = new Set(BUILT_IN_THEMES.map((theme) => theme.id));
  for (const [index, item] of value.entries()) {
    const fallback = cloneTheme(BUILT_IN_THEMES[0]!);
    fallback.id = `custom-theme-${index + 1}`;
    fallback.name = `Custom theme ${index + 1}`;
    fallback.builtIn = false;
    const theme = normalizeTheme(item, fallback, `themes.customThemes[${index}]`, issues);
    theme.builtIn = false;
    let id = theme.id;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${theme.id}-${suffix}`;
      suffix += 1;
    }
    theme.id = id;
    seen.add(id);
    result.push(theme);
  }
  return result;
}

export function normalizeStartPageSettingsWithReport(value: unknown): { settings: StartPageSettings; report: MigrationReport; validation: ValidationIssue[] } {
  if (!isRecord(value)) {
    return {
      settings: cloneSettings(DEFAULT_SETTINGS),
      report: { fromVersion: 0, toVersion: START_PAGE_SCHEMA_VERSION, migratedBlocks: DEFAULT_SETTINGS.layout.blocks.length, skippedBlocks: 0, issues: [] },
      validation: [],
    };
  }
  const issues: ValidationIssue[] = [];
  const migrationIssues: MigrationIssue[] = [];
  const fromVersion = finiteInteger(value.schemaVersion, 1, 1, START_PAGE_SCHEMA_VERSION);
  const startTab = isRecord(value.startTab) ? value.startTab : {};
  const settingsButton = isRecord(value.settingsButton) ? value.settingsButton : {};
  const focusStats = isRecord(value.focusStats) ? value.focusStats : {};
  const layout = isRecord(value.layout) ? value.layout : {};
  const themes = isRecord(value.themes) ? value.themes : {};
  const columns = finiteInteger(layout.columns, DEFAULT_SETTINGS.layout.columns, 1, 80);
  const zone = oneOf(layout.zone, LAYOUT_ZONES, DEFAULT_SETTINGS.layout.zone);
  const blocks = normalizeBlocks(layout.blocks, value, columns, zone, issues, migrationIssues);
  const customThemes = normalizeCustomThemes(themes.customThemes, issues);
  const migratedLegacyTheme = fromVersion < START_PAGE_SCHEMA_VERSION ? legacyTheme(value, issues) : null;
  if (migratedLegacyTheme && !customThemes.some((theme) => theme.id === migratedLegacyTheme.id)) customThemes.push(migratedLegacyTheme);
  const requestedThemeId = trimmedString(themes.selectedThemeId, migratedLegacyTheme?.id ?? DEFAULT_SETTINGS.themes.selectedThemeId, 160);
  const selectedThemeId = getBuiltInTheme(requestedThemeId) || customThemes.some((theme) => theme.id === requestedThemeId)
    ? requestedThemeId
    : DEFAULT_SETTINGS.themes.selectedThemeId;

  const settings: StartPageSettings = {
    schemaVersion: START_PAGE_SCHEMA_VERSION,
    updatedAt: timestampValue(value.updatedAt, 0),
    startTab: { enabled: booleanValue(startTab.enabled, DEFAULT_SETTINGS.startTab.enabled) },
    settingsButton: {
      visibility: oneOf(settingsButton.visibility, SETTINGS_VISIBILITY, DEFAULT_SETTINGS.settingsButton.visibility),
      hoverArea: oneOf(settingsButton.hoverArea, SETTINGS_HOVER_AREAS, DEFAULT_SETTINGS.settingsButton.hoverArea),
    },
    focusStats: {
      defaultMinutesPerAvoidedVisit: finiteNumber(focusStats.defaultMinutesPerAvoidedVisit, DEFAULT_SETTINGS.focusStats.defaultMinutesPerAvoidedVisit, 0, 1440),
      avoidedVisitDedupeSeconds: finiteInteger(focusStats.avoidedVisitDedupeSeconds, DEFAULT_SETTINGS.focusStats.avoidedVisitDedupeSeconds, 1, 7 * 24 * 60 * 60),
      domainMinutes: normalizeDomainMinutes(focusStats.domainMinutes),
    },
    layout: {
      columns,
      rowHeight: finiteNumber(layout.rowHeight, DEFAULT_SETTINGS.layout.rowHeight, 40, 240),
      gap: finiteNumber(layout.gap, DEFAULT_SETTINGS.layout.gap, 0, 60),
      profile: trimmedString(layout.profile, DEFAULT_SETTINGS.layout.profile, 100) || "custom",
      mode: oneOf(layout.mode, LAYOUT_MODES, DEFAULT_SETTINGS.layout.mode),
      zone,
      showBlockTitles: booleanValue(layout.showBlockTitles, DEFAULT_SETTINGS.layout.showBlockTitles),
      containedMaxWidth: finiteNumber(layout.containedMaxWidth, DEFAULT_SETTINGS.layout.containedMaxWidth, 640, 3840),
      blocks,
    },
    themes: { selectedThemeId, customThemes },
  };

  return {
    settings,
    report: {
      fromVersion,
      toVersion: START_PAGE_SCHEMA_VERSION,
      migratedBlocks: blocks.length,
      skippedBlocks: migrationIssues.length,
      issues: migrationIssues,
    },
    validation: issues,
  };
}

export function normalizeStartPageSettings(value: unknown): StartPageSettings {
  return normalizeStartPageSettingsWithReport(value).settings;
}

export function validateStartPageSettings(value: unknown): ValidationResult<StartPageSettings> {
  const result = normalizeStartPageSettingsWithReport(value);
  return { value: result.settings, issues: result.validation };
}

export function normalizeThemeBundle(value: unknown): ValidationResult<ThemeBundle> {
  const issues: ValidationIssue[] = [];
  const fallbackTheme = cloneTheme(BUILT_IN_THEMES[0]!);
  fallbackTheme.id = "imported-theme";
  fallbackTheme.name = "Imported theme";
  fallbackTheme.builtIn = false;
  const source = isRecord(value) && value.app === "Start Tab Theme" && value.version === 1 ? value : null;
  if (!source) issues.push({ path: "theme", messageKey: "validationInvalidThemeFile" });
  const theme = normalizeTheme(source?.theme, fallbackTheme, "theme", issues);
  theme.builtIn = false;
  return {
    value: {
      app: "Start Tab Theme",
      version: 1,
      exportedAt: typeof source?.exportedAt === "string" ? source.exportedAt : new Date(0).toISOString(),
      theme,
    },
    issues,
  };
}

export function themeBundle(theme: StartPageTheme): ThemeBundle {
  return {
    app: "Start Tab Theme",
    version: 1,
    exportedAt: new Date().toISOString(),
    theme: { ...cloneTheme(theme), builtIn: false },
  };
}

export function hasBlockUserData(block: BlockInstance, runtime: { notes?: Record<string, string>; tasks?: Record<string, unknown[]> }): boolean {
  if (block.type === "links" || block.type === "startPinned") return block.config.items.length > 0;
  if (block.type === "note") return Boolean(runtime.notes?.[block.id]?.trim());
  if (block.type === "localTasks") return (runtime.tasks?.[block.id]?.length ?? 0) > 0;
  return BLOCK_DESCRIPTORS.find((descriptor) => descriptor.type === block.type)?.containsUserData === true;
}
