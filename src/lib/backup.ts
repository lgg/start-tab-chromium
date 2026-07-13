import { normalizeBlockedSites, normalizeLastBlockedUrls, syncRules } from "./blocklist.js";
import { markStartTabDataChanged } from "./data-revision.js";
import { FOCUS_STATS_KEY } from "./focus-stats.js";
import {
  LEGACY_INSTANCE_RUNTIME_KEY,
  START_PAGE_RUNTIME_KEY,
  getStartPageRuntimeState,
  normalizeRuntimeState,
} from "./start-page-runtime.js";
import {
  START_PAGE_SETTINGS_KEY,
  getStartPageSettings,
  isRecord,
  normalizeStartPageSettings,
} from "./start-page-settings.js";

export const BACKUP_VERSION = 4;
export const PRE_IMPORT_BACKUP_KEY = "startTabPreImportBackup";

const STORAGE_KEYS = [
  "blockedSites",
  "lastBlockedUrls",
  START_PAGE_SETTINGS_KEY,
  START_PAGE_RUNTIME_KEY,
  "startPageOnboarding",
  "localeOverride",
  FOCUS_STATS_KEY,
] as const;

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

function normalizedStorage(backup: BackupLike): Record<string, unknown> {
  const settings = normalizeStartPageSettings(backup.storage[START_PAGE_SETTINGS_KEY]);
  const runtime = normalizeRuntimeState(
    backup.storage[START_PAGE_RUNTIME_KEY],
    settings,
    backup.storage[LEGACY_INSTANCE_RUNTIME_KEY],
  );
  const locale = normalizeLocale(backup.storage.localeOverride);
  const storage: Record<string, unknown> = {
    blockedSites: normalizeBlockedSites(backup.storage.blockedSites),
    lastBlockedUrls: normalizeLastBlockedUrls(backup.storage.lastBlockedUrls),
    [START_PAGE_SETTINGS_KEY]: settings,
    [START_PAGE_RUNTIME_KEY]: runtime,
    startPageOnboarding: normalizeOnboarding(backup.storage.startPageOnboarding),
    [FOCUS_STATS_KEY]: backup.storage[FOCUS_STATS_KEY] ?? undefined,
  };
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
  return currentSchema(
    normalizedStorage(value),
    value.exportedAt,
    typeof value.snapshotId === "string" && value.snapshotId ? value.snapshotId : backupId(),
  );
}

export async function exportBackup(): Promise<BackupBundle> {
  const settings = await getStartPageSettings();
  const runtime = await getStartPageRuntimeState(settings);
  const additional = await chrome.storage.local.get([...STORAGE_KEYS]);
  return currentSchema({
    ...additional,
    [START_PAGE_SETTINGS_KEY]: settings,
    [START_PAGE_RUNTIME_KEY]: runtime,
  }, new Date().toISOString(), backupId());
}

function keysAbsentFrom(storage: Record<string, unknown>): string[] {
  return STORAGE_KEYS.filter((key) => !Object.prototype.hasOwnProperty.call(storage, key));
}

async function restoreStorageSnapshot(snapshot: Record<string, unknown>): Promise<void> {
  const absent = keysAbsentFrom(snapshot);
  if (absent.length > 0) await chrome.storage.local.remove(absent);
  await chrome.storage.local.set(snapshot);
}

export async function importBackup(value: unknown): Promise<BackupImportReport> {
  if (!isBackupLike(value)) throw new Error("Invalid Start Tab backup file");
  const migrated = migrateBackup(value);
  const current = await chrome.storage.local.get([...STORAGE_KEYS]);
  const next = { ...migrated.storage };
  const optionalRemovals = keysAbsentFrom(next);
  await chrome.storage.local.set({
    [PRE_IMPORT_BACKUP_KEY]: currentSchema(current, new Date().toISOString(), backupId()),
  });

  try {
    await chrome.storage.local.set(next);
    if (optionalRemovals.length > 0) await chrome.storage.local.remove(optionalRemovals);
    await syncRules();
    await markStartTabDataChanged();
  } catch (error) {
    await restoreStorageSnapshot(current);
    await syncRules();
    throw error;
  }

  return {
    sourceVersion: value.version,
    targetVersion: BACKUP_VERSION,
    migrated: value.version !== BACKUP_VERSION,
    importedKeys: Object.keys(next),
  };
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
    Date.parse(bundle.exportedAt) || 0,
    typeof settings.updatedAt === "number" ? settings.updatedAt : 0,
    typeof runtime.updatedAt === "number" ? runtime.updatedAt : 0,
  );
}

export function backupFileName(date = new Date()): string {
  return `start-tab-backup-${date.toISOString().slice(0, 10)}.json`;
}
