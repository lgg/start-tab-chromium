import { commitStorageMutationWithRevision } from "./data-revision.js";
import { ownValue } from "./dictionary.js";
import { jsonContentEqual } from "./json-content.js";
import { withStorageLock } from "./storage-lock.js";
import { MAX_CUSTOM_THEMES, MAX_START_PAGE_BLOCKS } from "./platform-limits.js";
import {
  BLOCK_DESCRIPTORS,
  BUILT_IN_THEMES,
  DEFAULT_LAYOUT_BLOCKS,
  DEFAULT_SEARCH_PROVIDERS,
  DEFAULT_SETTINGS,
  LAYOUT_PRESETS,
  blockDescriptor,
  blockTitleKey,
  blockUsesDefaultTitle,
  blocksFromPreset,
  cloneBlock,
  cloneBlocks,
  cloneSettings,
  cloneTheme,
  createBlockId,
  createBlockInstance,
  createThemeId,
  defaultBlockConfig,
  getBuiltInTheme,
  getTheme,
  isSingletonBlockType,
} from "./start-page-defaults.js";
import {
  hasBlockUserData,
  isBlockType,
  isFutureStartPageSchema,
  isRecord,
  normalizeBlockConfig,
  normalizeStartPageSettings,
  normalizeStartPageSettingsWithReport,
  normalizeTheme,
  normalizeThemeBundle,
  safeWebUrl,
  safeWebUrlTemplate,
  themeBundle,
  validateStartPageSettings,
} from "./start-page-validation.js";
import {
  START_PAGE_SCHEMA_VERSION,
  type AnimatedEffectId,
  type BlockConfig,
  type BlockInstance,
  type BlockInstanceFor,
  type BlockType,
  type ClockRuntimeState,
  type DateTimeMode,
  type LayoutMode,
  type LayoutPreset,
  type LayoutPresetId,
  type LayoutZone,
  type LinkPageDirection,
  type LocalTask,
  type MigrationReport,
  type SearchProvider,
  type SearchProviderId,
  type SettingsButtonVisibility,
  type StartLink,
  type StartPageRuntimeState,
  type StartPageSettings,
  type StartPageTheme,
  type ThemeBundle,
  type ValidationIssue,
  type ValidationResult,
  type WeatherDisplayMode,
} from "./start-page-types.js";

export const START_PAGE_SETTINGS_KEY = "startPageSettings";
export const START_PAGE_MIGRATION_REPORT_KEY = "startPageMigrationReport";

export type LayoutBlock = BlockInstance;
export type BackgroundEffect = AnimatedEffectId | "none" | "gradient";

export {
  BLOCK_DESCRIPTORS,
  BUILT_IN_THEMES,
  DEFAULT_LAYOUT_BLOCKS,
  DEFAULT_SEARCH_PROVIDERS,
  DEFAULT_SETTINGS,
  LAYOUT_PRESETS,
  START_PAGE_SCHEMA_VERSION,
  blockDescriptor,
  blockTitleKey,
  blockUsesDefaultTitle,
  blocksFromPreset,
  cloneBlock,
  cloneBlocks as cloneLayoutBlocks,
  cloneSettings,
  cloneTheme,
  createBlockId,
  createBlockInstance,
  createThemeId,
  defaultBlockConfig,
  getBuiltInTheme,
  getTheme,
  hasBlockUserData,
  isBlockType,
  isFutureStartPageSchema,
  isRecord,
  isSingletonBlockType,
  normalizeBlockConfig,
  normalizeStartPageSettings,
  normalizeStartPageSettingsWithReport,
  normalizeTheme,
  normalizeThemeBundle,
  safeWebUrl,
  safeWebUrlTemplate,
  themeBundle,
  validateStartPageSettings,
};

export type {
  AnimatedEffectId,
  BlockConfig,
  BlockInstance,
  BlockInstanceFor,
  BlockType,
  ClockRuntimeState,
  DateTimeMode,
  LayoutMode,
  LayoutPreset,
  LayoutPresetId,
  LayoutZone,
  LinkPageDirection,
  LocalTask,
  MigrationReport,
  SearchProvider,
  SearchProviderId,
  SettingsButtonVisibility,
  StartLink,
  StartPageRuntimeState,
  StartPageSettings,
  StartPageTheme,
  ThemeBundle,
  ValidationIssue,
  ValidationResult,
  WeatherDisplayMode,
};

