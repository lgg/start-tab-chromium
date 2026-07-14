import { markStartTabDataChanged } from "./data-revision.js";
import { withStorageLock } from "./storage-lock.js";
import {
  BLOCK_DESCRIPTORS,
  BUILT_IN_THEMES,
  DEFAULT_LAYOUT_BLOCKS,
  DEFAULT_SEARCH_PROVIDERS,
  DEFAULT_SETTINGS,
  LAYOUT_PRESETS,
  blockDescriptor,
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

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function blockContentEqual(left: BlockInstance, right: BlockInstance): boolean {
  return jsonEqual(
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

async function persistSettingsInTransaction(settings: StartPageSettings, report?: MigrationReport): Promise<void> {
  const payload: Record<string, unknown> = { [START_PAGE_SETTINGS_KEY]: settings };
  if (report) payload[START_PAGE_MIGRATION_REPORT_KEY] = report;
  await chrome.storage.local.set(payload);
  await markStartTabDataChanged(settings.updatedAt || Date.now());
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
  if (isFutureStartPageSchema(raw)) {
    await chrome.storage.local.set({ [START_PAGE_MIGRATION_REPORT_KEY]: initial.report });
    return initial.settings;
  }
  if (jsonEqual(raw, initial.settings)) return initial.settings;

  return withStorageLock("data-write", async () => {
    const currentRaw = await readRawSettings();
    const { settings, report } = normalizeStartPageSettingsWithReport(currentRaw);
    if (isFutureStartPageSchema(currentRaw)) {
      await chrome.storage.local.set({ [START_PAGE_MIGRATION_REPORT_KEY]: report });
      return settings;
    }
    if (jsonEqual(currentRaw, settings)) return settings;
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

async function validateAndPersistSettingsInTransaction(
  value: StartPageSettings,
  raw: unknown,
): Promise<{ settings: StartPageSettings; issues: ValidationIssue[] }> {
  if (isFutureStartPageSchema(raw)) {
    throw new Error("Start Tab settings were created by a newer extension version and cannot be modified safely");
  }
  const previous = normalizeStartPageSettings(raw);
  if (previous.updatedAt > 0 && value.updatedAt !== previous.updatedAt) {
    throw new Error("Start Tab settings changed in another extension context; reload before saving");
  }
  const validation = validateStartPageSettings(value);
  const stamped = withBlockTimestamps(previous, validation.value, Math.max(Date.now(), previous.updatedAt + 1));
  await persistSettingsInTransaction(stamped);
  return { settings: stamped, issues: validation.issues };
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

export async function resetStartPageSettings(): Promise<StartPageSettings> {
  return withStorageLock("data-write", async () => {
    const settings = createDefaultStartPageSettings();
    await persistSettingsInTransaction(settings);
    await chrome.storage.local.remove(START_PAGE_MIGRATION_REPORT_KEY);
    return settings;
  });
}

export function canAddBlock(settings: StartPageSettings, type: BlockType): boolean {
  return !isSingletonBlockType(type) || !settings.layout.blocks.some((block) => block.type === type);
}

function nextGridPosition(settings: StartPageSettings): { column: number; row: number } {
  return {
    column: 1,
    row: Math.max(1, settings.layout.blocks.reduce((maximum, block) => Math.max(maximum, block.row + block.height), 1) + 1),
  };
}

export async function addBlockInstance<T extends BlockType>(type: T): Promise<BlockInstanceFor<T>> {
  const current = await getStartPageSettings();
  if (!canAddBlock(current, type)) throw new Error(`Singleton block already exists: ${type}`);
  const block = createBlockInstance(type, {
    ...nextGridPosition(current),
    zone: current.layout.zone,
    order: current.layout.blocks.length,
  });
  await setStartPageSettings({
    ...current,
    layout: { ...current.layout, profile: "custom", blocks: [...current.layout.blocks, block] },
  });
  return block;
}

export async function updateBlockInstance(
  id: string,
  updater: (block: BlockInstance) => BlockInstance,
): Promise<BlockInstance> {
  const current = await getStartPageSettings();
  const existing = current.layout.blocks.find((block) => block.id === id);
  if (!existing) throw new Error(`Block instance not found: ${id}`);
  const candidate = updater(cloneBlock(existing));
  if (candidate.id !== id || candidate.type !== existing.type) throw new Error("Block identity and type cannot be changed");
  await setStartPageSettings({
    ...current,
    layout: {
      ...current.layout,
      profile: "custom",
      blocks: current.layout.blocks.map((block) => block.id === id ? candidate : block),
    },
  });
  const saved = (await getStartPageSettings()).layout.blocks.find((block) => block.id === id);
  if (!saved) throw new Error(`Block instance disappeared after save: ${id}`);
  return saved;
}

export async function setBlockEnabled(id: string, enabled: boolean): Promise<BlockInstance> {
  return updateBlockInstance(id, (block) => ({ ...block, enabled }));
}

export async function duplicateBlockInstance(id: string, title?: string): Promise<BlockInstance> {
  const current = await getStartPageSettings();
  const source = current.layout.blocks.find((block) => block.id === id);
  if (!source) throw new Error(`Block instance not found: ${id}`);
  if (isSingletonBlockType(source.type)) throw new Error(`Singleton block cannot be duplicated: ${source.type}`);
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
  await setStartPageSettings({
    ...current,
    layout: { ...current.layout, profile: "custom", blocks: [...current.layout.blocks, duplicate] },
  });
  return duplicate;
}

export async function removeBlockInstance(id: string): Promise<BlockInstance> {
  const current = await getStartPageSettings();
  const removed = current.layout.blocks.find((block) => block.id === id);
  if (!removed) throw new Error(`Block instance not found: ${id}`);
  await setStartPageSettings({
    ...current,
    layout: {
      ...current.layout,
      profile: "custom",
      blocks: current.layout.blocks.filter((block) => block.id !== id).map((block, order) => ({ ...block, order })),
    },
  });
  return removed;
}

export async function applyLayoutPreset(presetId: LayoutPresetId): Promise<StartPageSettings> {
  const current = await getStartPageSettings();
  const preset = LAYOUT_PRESETS.find((item) => item.id === presetId);
  if (!preset) throw new Error(`Unknown layout preset: ${presetId}`);
  await setStartPageSettings({
    ...current,
    layout: {
      ...current.layout,
      columns: preset.columns,
      profile: preset.id,
      blocks: blocksFromPreset(preset, current.layout.zone),
    },
  });
  return getStartPageSettings();
}

export async function setLayoutMode(mode: LayoutMode): Promise<StartPageSettings> {
  const current = await getStartPageSettings();
  await setStartPageSettings({ ...current, layout: { ...current.layout, mode, profile: "custom" } });
  return getStartPageSettings();
}

export async function setLayoutZone(zone: LayoutZone): Promise<StartPageSettings> {
  const current = await getStartPageSettings();
  await setStartPageSettings({
    ...current,
    layout: {
      ...current.layout,
      zone,
      profile: "custom",
      blocks: current.layout.blocks.map((block) => ({ ...block, zone })),
    },
  });
  return getStartPageSettings();
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
  const current = await getStartPageSettings();
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
  await setStartPageSettings({
    ...current,
    themes: { selectedThemeId: normalized.id, customThemes: [...current.themes.customThemes, normalized] },
  });
  return normalized;
}

export async function createCustomTheme(name: string, sourceThemeId?: string): Promise<StartPageTheme> {
  const current = await getStartPageSettings();
  return createCustomThemeDraft(current, name, sourceThemeId);
}

export async function updateCustomTheme(theme: StartPageTheme): Promise<StartPageTheme> {
  const current = await getStartPageSettings();
  if (getBuiltInTheme(theme.id)) throw new Error("Built-in themes cannot be edited");
  const existing = current.themes.customThemes.find((item) => item.id === theme.id);
  if (!existing) return saveNewCustomTheme(theme);
  const normalized = normalizeTheme({
    ...theme,
    builtIn: false,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  }, existing);
  normalized.builtIn = false;
  await setStartPageSettings({
    ...current,
    themes: {
      ...current.themes,
      customThemes: current.themes.customThemes.map((item) => item.id === theme.id ? normalized : item),
    },
  });
  return normalized;
}

export async function duplicateTheme(themeId: string, name?: string): Promise<StartPageTheme> {
  const current = await getStartPageSettings();
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
  await setStartPageSettings({
    ...current,
    themes: { selectedThemeId: duplicate.id, customThemes: [...current.themes.customThemes, duplicate] },
  });
  return duplicate;
}

export async function deleteCustomTheme(themeId: string): Promise<void> {
  const current = await getStartPageSettings();
  if (getBuiltInTheme(themeId)) throw new Error("Built-in themes cannot be deleted");
  if (!current.themes.customThemes.some((theme) => theme.id === themeId)) return;
  const customThemes = current.themes.customThemes.filter((theme) => theme.id !== themeId);
  const selectedThemeId = current.themes.selectedThemeId === themeId
    ? DEFAULT_SETTINGS.themes.selectedThemeId
    : current.themes.selectedThemeId;
  await setStartPageSettings({ ...current, themes: { selectedThemeId, customThemes } });
}

export async function selectTheme(themeId: string): Promise<void> {
  const current = await getStartPageSettings();
  if (!getBuiltInTheme(themeId) && !current.themes.customThemes.some((theme) => theme.id === themeId)) {
    throw new Error(`Theme not found: ${themeId}`);
  }
  await setStartPageSettings({ ...current, themes: { ...current.themes, selectedThemeId: themeId } });
}

export async function importCustomTheme(value: unknown): Promise<{ theme: StartPageTheme; issues: ValidationIssue[] }> {
  const result = normalizeThemeBundle(value);
  if (result.issues.some((issue) => issue.messageKey === "validationInvalidThemeFile")) {
    throw new Error("Invalid Start Tab theme file");
  }
  const current = await getStartPageSettings();
  const now = Date.now();
  const theme: StartPageTheme = {
    ...result.value.theme,
    id: createThemeId(),
    builtIn: false,
    createdAt: now,
    updatedAt: now,
  };
  await setStartPageSettings({
    ...current,
    themes: { selectedThemeId: theme.id, customThemes: [...current.themes.customThemes, theme] },
  });
  return { theme, issues: result.issues };
}

export function exportCustomTheme(theme: StartPageTheme): ThemeBundle {
  return themeBundle(theme);
}
