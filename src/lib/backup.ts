import { normalizeBackupLastBlockedUrls, type BackupCollectionMode } from "./backup-blocked-urls.js";
import {
  assertBlockedSiteCapacity,
  normalizeBlockedSites,
  syncRulesInCurrentTransaction,
} from "./blocklist.js";
import { DATA_REVISION_KEY, markStartTabDataChanged, readStartTabDataRevision } from "./data-revision.js";
import { withStorageLock } from "./storage-lock.js";
import { FOCUS_STATS_KEY, isFutureFocusStatsSchema, normalizeFocusStats } from "./focus-stats.js";
import {
  MAX_BLOCKED_SITES,
  MAX_CUSTOM_THEMES,
  MAX_LOCAL_TASKS_PER_INSTANCE,
  MAX_START_PAGE_BLOCKS,
} from "./platform-limits.js";
import {
  LEGACY_INSTANCE_RUNTIME_KEY,
  START_PAGE_RUNTIME_KEY,
  isFutureRuntimeSchema,
  normalizeRuntimeState,
  readClockAlarmSnapshot,
  reconcileClockAlarmsForRuntime,
  restoreClockAlarmSnapshot,
} from "./start-page-runtime.js";
import {
  START_PAGE_SETTINGS_KEY,
  isFutureStartPageSchema,
  isRecord,
  normalizeStartPageSettings,
} from "./start-page-settings.js";

export const BACKUP_VERSION = 4;
export const PRE_IMPORT_BACKUP_KEY = "startTabPreImportBackup";

const LEGACY_BLOCKED_SITES_KEY = "blocked";
const STORAGE_KEYS = [
  "blockedSites",
  "lastBlockedUrls",
  START_PAGE_SETTINGS_KEY,
  START_PAGE_RUNTIME_KEY,
  "startPageOnboarding",
  "localeOverride",
  FOCUS_STATS_KEY,
] as const;

const SNAPSHOT_KEYS = [...STORAGE_KEYS, LEGACY_BLOCKED_SITES_KEY, LEGACY_INSTANCE_RUNTIME_KEY] as const;
const ROLLBACK_KEYS = [...SNAPSHOT_KEYS, PRE_IMPORT_BACKUP_KEY, DATA_REVISION_KEY] as const;

export type BackupStorageKey = (typeof STORAGE_KEYS)[number];

export interface BackupBundle {
  app: "Start Tab";
  version: number;
  exportedAt: string;
  snapshotId: string;
  schema: {
    version: number;
    storageKeys: string[];
  };
  storage: Record<string, unknown>;
}

export interface BackupImportOptions {
  dataRevisionAt?: number;
}

export interface ExportedBackupSnapshot {
  bundle: BackupBundle;
  dataRevision: number;
}

export interface BackupImportReport {
  sourceVersion: number;
  targetVersion: number;
  migrated: boolean;
  importedKeys: string[];
}

interface BackupLike {
  app: "Start Tab";
  version: number;
  exportedAt: string;
  snapshotId?: string;
  schema?: BackupBundle["schema"];
  storage: Record<string, unknown>;
}

function backupId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isBackupLike(value: unknown): value is BackupLike {
  return isRecord(value)
    && value.app === "Start Tab"
    && typeof value.version === "number"
    && Number.isInteger(value.version)
    && value.version >= 1
    && value.version <= BACKUP_VERSION
    && isIsoTimestamp(value.exportedAt)
    && isRecord(value.storage);
}

function normalizeOnboarding(value: unknown): Record<string, boolean> {
  return { onboarded: isRecord(value) && value.onboarded === true };
}

function normalizeLocale(value: unknown): "en" | "ru" | null {
  return value === "en" || value === "ru" ? value : null;
}

type StorageNormalizationMode = BackupCollectionMode;

function normalizeBackupBlockedSites(
  source: Record<string, unknown>,
  mode: StorageNormalizationMode,
): string[] {
  const current = Array.isArray(source.blockedSites) ? source.blockedSites : [];
  const legacy = Array.isArray(source[LEGACY_BLOCKED_SITES_KEY]) ? source[LEGACY_BLOCKED_SITES_KEY] : [];
  const normalized = normalizeBlockedSites([...current, ...legacy]);
  if (mode === "strict-import") {
    assertBlockedSiteCapacity(normalized);
    return normalized;
  }
  return normalized.slice(0, MAX_BLOCKED_SITES);
}