function blockContentEqual(left: BlockInstance, right: BlockInstance): boolean {
  return jsonContentEqual(
    { ...left, createdAt: 0, updatedAt: 0 },
    { ...right, createdAt: 0, updatedAt: 0 },
  );
}

function withBlockTimestamps(previous: StartPageSettings | null, next: StartPageSettings, now: number): StartPageSettings {
  const previousById = new Map(previous?.layout.blocks.map((block) => [block.id, block]) ?? []);
  return {
    ...next,
    updatedAt: now,
    layout: {
      ...next.layout,
      blocks: next.layout.blocks.map((block) => {
        const prior = previousById.get(block.id);
        const createdAt = prior?.createdAt || block.createdAt || now;
        const updatedAt = prior && blockContentEqual(prior, block) ? prior.updatedAt : now;
        return { ...block, createdAt, updatedAt };
      }),
    },
  };
}

async function readRawSettings(): Promise<unknown> {
  const items = await chrome.storage.local.get(START_PAGE_SETTINGS_KEY);
  return items[START_PAGE_SETTINGS_KEY];
}

async function persistSettingsInTransaction(
  settings: StartPageSettings,
  report?: MigrationReport,
  clearMigrationReport = false,
): Promise<void> {
  await commitStorageMutationWithRevision(
    [START_PAGE_SETTINGS_KEY, START_PAGE_MIGRATION_REPORT_KEY],
    async () => {
      const payload: Record<string, unknown> = { [START_PAGE_SETTINGS_KEY]: settings };
      if (report) payload[START_PAGE_MIGRATION_REPORT_KEY] = report;
      await chrome.storage.local.set(payload);
      if (clearMigrationReport) await chrome.storage.local.remove(START_PAGE_MIGRATION_REPORT_KEY);
    },
    settings.updatedAt || Date.now(),
  );
}

export function createDefaultStartPageSettings(now = Date.now()): StartPageSettings {
  return withBlockTimestamps(null, cloneSettings(DEFAULT_SETTINGS), now);
}

/** Read a normalized view without performing migration writes. */
export async function readStartPageSettingsSnapshot(): Promise<StartPageSettings> {
  return normalizeStartPageSettings(await readRawSettings());
}

export async function getStartPageSettings(): Promise<StartPageSettings> {
  const raw = await readRawSettings();
  const initial = normalizeStartPageSettingsWithReport(raw);
  if (isFutureStartPageSchema(raw)) return initial.settings;
  if (jsonContentEqual(raw, initial.settings)) return initial.settings;

  return withStorageLock("data-write", async () => {
    const currentRaw = await readRawSettings();
    const { settings, report } = normalizeStartPageSettingsWithReport(currentRaw);
    if (isFutureStartPageSchema(currentRaw)) return settings;
    if (jsonContentEqual(currentRaw, settings)) return settings;
    const stamped = withBlockTimestamps(null, settings, Date.now());
    await persistSettingsInTransaction(stamped, report);
    return stamped;
  });
}

export async function getStartPageMigrationReport(): Promise<MigrationReport | null> {
  const items = await chrome.storage.local.get(START_PAGE_MIGRATION_REPORT_KEY);
  const value = items[START_PAGE_MIGRATION_REPORT_KEY];
  if (!isRecord(value) || typeof value.fromVersion !== "number" || typeof value.toVersion !== "number") return null;
  const issues = Array.isArray(value.issues)
    ? value.issues.flatMap((issue) => isRecord(issue) && typeof issue.path === "string" && typeof issue.reason === "string"
      ? [{ path: issue.path, reason: issue.reason }]
      : [])
    : [];
  return {
    fromVersion: value.fromVersion,
    toVersion: value.toVersion,
    migratedBlocks: typeof value.migratedBlocks === "number" ? value.migratedBlocks : 0,
    skippedBlocks: typeof value.skippedBlocks === "number" ? value.skippedBlocks : 0,
    issues,
  };
}

function assertStartPageSettingsCapacity(value: unknown): void {
  if (!isRecord(value)) return;
  const layout = isRecord(value.layout) ? value.layout : {};
  const themes = isRecord(value.themes) ? value.themes : {};
  if (Array.isArray(layout.blocks) && layout.blocks.length > MAX_START_PAGE_BLOCKS) {
    throw new Error(`Start Tab supports at most ${MAX_START_PAGE_BLOCKS} block instances`);
  }
  if (Array.isArray(themes.customThemes) && themes.customThemes.length > MAX_CUSTOM_THEMES) {
    throw new Error(`Start Tab supports at most ${MAX_CUSTOM_THEMES} custom themes`);
  }
}

