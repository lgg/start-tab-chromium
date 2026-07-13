import {
  BLOCK_INSTANCE_SCHEMA_VERSION,
  START_PAGE_SCHEMA_VERSION,
  type BlockInstance,
  type BlockType,
  type LayoutMode,
  type LayoutZone,
  type MigrationIssue,
  type MigrationReport,
  type StartPageSettings,
  type ValidationIssue,
  type ValidationResult,
} from "./start-page-types.js";
import {
  BLOCK_DESCRIPTORS,
  DEFAULT_LAYOUT_BLOCKS,
  DEFAULT_SETTINGS,
  blockDescriptor,
  cloneBlocks,
  cloneSettings,
  getBuiltInTheme,
  isSingletonBlockType,
} from "./start-page-defaults.js";
import { normalizeBlockConfig } from "./start-page-block-validation.js";
import { migrateLegacyTheme, normalizeCustomThemes } from "./start-page-theme-validation.js";
import {
  booleanValue,
  finiteInteger,
  finiteNumber,
  isBlockType,
  isRecord,
  legacyConfigSource,
  normalizeDomainMinutes,
  oneOf,
  stringValue,
  timestampValue,
  trimmedString,
} from "./start-page-validation-primitives.js";

const LAYOUT_MODES: readonly LayoutMode[] = ["grid", "free"];
const LAYOUT_ZONES: readonly LayoutZone[] = ["contained", "full"];
const SETTINGS_VISIBILITY = ["always", "hover"] as const;
const SETTINGS_HOVER_AREAS = ["top", "top-right", "right"] as const;

function normalizeBlockId(value: unknown, type: BlockType, seen: Set<string>): string {
  const requested = trimmedString(value, type, 160).replace(/[^a-zA-Z0-9_.:-]/g, "-") || type;
  if (!seen.has(requested)) return requested;
  let suffix = 2;
  while (seen.has(`${requested}-${suffix}`)) suffix += 1;
  return `${requested}-${suffix}`;
}

function normalizeBlock(value: unknown, index: number, root: Record<string, unknown>, columns: number, zone: LayoutZone, seenIds: Set<string>, seenSingletons: Set<BlockType>, issues: ValidationIssue[], migrationIssues: MigrationIssue[]): BlockInstance | null {
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
  const minimumWidth = Math.min(descriptor.minGridWidth, columns);
  const width = finiteInteger(value.width, Math.min(descriptor.defaultGridWidth, columns), minimumWidth, columns);
  const height = finiteInteger(value.height, descriptor.defaultGridHeight, descriptor.minGridHeight, 80);
  const blockZone = oneOf(value.zone, LAYOUT_ZONES, zone);
  const free = isRecord(value.free) ? value.free : {};
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
    order: finiteInteger(value.order, index, 0, 10000),
    free: {
      x: finiteNumber(free.x, Math.max(0, (finiteInteger(value.column, 1, 1, columns) - 1) * 92), 0, 100000),
      y: finiteNumber(free.y, Math.max(0, (finiteInteger(value.row, index + 1, 1, 500) - 1) * 76), 0, 100000),
      width: finiteNumber(free.width, Math.max(descriptor.minFreeWidth, width * 90), descriptor.minFreeWidth, 100000),
      height: finiteNumber(free.height, Math.max(descriptor.minFreeHeight, height * 72), descriptor.minFreeHeight, 100000),
    },
    config: normalizeBlockConfig(type, configValue, root, `layout.blocks[${index}].config`, issues),
    createdAt,
    updatedAt: timestampValue(value.updatedAt, createdAt),
  } as BlockInstance;
  seenIds.add(id);
  if (isSingletonBlockType(type)) seenSingletons.add(type);
  return block;
}

function overlaps(left: BlockInstance, right: BlockInstance): boolean {
  return left.zone === right.zone && left.column < right.column + right.width && left.column + left.width > right.column && left.row < right.row + right.height && left.row + left.height > right.row;
}

function normalizeGridCollisions(blocks: BlockInstance[]): BlockInstance[] {
  const placed: BlockInstance[] = [];
  for (const block of blocks) {
    let next = block;
    if (next.enabled) {
      let attempts = 0;
      while (placed.some((candidate) => candidate.enabled && overlaps(next, candidate)) && attempts < 500) {
        next = { ...next, row: next.row + 1 };
        attempts += 1;
      }
    }
    placed.push(next);
  }
  return placed;
}

function normalizeBlocks(value: unknown, root: Record<string, unknown>, columns: number, zone: LayoutZone, mode: LayoutMode, issues: ValidationIssue[], migrationIssues: MigrationIssue[]): BlockInstance[] {
  const source = Array.isArray(value) ? value : cloneBlocks(DEFAULT_LAYOUT_BLOCKS);
  const seenIds = new Set<string>();
  const seenSingletons = new Set<BlockType>();
  const blocks = source.flatMap((candidate, index) => {
    const block = normalizeBlock(candidate, index, root, columns, zone, seenIds, seenSingletons, issues, migrationIssues);
    return block ? [block] : [];
  }).map((block, order) => ({ ...block, order }));
  return mode === "grid" ? normalizeGridCollisions(blocks) : blocks;
}