function assertSupportedSchemas(storage: Record<string, unknown>): void {
  if (isFutureStartPageSchema(storage[START_PAGE_SETTINGS_KEY])) {
    throw new Error("This backup contains Start Tab settings from a newer extension version");
  }
  if (isFutureRuntimeSchema(storage[START_PAGE_RUNTIME_KEY])) {
    throw new Error("This backup contains Start Tab runtime data from a newer extension version");
  }
  if (isFutureFocusStatsSchema(storage[FOCUS_STATS_KEY])) {
    throw new Error("This backup contains focus statistics from a newer extension version");
  }
}

function assertArrayCapacity(value: unknown, maximum: number, label: string): void {
  if (Array.isArray(value) && value.length > maximum) {
    throw new Error(`Start Tab backup contains more than ${maximum} ${label}`);
  }
}

function assertTaskCollectionCapacity(value: unknown, label: string): void {
  if (!isRecord(value)) return;
  for (const [instanceId, tasks] of Object.entries(value)) {
    assertArrayCapacity(tasks, MAX_LOCAL_TASKS_PER_INSTANCE, `${label} tasks for instance ${instanceId}`);
  }
}

function assertCollectionCapacity(storage: Record<string, unknown>): void {
  const settings = isRecord(storage[START_PAGE_SETTINGS_KEY]) ? storage[START_PAGE_SETTINGS_KEY] : {};
  const layout = isRecord(settings.layout) ? settings.layout : {};
  const themes = isRecord(settings.themes) ? settings.themes : {};
  assertArrayCapacity(layout.blocks, MAX_START_PAGE_BLOCKS, "block instances");
  assertArrayCapacity(themes.customThemes, MAX_CUSTOM_THEMES, "custom themes");

  const runtime = isRecord(storage[START_PAGE_RUNTIME_KEY]) ? storage[START_PAGE_RUNTIME_KEY] : {};
  const legacyRuntime = isRecord(storage[LEGACY_INSTANCE_RUNTIME_KEY]) ? storage[LEGACY_INSTANCE_RUNTIME_KEY] : {};
  assertTaskCollectionCapacity(runtime.tasks, "runtime");
  assertTaskCollectionCapacity(legacyRuntime.localTasks, "legacy runtime");
  assertArrayCapacity(runtime.localTasks, MAX_LOCAL_TASKS_PER_INSTANCE, "legacy shared local tasks");
}

function normalizedStorage(
  source: Record<string, unknown>,
  mode: StorageNormalizationMode = "strict-import",
): Record<string, unknown> {
  if (mode === "strict-import") assertCollectionCapacity(source);
  const blockedSites = normalizeBackupBlockedSites(source, mode);
  const settings = normalizeStartPageSettings(source[START_PAGE_SETTINGS_KEY]);
  const runtime = normalizeRuntimeState(
    source[START_PAGE_RUNTIME_KEY],
    settings,
    source[LEGACY_INSTANCE_RUNTIME_KEY],
  );
  const locale = normalizeLocale(source.localeOverride);
  const storage: Record<string, unknown> = {
    blockedSites,
    lastBlockedUrls: normalizeBackupLastBlockedUrls(source.lastBlockedUrls, blockedSites, mode),
    [START_PAGE_SETTINGS_KEY]: settings,
    [START_PAGE_RUNTIME_KEY]: runtime,
    startPageOnboarding: normalizeOnboarding(source.startPageOnboarding),
  };
  if (Object.prototype.hasOwnProperty.call(source, FOCUS_STATS_KEY)) {
    storage[FOCUS_STATS_KEY] = normalizeFocusStats(source[FOCUS_STATS_KEY]);
  }
  if (locale) storage.localeOverride = locale;
  return storage;
}

function currentSchema(storage: Record<string, unknown>, exportedAt: string, snapshotId: string): BackupBundle {
  return {
    app: "Start Tab",
    version: BACKUP_VERSION,
    exportedAt,
    snapshotId,
    schema: { version: BACKUP_VERSION, storageKeys: [...STORAGE_KEYS] },
    storage,
  };
}