export function prepareStartPageSettingsWrite(
  value: unknown,
  raw: unknown,
  expectedUpdatedAt: number,
): { settings: StartPageSettings; issues: ValidationIssue[] } {
  if (isFutureStartPageSchema(raw)) {
    throw new Error("Start Tab settings were created by a newer extension version and cannot be modified safely");
  }
  const previous = normalizeStartPageSettings(raw);
  if (previous.updatedAt > 0 && expectedUpdatedAt !== previous.updatedAt) {
    throw new Error("Start Tab settings changed in another extension context; reload before saving");
  }
  assertStartPageSettingsCapacity(value);
  const validation = validateStartPageSettings(value);
  const stamped = withBlockTimestamps(previous, validation.value, Math.max(Date.now(), previous.updatedAt + 1));
  return { settings: stamped, issues: validation.issues };
}

async function validateAndPersistSettingsInTransaction(
  value: StartPageSettings,
  raw: unknown,
): Promise<{ settings: StartPageSettings; issues: ValidationIssue[] }> {
  const previous = normalizeStartPageSettings(raw);
  if (previous.updatedAt > 0 && value.updatedAt !== previous.updatedAt) {
    throw new Error("Start Tab settings changed in another extension context; reload before saving");
  }
  const prepared = prepareStartPageSettingsWrite(value, raw, value.updatedAt);
  await persistSettingsInTransaction(prepared.settings);
  return prepared;
}

export async function setStartPageSettings(value: StartPageSettings): Promise<ValidationIssue[]> {
  return withStorageLock("data-write", async () => {
    const raw = await readRawSettings();
    return (await validateAndPersistSettingsInTransaction(value, raw)).issues;
  });
}

export async function updateStartPageSettings(
  updater: (current: StartPageSettings) => StartPageSettings,
): Promise<{ settings: StartPageSettings; issues: ValidationIssue[] }> {
  return withStorageLock("data-write", async () => {
    const raw = await readRawSettings();
    if (isFutureStartPageSchema(raw)) {
      throw new Error("Start Tab settings were created by a newer extension version and cannot be modified safely");
    }
    const current = normalizeStartPageSettings(raw);
    return validateAndPersistSettingsInTransaction(updater(cloneSettings(current)), raw);
  });
}

export function canAddBlock(settings: StartPageSettings, type: BlockType): boolean {
  if (settings.layout.blocks.length >= MAX_START_PAGE_BLOCKS) return false;
  return !isSingletonBlockType(type) || !settings.layout.blocks.some((block) => block.type === type);
}

function nextGridPosition(settings: StartPageSettings): { column: number; row: number } {
  return {
    column: 1,
    row: Math.max(1, settings.layout.blocks.reduce((maximum, block) => Math.max(maximum, block.row + block.height), 1) + 1),
  };
}

export function createBlockInstanceDraft<T extends BlockType>(
  current: StartPageSettings,
  type: T,
): BlockInstanceFor<T> {
  if (current.layout.blocks.length >= MAX_START_PAGE_BLOCKS) {
    throw new Error(`Start Tab supports at most ${MAX_START_PAGE_BLOCKS} block instances`);
  }
  if (!canAddBlock(current, type)) throw new Error(`Singleton block already exists: ${type}`);
  return createBlockInstance(type, {
    ...nextGridPosition(current),
    zone: current.layout.zone,
    order: current.layout.blocks.length,
  });
}

export async function saveNewBlockInstance<T extends BlockType>(
  block: BlockInstanceFor<T>,
): Promise<BlockInstanceFor<T>> {
  const result = await updateStartPageSettings((current) => {
    if (current.layout.blocks.length >= MAX_START_PAGE_BLOCKS) {
      throw new Error(`Start Tab supports at most ${MAX_START_PAGE_BLOCKS} block instances`);
    }
    if (!canAddBlock(current, block.type)) throw new Error(`Singleton block already exists: ${block.type}`);
    if (current.layout.blocks.some((candidate) => candidate.id === block.id)) {
      throw new Error(`Block instance ID already exists: ${block.id}`);
    }
    const candidate = {
      ...block,
      ...nextGridPosition(current),
      zone: current.layout.zone,
      order: current.layout.blocks.length,
    } as BlockInstanceFor<T>;
    return {
      ...current,
      layout: { ...current.layout, profile: "custom", blocks: [...current.layout.blocks, candidate] },
    };
  });
  const saved = result.settings.layout.blocks.find((item) => item.id === block.id);
  if (!saved || saved.type !== block.type) throw new Error(`Block instance disappeared after save: ${block.id}`);
  return saved as BlockInstanceFor<T>;
}

