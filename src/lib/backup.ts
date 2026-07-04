import { normalizeBlockedSites, syncRules } from "./blocklist.js";
import { FOCUS_STATS_KEY } from "./focus-stats.js";
import { normalizeStartPageSettings } from "./start-page-settings.js";

const BACKUP_VERSION = 3;

const STORAGE_KEYS = [
  "blockedSites",
  "lastBlockedUrls",
  "startPageSettings",
  "startPageRuntimeState",
  "startTabInstanceState",
  "startPageOnboarding",
  "localeOverride",
  FOCUS_STATS_KEY,
] as const;

type StorageKey = (typeof STORAGE_KEYS)[number];

export interface BackupBundle {
  app: "Start Tab";
  version: number;
  exportedAt: string;
  schema: {
    version: number;
    storageKeys: string[];
  };
  storage: Record<string, unknown>;
}

type LegacyBackupBundle = Omit<BackupBundle, "schema"> & { schema?: BackupBundle["schema"] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBackupLike(value: unknown): value is LegacyBackupBundle {
  return isRecord(value)
    && value.app === "Start Tab"
    && typeof value.version === "number"
    && Number.isInteger(value.version)
    && value.version >= 1
    && value.version <= BACKUP_VERSION
    && typeof value.exportedAt === "string"
    && isRecord(value.storage);
}

function withCurrentSchema(value: LegacyBackupBundle): BackupBundle {
  return {
    ...value,
    version: BACKUP_VERSION,
    schema: {
      version: BACKUP_VERSION,
      storageKeys: [...STORAGE_KEYS],
    },
    storage: { ...value.storage },
  };
}

function migrateBackup(value: LegacyBackupBundle): BackupBundle {
  let migrated: BackupBundle;

  switch (value.version) {
    case 1:
    case 2:
    case 3:
      migrated = withCurrentSchema(value);
      break;
    default:
      throw new Error(`Unsupported Start Tab backup version: ${value.version}`);
  }

  return migrated;
}

function importStorageValue(key: StorageKey, value: unknown): unknown {
  if (key === "blockedSites") return normalizeBlockedSites(value);
  if (key === "startPageSettings") return normalizeStartPageSettings(value);
  return value;
}

export async function exportBackup(): Promise<BackupBundle> {
  const storage = await chrome.storage.local.get([...STORAGE_KEYS]);
  return {
    app: "Start Tab",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    schema: {
      version: BACKUP_VERSION,
      storageKeys: [...STORAGE_KEYS],
    },
    storage,
  };
}

export async function importBackup(value: unknown): Promise<void> {
  if (!isBackupLike(value)) throw new Error("Invalid Start Tab backup file");
  const backup = migrateBackup(value);

  const nextStorage: Record<string, unknown> = {};
  for (const key of STORAGE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(backup.storage, key)) {
      nextStorage[key] = importStorageValue(key, backup.storage[key]);
    }
  }

  if (Object.keys(nextStorage).length > 0) await chrome.storage.local.set(nextStorage);
  const keysToRemove = STORAGE_KEYS.filter((key) => !Object.prototype.hasOwnProperty.call(nextStorage, key));
  if (keysToRemove.length > 0) await chrome.storage.local.remove(keysToRemove);
  await syncRules();
}

export function backupFileName(date = new Date()): string {
  return `start-tab-backup-${date.toISOString().slice(0, 10)}.json`;
}