export function normalizeStartPageSettingsWithReport(value: unknown): { settings: StartPageSettings; report: MigrationReport; validation: ValidationIssue[] } {
  if (!isRecord(value)) {
    return { settings: cloneSettings(DEFAULT_SETTINGS), report: { fromVersion: 0, toVersion: START_PAGE_SCHEMA_VERSION, migratedBlocks: DEFAULT_SETTINGS.layout.blocks.length, skippedBlocks: 0, issues: [] }, validation: [] };
  }
  const issues: ValidationIssue[] = [];
  const migrationIssues: MigrationIssue[] = [];
  const rawVersion = typeof value.schemaVersion === "number" && Number.isInteger(value.schemaVersion) ? value.schemaVersion : 1;
  const fromVersion = Math.max(1, rawVersion);
  if (fromVersion > START_PAGE_SCHEMA_VERSION) migrationIssues.push({ path: "schemaVersion", reason: `Unsupported future schema version: ${fromVersion}` });
  const startTab = isRecord(value.startTab) ? value.startTab : {};
  const settingsButton = isRecord(value.settingsButton) ? value.settingsButton : {};
  const focusStats = isRecord(value.focusStats) ? value.focusStats : {};
  const layout = isRecord(value.layout) ? value.layout : {};
  const themes = isRecord(value.themes) ? value.themes : {};
  const columns = finiteInteger(layout.columns, DEFAULT_SETTINGS.layout.columns, 1, 80);
  const zone = oneOf(layout.zone, LAYOUT_ZONES, DEFAULT_SETTINGS.layout.zone);
  const mode = oneOf(layout.mode, LAYOUT_MODES, DEFAULT_SETTINGS.layout.mode);
  const blocks = normalizeBlocks(layout.blocks, value, columns, zone, mode, issues, migrationIssues);
  const customThemes = normalizeCustomThemes(themes.customThemes, issues);
  const migratedLegacyTheme = fromVersion < START_PAGE_SCHEMA_VERSION ? migrateLegacyTheme(value, issues) : null;
  if (migratedLegacyTheme && !customThemes.some((theme) => theme.id === migratedLegacyTheme.id)) customThemes.push(migratedLegacyTheme);
  const requestedThemeId = trimmedString(themes.selectedThemeId, migratedLegacyTheme?.id ?? DEFAULT_SETTINGS.themes.selectedThemeId, 160);
  const selectedThemeId = getBuiltInTheme(requestedThemeId) || customThemes.some((theme) => theme.id === requestedThemeId) ? requestedThemeId : DEFAULT_SETTINGS.themes.selectedThemeId;
  const settings: StartPageSettings = {
    schemaVersion: START_PAGE_SCHEMA_VERSION,
    updatedAt: timestampValue(value.updatedAt, 0),
    startTab: { enabled: booleanValue(startTab.enabled, DEFAULT_SETTINGS.startTab.enabled) },
    settingsButton: { visibility: oneOf(settingsButton.visibility, SETTINGS_VISIBILITY, DEFAULT_SETTINGS.settingsButton.visibility), hoverArea: oneOf(settingsButton.hoverArea, SETTINGS_HOVER_AREAS, DEFAULT_SETTINGS.settingsButton.hoverArea) },
    focusStats: { defaultMinutesPerAvoidedVisit: finiteNumber(focusStats.defaultMinutesPerAvoidedVisit, DEFAULT_SETTINGS.focusStats.defaultMinutesPerAvoidedVisit, 0, 1440), avoidedVisitDedupeSeconds: finiteInteger(focusStats.avoidedVisitDedupeSeconds, DEFAULT_SETTINGS.focusStats.avoidedVisitDedupeSeconds, 1, 604800), domainMinutes: normalizeDomainMinutes(focusStats.domainMinutes) },
    layout: { columns, rowHeight: finiteNumber(layout.rowHeight, DEFAULT_SETTINGS.layout.rowHeight, 40, 240), gap: finiteNumber(layout.gap, DEFAULT_SETTINGS.layout.gap, 0, 60), profile: trimmedString(layout.profile, DEFAULT_SETTINGS.layout.profile, 100) || "custom", mode, zone, showBlockTitles: booleanValue(layout.showBlockTitles, DEFAULT_SETTINGS.layout.showBlockTitles), containedMaxWidth: finiteNumber(layout.containedMaxWidth, DEFAULT_SETTINGS.layout.containedMaxWidth, 640, 3840), blocks },
    themes: { selectedThemeId, customThemes },
  };
  return { settings, report: { fromVersion, toVersion: START_PAGE_SCHEMA_VERSION, migratedBlocks: blocks.length, skippedBlocks: migrationIssues.length, issues: migrationIssues }, validation: issues };
}

export function normalizeStartPageSettings(value: unknown): StartPageSettings {
  return normalizeStartPageSettingsWithReport(value).settings;
}

export function validateStartPageSettings(value: unknown): ValidationResult<StartPageSettings> {
  const result = normalizeStartPageSettingsWithReport(value);
  return { value: result.settings, issues: result.validation };
}

export function hasBlockUserData(block: BlockInstance, runtime: { notes?: Record<string, string>; tasks?: Record<string, unknown[]> }): boolean {
  if (block.type === "links" || block.type === "startPinned") return block.config.items.length > 0;
  if (block.type === "note") return Boolean(runtime.notes?.[block.id]?.trim());
  if (block.type === "localTasks") return (runtime.tasks?.[block.id]?.length ?? 0) > 0;
  return BLOCK_DESCRIPTORS.find((descriptor) => descriptor.type === block.type)?.containsUserData === true;
}

export function isFutureStartPageSchema(value: unknown): boolean {
  return isRecord(value) && typeof value.schemaVersion === "number" && Number.isInteger(value.schemaVersion) && value.schemaVersion > START_PAGE_SCHEMA_VERSION;
}