export async function addBlockInstance<T extends BlockType>(type: T): Promise<BlockInstanceFor<T>> {
  const block = createBlockInstanceDraft(await getStartPageSettings(), type);
  return saveNewBlockInstance(block);
}

export async function updateBlockInstance(
  id: string,
  updater: (block: BlockInstance) => BlockInstance,
): Promise<BlockInstance> {
  const result = await updateStartPageSettings((current) => {
    const existing = current.layout.blocks.find((block) => block.id === id);
    if (!existing) throw new Error(`Block instance not found: ${id}`);
    const candidate = updater(cloneBlock(existing));
    if (candidate.id !== id || candidate.type !== existing.type) throw new Error("Block identity and type cannot be changed");
    return {
      ...current,
      layout: {
        ...current.layout,
        profile: "custom",
        blocks: current.layout.blocks.map((block) => block.id === id ? candidate : block),
      },
    };
  });
  const saved = result.settings.layout.blocks.find((block) => block.id === id);
  if (!saved) throw new Error(`Block instance disappeared after save: ${id}`);
  return saved;
}

export async function setBlockEnabled(id: string, enabled: boolean): Promise<BlockInstance> {
  return updateBlockInstance(id, (block) => ({ ...block, enabled }));
}

export async function duplicateBlockInstance(id: string, title?: string): Promise<BlockInstance> {
  let duplicateId = "";
  const result = await updateStartPageSettings((current) => {
    const source = current.layout.blocks.find((block) => block.id === id);
    if (!source) throw new Error(`Block instance not found: ${id}`);
    if (isSingletonBlockType(source.type)) throw new Error(`Singleton block cannot be duplicated: ${source.type}`);
    if (current.layout.blocks.length >= MAX_START_PAGE_BLOCKS) {
      throw new Error(`Start Tab supports at most ${MAX_START_PAGE_BLOCKS} block instances`);
    }
    const now = Date.now();
    const duplicate: BlockInstance = {
      ...cloneBlock(source),
      id: createBlockId(source.type),
      title: title?.trim() || source.title,
      column: Math.min(current.layout.columns, source.column + 1),
      row: source.row + 1,
      order: current.layout.blocks.length,
      free: { ...source.free, x: source.free.x + 24, y: source.free.y + 24 },
      createdAt: now,
      updatedAt: now,
    };
    duplicateId = duplicate.id;
    return {
      ...current,
      layout: { ...current.layout, profile: "custom", blocks: [...current.layout.blocks, duplicate] },
    };
  });
  const duplicate = result.settings.layout.blocks.find((block) => block.id === duplicateId);
  if (!duplicate) throw new Error(`Duplicated block disappeared after save: ${duplicateId}`);
  return duplicate;
}

export function layoutReplacementRemovesUserData(
  current: StartPageSettings,
  next: StartPageSettings,
  runtime: StartPageRuntimeState,
): boolean {
  const retainedIds = new Set(next.layout.blocks.map((block) => block.id));
  return current.layout.blocks.filter((block) => !retainedIds.has(block.id)).some((block) => {
    if (block.type === "note" && Boolean(ownValue(runtime.notes, block.id)?.trim())) return true;
    if (block.type === "localTasks" && (ownValue(runtime.tasks, block.id)?.length ?? 0) > 0) return true;
    if (block.type === "timer" || block.type === "stopwatch" || block.type === "pomodoro") {
      const clock = ownValue(runtime.clocks, block.id);
      if (clock && (clock.running || clock.accumulatedMs > 0)) return true;
    }
    const defaultBlock = DEFAULT_LAYOUT_BLOCKS.find((candidate) => candidate.type === block.type);
    return !defaultBlock
      || block.title !== defaultBlock.title
      || !jsonContentEqual(block.config, defaultBlock.config);
  });
}

export function settingsWithRemovedBlock(current: StartPageSettings, id: string): StartPageSettings {
  if (!current.layout.blocks.some((block) => block.id === id)) throw new Error(`Block instance not found: ${id}`);
  const next = cloneSettings(current);
  next.layout.profile = "custom";
  next.layout.blocks = next.layout.blocks
    .filter((block) => block.id !== id)
    .map((block, order) => ({ ...block, order }));
  return next;
}