export function migrateBackup(value: unknown): BackupBundle {
  if (!isBackupLike(value)) throw new Error("Invalid Start Tab backup file");
  assertSupportedSchemas(value.storage);
  return currentSchema(
    normalizedStorage(value.storage),
    value.exportedAt,
    typeof value.snapshotId === "string" && value.snapshotId ? value.snapshotId : backupId(),
  );
}

async function exportBackupInCurrentTransaction(): Promise<BackupBundle> {
  const snapshot = await chrome.storage.local.get([...SNAPSHOT_KEYS]);
  assertSupportedSchemas(snapshot);
  return currentSchema(normalizedStorage(snapshot, "local-recovery"), new Date().toISOString(), backupId());
}

/** Capture backup content and its conflict-resolution revision from one data-write snapshot. */
export async function exportBackupSnapshot(): Promise<ExportedBackupSnapshot> {
  return withStorageLock("data-write", async () => {
    const bundle = await exportBackupInCurrentTransaction();
    const dataRevision = await readStartTabDataRevision(backupModifiedAt(bundle));
    return { bundle, dataRevision };
  });
}

export async function exportBackup(): Promise<BackupBundle> {
  return (await exportBackupSnapshot()).bundle;
}

function keysAbsentFrom(storage: Record<string, unknown>, keys: readonly string[] = STORAGE_KEYS): string[] {
  return keys.filter((key) => !Object.prototype.hasOwnProperty.call(storage, key));
}

async function restoreStorageSnapshot(snapshot: Record<string, unknown>): Promise<void> {
  const absent = keysAbsentFrom(snapshot, ROLLBACK_KEYS);
  await chrome.storage.local.set(snapshot);
  if (absent.length > 0) await chrome.storage.local.remove(absent);
}

export async function importBackup(value: unknown, options: BackupImportOptions = {}): Promise<BackupImportReport> {
  if (!isBackupLike(value)) throw new Error("Invalid Start Tab backup file");
  const migrated = migrateBackup(value);

  return withStorageLock("data-write", async () => {
    const current = await chrome.storage.local.get([...ROLLBACK_KEYS]);
    const currentAlarms = await readClockAlarmSnapshot();
    assertSupportedSchemas(current);
    const next = { ...migrated.storage };
    const removals = keysAbsentFrom(next, SNAPSHOT_KEYS);
    const recovery = currentSchema(normalizedStorage(current, "local-recovery"), new Date().toISOString(), backupId());
    await chrome.storage.local.set({ [PRE_IMPORT_BACKUP_KEY]: recovery });

    try {
      await chrome.storage.local.set(next);
      if (removals.length > 0) await chrome.storage.local.remove(removals);
      await syncRulesInCurrentTransaction();
      await reconcileClockAlarmsForRuntime(next[START_PAGE_RUNTIME_KEY] as ReturnType<typeof normalizeRuntimeState>);
      await markStartTabDataChanged(options.dataRevisionAt);
    } catch (error) {
      try {
        await restoreStorageSnapshot(current);
        await syncRulesInCurrentTransaction();
        await restoreClockAlarmSnapshot(currentAlarms);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Backup import failed and rollback was incomplete");
      }
      throw error;
    }

    return {
      sourceVersion: value.version,
      targetVersion: BACKUP_VERSION,
      migrated: value.version !== BACKUP_VERSION,
      importedKeys: Object.keys(next),
    };
  });
}

export async function restorePreImportBackup(): Promise<void> {
  const items = await chrome.storage.local.get(PRE_IMPORT_BACKUP_KEY);
  const backup = items[PRE_IMPORT_BACKUP_KEY];
  if (!backup) throw new Error("No pre-import recovery backup is available");
  await importBackup(backup);
}

export function backupModifiedAt(bundle: BackupBundle): number {
  const settings = isRecord(bundle.storage[START_PAGE_SETTINGS_KEY]) ? bundle.storage[START_PAGE_SETTINGS_KEY] : {};
  const runtime = isRecord(bundle.storage[START_PAGE_RUNTIME_KEY]) ? bundle.storage[START_PAGE_RUNTIME_KEY] : {};
  return Math.max(
    typeof settings.updatedAt === "number" ? settings.updatedAt : 0,
    typeof runtime.updatedAt === "number" ? runtime.updatedAt : 0,
  );
}

export function backupFileName(date = new Date()): string {
  return `start-tab-backup-${date.toISOString().slice(0, 10)}.json`;
}
