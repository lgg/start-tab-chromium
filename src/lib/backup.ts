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
  version: number;
  exportedAt: string;
  storage: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBackupLike(value: unknown): value is BackupBundle {
  return isRecord(value)
    && value.app === "Start Tab"
    && typeof value.version === "number"
    && Number.isInteger(value.version)
    && value.version >= 1
    && value.version <= BACKUP_VERSION
    && typeof value.exportedAt === "string"
    && isRecord(value.storage);
}

function migrateBackup(value: BackupBundle): BackupBundle {
  let migrated = { ...value, storage: { ...value.storage } };

  switch (migrated.version) {
    case 1:
      break;
    default:
      throw new Error(`Unsupported Start Tab backup version: ${migrated.version}`);
  }

  migrated = { ...migrated, version: BACKUP_VERSION };
  return migrated;
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
  if (!isBackupLike(value)) throw new Error("Invalid Start Tab backup file");
  const backup = migrateBackup(value);

  const nextStorage: Record<string, unknown> = {};
  for (const key of STORAGE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(backup.storage, key)) {
      nextStorage[key] = backup.storage[key];
    }
  }

  await chrome.storage.local.set(nextStorage);
  await syncRules();
}

export function backupFileName(date = new Date()): string {
  return `start-tab-backup-${date.toISOString().slice(0, 10)}.json`;
}
