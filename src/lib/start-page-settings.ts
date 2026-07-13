import {
  blocksFromPreset,
  BUILT_IN_THEMES,
  DEFAULT_LAYOUT_BLOCKS,
  DEFAULT_SEARCH_PROVIDERS,
  DEFAULT_SETTINGS,
  LAYOUT_PRESETS,
  blockDescriptor,
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
  type DateTimeMode,
  type LayoutMode,
  type LayoutPreset,
  type LayoutPresetId,
  type LayoutZone,
  type LinkPageDirection,
  type MigrationReport,
  type SearchProvider,
  type SearchProviderId,
  type SettingsButtonVisibility,
  type StartLink,
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
export type { SearchProviderId };

export {
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
  BlockConfig,
  BlockInstance,
  BlockInstanceFor,
  BlockType,
  DateTimeMode,
  LayoutMode,
  LayoutPreset,
  LayoutPresetId,
  LayoutZone,
  LinkPageDirection,
  MigrationReport,
  SearchProvider,
  SettingsButtonVisibility,
  StartLink,
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

function withBlockTimestamps(previous: StartPageSettings | null, next: StartPageSettings, now: number): StartPageSettings {
  if (!previous) {
    return {
      ...next,
      updatedAt: now,
      layout: {
        ...next.layout,
        blocks: next.layout.blocks.map((block) => ({
          ...block,
          createdAt: block.createdAt || now,
          updatedAt: block.updatedAt || now,
        })),
      },
    };
  }
  const previousById = new Map(previous.layout.blocks.map((block) => [block.id, block]));
  return {
    ...next,
    updatedAt: now,
    layout: {
      ...next.layout,
      blocks: next.layout.blocks.map((block) => {
        const prior = previousById.get(block.id);
        if (!prior) return { ...block, createdAt: block.createdAt || now, updatedAt: now };
        return {
          ...block,
          createdAt: prior.createdAt || block.createdAt || now,
          updatedAt: jsonEqual(prior, block) ? prior.updatedAt : now,
        };
      }),
    },
  };
}

async function readRawSettings(): Promise<unknown> {
  const items = await chrome.storage.local.get(START_PAGE_SETTINGS_KEY);
  return items[START_PAGE_SETTINGS_KEY];
}

export async function getStartPageSettings(): Promise<StartPageSettings> {
  const raw = await readRawSettings();
  const { settings, report } = normalizeStartPageSettingsWithReport(raw);
  const needsWrite = !jsonEqual(raw, settings);
  if (!needsWrite) return settings;

  const stamped = withBlockTimestamps(null, settings, Date.now());
  await chrome.storage.local.set({
    [START_PAGE_SETTINGS_KEY]: stamped,
    [START_PAGE_MIGRATION_REPORT_KEY]: report,
  });
  return stamped;
}

export async function getStartPageMigrationReport(): Promise<MigrationReport | null> {
  const items = await chrome.storage.local.get(START_PAGE_MIGRATION_REPORT_KEY);
  const value = items[START_PAGE_MIGRATION_REPORT_KEY];
  if (!isRecord(value)) return null;
  const issues = Array.isArray(value.issues)
    ? value.issues.filter(isRecord).flatMap((issue) => typeof issue.path === "string" && typeof issue.reason === "string" ? [{ path: issue.path, reason: issue.reason }] : [])
    : [];
  if (typeof value.fromVersion !== "number" || typeof value.toVersion !== "number") return null;
  return {
    fromVersion: value.fromVersion,
    toVersion: value.toVersion,
    migratedBlocks: typeof value.migratedBlocks === "number" ? value.migratedBlocks : 0,
    skippedBlocks: typeof value.skippedBlocks === "number" ? value.skippedBlocks : 0,
    issues,
  };
}

export async function setStartPageSettings(value: StartPageSettings): Promise<ValidationIssue[]> {
  const previous = normalizeStartPageSettings(await readRawSettings());
  const validation = validateStartPageSettings(value);
  const stamped = withBlockTimestamps(previous, validation.value, Date.now());
  await chrome.storage.local.set({ [START_PAGE_SETTINGS_KEY]: stamped });
  return validation.issues;
}

export async function updateStartPageSettings(
  updater: (current: StartPageSettings) => StartPageSettings,
): Promise<{ settings: StartPageSettings; issues: ValidationIssue[] }> {
  const current = await getStartPageSettings();
  const candidate = updater(cloneSettings(current));
  const issues = await setStartPageSettings(candidate);
  return { settings: await getStartPageSettings(), issues };
}

export async function resetStartPageSettings(): Promise<StartPageSettings> {
  const now = Date.now();
  const settings = withBlockTimestamps(null, cloneSettings(DEFAULT_SETTINGS), now);
  await chrome.storage.local.set({ [START_PAGE_SETTINGS_KEY]: settings });
  return settings;
}

export function canAddBlock(settings: StartPageSettings, type: BlockType): boolean {
  return !isSingletonBlockType(type) || !settings.layout.blocks.some((block) => block.type === type);
}

function nextGridPosition(settings: StartPageSettings, type: BlockType): { column: number; row: number } {
  const descriptor = blockDescriptor(type);
  const maxRow = settings.layout.blocks.reduce((maximum, block) => Math.max(maximum, block.row + block.height), 1);
  return {
    column: 1,
    row: Math.max(1, maxRow + 1),
  };
}

export async function addBlockInstance<T extends BlockType>(type: T): Promise<BlockInstanceFor<T>> {
  const current = await getStartPageSettings();
  if (!canAddBlock(current, type)) throw new Error(`Singleton block already exists: ${type}`);
  const position = nextGridPosition(current, type);
  const block = createBlockInstance(type, {
    ...position,
    zone: current.layout.zone,
    order: current.layout.blocks.length,
  });
  await setStartPageSettings({
    ...current,
    layout: {
      ...current.layout,
      profile: "custom",
      blocks: [...current.layout.blocks, block],
    },
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
  const blocks = current.layout.blocks.map((block) => block.id === id ? candidate : block);
  await setStartPageSettings({ ...current, layout: { ...current.layout, profile: "custom", blocks } });
  const saved = (await getStartPageSettings()).layout.blocks.find((block) => block.id === id);
  if (!saved) throw new Error(`Block instance disappeared after save: ${id}`);
  return saved;
}

export async function setBlockEnabled(id: string, enabled: boolean): Promise<BlockInstance> {
  return updateBlockInstance(id, (block) => ({ ...block, enabled }));
}

export async function duplicateBlockInstance(id: string): Promise<BlockInstance> {
  const current = await getStartPageSettings();
  const source = current.layout.blocks.find((block) => block.id === id);
  if (!source) throw new Error(`Block instance not found: ${id}`);
  if (isSingletonBlockType(source.type)) throw new Error(`Singleton block cannot be duplicated: ${source.type}`);
  const duplicate: BlockInstance = {
    ...cloneBlock(source),
    id: createBlockId(source.type),
    title: `${source.title} copy`,
    column: Math.min(current.layout.columns, source.column + 1),
    row: source.row + 1,
    order: current.layout.blocks.length,
    free: {
      ...source.free,
      x: source.free.x + 24,
      y: source.free.y + 24,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await setStartPageSettings({
    ...current,
    layout: {
      ...current.layout,
      profile: "custom",
      blocks: [...current.layout.blocks, duplicate],
    },
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
  const next: StartPageSettings = {
    ...current,
    layout: {
      ...current.layout,
      columns: preset.columns,
      profile: preset.id,
      blocks: blocksFromPreset(preset, current.layout.zone),
    },
  };
  await setStartPageSettings(next);
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

export async function createCustomTheme(name: string, sourceThemeId?: string): Promise<StartPageTheme> {
  const current = await getStartPageSettings();
  const source = sourceThemeId ? getTheme(current, sourceThemeId) : getTheme(current);
  const now = Date.now();
  const theme: StartPageTheme = {
    ...cloneTheme(source),
    id: createThemeId(),
    name: name.trim() || "Custom theme",
    builtIn: false,
    createdAt: now,
    updatedAt: now,
  };
  await setStartPageSettings({
    ...current,
    themes: {
      selectedThemeId: theme.id,
      customThemes: [...current.themes.customThemes, theme],
    },
  });
  return theme;
}

export async function updateCustomTheme(theme: StartPageTheme): Promise<StartPageTheme> {
  const current = await getStartPageSettings();
  if (getBuiltInTheme(theme.id)) throw new Error("Built-in themes cannot be edited");
  const existing = current.themes.customThemes.find((item) => item.id === theme.id);
  if (!existing) throw new Error(`Custom theme not found: ${theme.id}`);
  const normalized = normalizeTheme({ ...theme, builtIn: false, createdAt: existing.createdAt, updatedAt: Date.now() }, existing);
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

export async function duplicateTheme(themeId: string): Promise<StartPageTheme> {
  const current = await getStartPageSettings();
  const source = getTheme(current, themeId);
  const now = Date.now();
  const duplicate: StartPageTheme = {
    ...cloneTheme(source),
    id: createThemeId(),
    name: `${source.name} copy`,
    builtIn: false,
    createdAt: now,
    updatedAt: now,
  };
  await setStartPageSettings({
    ...current,
    themes: {
      selectedThemeId: duplicate.id,
      customThemes: [...current.themes.customThemes, duplicate],
    },
  });
  return duplicate;
}

export async function deleteCustomTheme(themeId: string): Promise<void> {
  const current = await getStartPageSettings();
  if (getBuiltInTheme(themeId)) throw new Error("Built-in themes cannot be deleted");
  if (!current.themes.customThemes.some((theme) => theme.id === themeId)) return;
  const customThemes = current.themes.customThemes.filter((theme) => theme.id !== themeId);
  const selectedThemeId = current.themes.selectedThemeId === themeId ? DEFAULT_SETTINGS.themes.selectedThemeId : current.themes.selectedThemeId;
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
    themes: {
      selectedThemeId: theme.id,
      customThemes: [...current.themes.customThemes, theme],
    },
  });
  return { theme, issues: result.issues };
}

export function exportCustomTheme(theme: StartPageTheme): ThemeBundle {
  return themeBundle(theme);
}