/**
 * Apply preset geometry while reusing the first existing instance of each type.
 * Stable IDs preserve per-instance settings/runtime whenever a preset keeps that type.
 */
export function settingsWithLayoutPreset(current: StartPageSettings, presetId: LayoutPresetId): StartPageSettings {
  const preset = LAYOUT_PRESETS.find((item) => item.id === presetId);
  if (!preset) throw new Error(`Unknown layout preset: ${presetId}`);
  const available = current.layout.blocks.map(cloneBlock);
  const blocks = preset.blocks.map((spec, order): BlockInstance => {
    const existingIndex = available.findIndex((block) => block.type === spec.type);
    if (existingIndex < 0) {
      return createBlockInstance(spec.type, {
        ...spec,
        enabled: spec.enabled ?? true,
        zone: current.layout.zone,
        order,
      });
    }
    const [existing] = available.splice(existingIndex, 1);
    if (!existing) throw new Error(`Failed to reuse preset block: ${spec.type}`);
    return {
      ...existing,
      column: spec.column,
      row: spec.row,
      width: spec.width,
      height: spec.height,
      enabled: spec.enabled ?? true,
      zone: current.layout.zone,
      order,
    };
  });
  const next = cloneSettings(current);
  next.layout.mode = "grid";
  next.layout.columns = preset.columns;
  next.layout.profile = preset.id;
  next.layout.blocks = blocks;
  return next;
}

export function layoutMatchesPreset(settings: StartPageSettings, presetId: LayoutPresetId): boolean {
  const preset = LAYOUT_PRESETS.find((item) => item.id === presetId);
  if (!preset || settings.layout.mode !== "grid" || settings.layout.columns !== preset.columns) return false;
  if (settings.layout.blocks.length !== preset.blocks.length) return false;
  return preset.blocks.every((spec, order) => {
    const block = settings.layout.blocks[order];
    if (!block) return false;
    return block.type === spec.type
      && block.column === spec.column
      && block.row === spec.row
      && block.width === spec.width
      && block.height === spec.height
      && block.enabled === (spec.enabled ?? true);
  });
}

export async function setLayoutMode(mode: LayoutMode): Promise<StartPageSettings> {
  return (await updateStartPageSettings((current) => ({
    ...current,
    layout: { ...current.layout, mode, profile: "custom" },
  }))).settings;
}

export async function setLayoutZone(zone: LayoutZone): Promise<StartPageSettings> {
  return (await updateStartPageSettings((current) => ({
    ...current,
    layout: {
      ...current.layout,
      zone,
      profile: "custom",
      blocks: current.layout.blocks.map((block) => ({ ...block, zone })),
    },
  }))).settings;
}

export function createCustomThemeDraft(
  settings: StartPageSettings,
  name: string,
  sourceThemeId = settings.themes.selectedThemeId,
): StartPageTheme {
  const source = getTheme(settings, sourceThemeId);
  const now = Date.now();
  return {
    ...cloneTheme(source),
    id: createThemeId(),
    name: name.trim() || source.name,
    builtIn: false,
    createdAt: now,
    updatedAt: now,
  };
}

export async function saveNewCustomTheme(theme: StartPageTheme): Promise<StartPageTheme> {
  let savedId = "";
  const result = await updateStartPageSettings((current) => {
    const now = Date.now();
    const fallback = cloneTheme(getTheme(current));
    fallback.id = theme.id;
    fallback.builtIn = false;
    const normalized = normalizeTheme({ ...theme, builtIn: false, updatedAt: now }, fallback);
    normalized.id = getBuiltInTheme(normalized.id) || current.themes.customThemes.some((item) => item.id === normalized.id)
      ? createThemeId()
      : normalized.id;
    normalized.builtIn = false;
    normalized.createdAt = now;
    normalized.updatedAt = now;
    savedId = normalized.id;
    return {
      ...current,
      themes: { selectedThemeId: normalized.id, customThemes: [...current.themes.customThemes, normalized] },
    };
  });
  const saved = result.settings.themes.customThemes.find((theme) => theme.id === savedId);
  if (!saved) throw new Error(`Custom theme disappeared after save: ${savedId}`);
  return saved;
}

export async function createCustomTheme(name: string, sourceThemeId?: string): Promise<StartPageTheme> {
  const current = await getStartPageSettings();
  return createCustomThemeDraft(current, name, sourceThemeId);
}

