import { syncRules } from "./blocklist.js";
import { FOCUS_STATS_KEY } from "./focus-stats.js";

const BACKUP_VERSION = 1;

const STORAGE_KEYS = [
  "blockedSites",
  "lastBlockedUrls",
  "startPageSettings",
  "startPageRuntimeState",
  "localeOverride",
  FOCUS_STATS_KEY,
] as const;

export interface BackupBundle {
  app: "Start Tab";
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  storage: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBackupBundle(value: unknown): value is BackupBundle {
  return isRecord(value)
    && value.app === "Start Tab"
    && value.version === BACKUP_VERSION
    && typeof value.exportedAt === "string"
    && isRecord(value.storage);
}

export async function exportBackup(): Promise<BackupBundle> {
  const storage = await chrome.storage.local.get([...STORAGE_KEYS]);
  return {
    app: "Start Tab",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    storage,
  };
}

export async function importBackup(value: unknown): Promise<void> {
  if (!isBackupBundle(value)) throw new Error("Invalid Start Tab backup file");

  const nextStorage: Record<string, unknown> = {};
  for (const key of STORAGE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value.storage, key)) {
      nextStorage[key] = value.storage[key];
    }
  }

  await chrome.storage.local.set(nextStorage);
  await syncRules();
}

export function backupFileName(date = new Date()): string {
  return `start-tab-backup-${date.toISOString().slice(0, 10)}.json`;
}