export async function updateCustomTheme(theme: StartPageTheme): Promise<StartPageTheme> {
  let savedId = theme.id;
  const result = await updateStartPageSettings((current) => {
    if (getBuiltInTheme(theme.id)) throw new Error("Built-in themes cannot be edited");
    const existing = current.themes.customThemes.find((item) => item.id === theme.id);
    if (!existing) {
      const now = Date.now();
      const fallback = cloneTheme(getTheme(current));
      fallback.id = theme.id;
      fallback.builtIn = false;
      const normalized = normalizeTheme({ ...theme, builtIn: false, updatedAt: now }, fallback);
      normalized.id = current.themes.customThemes.some((item) => item.id === normalized.id) ? createThemeId() : normalized.id;
      normalized.builtIn = false;
      normalized.createdAt = now;
      normalized.updatedAt = now;
      savedId = normalized.id;
      return {
        ...current,
        themes: { selectedThemeId: normalized.id, customThemes: [...current.themes.customThemes, normalized] },
      };
    }
    const normalized = normalizeTheme({
      ...theme,
      builtIn: false,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    }, existing);
    normalized.builtIn = false;
    return {
      ...current,
      themes: {
        ...current.themes,
        customThemes: current.themes.customThemes.map((item) => item.id === theme.id ? normalized : item),
      },
    };
  });
  const saved = result.settings.themes.customThemes.find((item) => item.id === savedId);
  if (!saved) throw new Error(`Custom theme disappeared after save: ${savedId}`);
  return saved;
}

export async function duplicateTheme(themeId: string, name?: string): Promise<StartPageTheme> {
  let duplicateId = "";
  const result = await updateStartPageSettings((current) => {
    const source = getTheme(current, themeId);
    const now = Date.now();
    const duplicate: StartPageTheme = {
      ...cloneTheme(source),
      id: createThemeId(),
      name: name?.trim() || source.name,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    };
    duplicateId = duplicate.id;
    return {
      ...current,
      themes: { selectedThemeId: duplicate.id, customThemes: [...current.themes.customThemes, duplicate] },
    };
  });
  const duplicate = result.settings.themes.customThemes.find((theme) => theme.id === duplicateId);
  if (!duplicate) throw new Error(`Duplicated theme disappeared after save: ${duplicateId}`);
  return duplicate;
}

export async function deleteCustomTheme(themeId: string): Promise<void> {
  await updateStartPageSettings((current) => {
    if (getBuiltInTheme(themeId)) throw new Error("Built-in themes cannot be deleted");
    if (!current.themes.customThemes.some((theme) => theme.id === themeId)) return current;
    const customThemes = current.themes.customThemes.filter((theme) => theme.id !== themeId);
    const selectedThemeId = current.themes.selectedThemeId === themeId
      ? DEFAULT_SETTINGS.themes.selectedThemeId
      : current.themes.selectedThemeId;
    return { ...current, themes: { selectedThemeId, customThemes } };
  });
}

export async function selectTheme(themeId: string): Promise<void> {
  await updateStartPageSettings((current) => {
    if (!getBuiltInTheme(themeId) && !current.themes.customThemes.some((theme) => theme.id === themeId)) {
      throw new Error(`Theme not found: ${themeId}`);
    }
    return { ...current, themes: { ...current.themes, selectedThemeId: themeId } };
  });
}

export async function importCustomTheme(value: unknown): Promise<{ theme: StartPageTheme; issues: ValidationIssue[] }> {
  const normalizedBundle = normalizeThemeBundle(value);
  if (normalizedBundle.issues.some((issue) => issue.messageKey === "validationInvalidThemeFile")) {
    throw new Error("Invalid Start Tab theme file");
  }
  let importedId = "";
  const result = await updateStartPageSettings((current) => {
    const now = Date.now();
    const theme: StartPageTheme = {
      ...normalizedBundle.value.theme,
      id: createThemeId(),
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    };
    importedId = theme.id;
    return {
      ...current,
      themes: { selectedThemeId: theme.id, customThemes: [...current.themes.customThemes, theme] },
    };
  });
  const theme = result.settings.themes.customThemes.find((candidate) => candidate.id === importedId);
  if (!theme) throw new Error(`Imported theme disappeared after save: ${importedId}`);
  return { theme, issues: normalizedBundle.issues };
}

export function exportCustomTheme(theme: StartPageTheme): ThemeBundle {
  return themeBundle(theme);
}
