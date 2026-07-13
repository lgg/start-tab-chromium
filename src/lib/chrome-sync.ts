import {
  BACKUP_VERSION,
  backupModifiedAt,
  exportBackup,
  importBackup,
  migrateBackup,
  type BackupBundle,
} from "./backup.js";
import { isRecord } from "./start-page-settings.js";

const META_KEY = "startTabSyncMeta";
const LOCAL_META_KEY = "startTabLocalSyncMeta";
const CHUNK_PREFIX = "startTabSyncChunk";
const DEVICE_ID_KEY = "startTabDeviceId";
export const DATA_REVISION_KEY = "startTabDataRevision";
const CHUNK_MAX_BYTES = 7000;
const MAX_SYNC_CHUNKS = 12;

interface LegacySyncMeta {
  version: 2;
  updatedAt: string;
  deviceId: string;
  checksum: string;
  chunks: number;
}

export interface SyncMeta {
  version: 3;
  updatedAt: string;
  contentUpdatedAt: number;
  deviceId: string;
  snapshotId: string;
  checksum: string;
  contentChecksum: string;
  chunks: number;
  backupVersion: number;
}

export type ChromeSyncResult = "uploaded" | "restored" | "unchanged";

interface DataRevision {
  version: 1;
  updatedAt: number;
}

function chunkKey(index: number): string {
  return `${CHUNK_PREFIX}${index}`;
}

async function deviceId(): Promise<string> {
  const items = await chrome.storage.local.get(DEVICE_ID_KEY);
  const existing = items[DEVICE_ID_KEY];
  if (typeof existing === "string" && existing) return existing;
  const created = crypto.randomUUID();
  await chrome.storage.local.set({ [DEVICE_ID_KEY]: created });
  return created;
}

async function checksum(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalBackupContent(bundle: BackupBundle): string {
  return JSON.stringify({
    app: bundle.app,
    version: bundle.version,
    schema: bundle.schema,
    storage: bundle.storage,
  });
}

function chunkForChromeSync(value: string): string[] {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const char of value) {
    const charBytes = encoder.encode(char).byteLength;
    if (current && currentBytes + charBytes > CHUNK_MAX_BYTES) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += charBytes;
  }

  if (current || value.length === 0) chunks.push(current);
  return chunks;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isSha256Checksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isLegacySyncMeta(value: unknown): value is LegacySyncMeta {
  return isRecord(value)
    && value.version === 2
    && isIsoTimestamp(value.updatedAt)
    && typeof value.deviceId === "string"
    && value.deviceId.length > 0
    && isSha256Checksum(value.checksum)
    && Number.isInteger(value.chunks)
    && (value.chunks as number) > 0
    && (value.chunks as number) <= MAX_SYNC_CHUNKS;
}

function isSyncMeta(value: unknown): value is SyncMeta {
  return isRecord(value)
    && value.version === 3
    && isIsoTimestamp(value.updatedAt)
    && typeof value.contentUpdatedAt === "number"
    && Number.isFinite(value.contentUpdatedAt)
    && value.contentUpdatedAt >= 0
    && typeof value.deviceId === "string"
    && value.deviceId.length > 0
    && typeof value.snapshotId === "string"
    && value.snapshotId.length > 0
    && isSha256Checksum(value.checksum)
    && isSha256Checksum(value.contentChecksum)
    && Number.isInteger(value.chunks)
    && (value.chunks as number) > 0
    && (value.chunks as number) <= MAX_SYNC_CHUNKS
    && Number.isInteger(value.backupVersion)
    && (value.backupVersion as number) >= 1
    && (value.backupVersion as number) <= BACKUP_VERSION;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLegacyMeta(meta: LegacySyncMeta): SyncMeta {
  return {
    version: 3,
    updatedAt: meta.updatedAt,
    contentUpdatedAt: timestamp(meta.updatedAt),
    deviceId: meta.deviceId,
    snapshotId: `legacy-${meta.checksum.slice(0, 16)}`,
    checksum: meta.checksum,
    contentChecksum: meta.checksum,
    chunks: meta.chunks,
    backupVersion: 3,
  };
}

function parseMeta(value: unknown): SyncMeta | null {
  if (isSyncMeta(value)) return value;
  return isLegacySyncMeta(value) ? normalizeLegacyMeta(value) : null;
}

async function readLocalMeta(): Promise<SyncMeta | null> {
  const items = await chrome.storage.local.get(LOCAL_META_KEY);
  return parseMeta(items[LOCAL_META_KEY]);
}

async function writeLocalMeta(meta: SyncMeta): Promise<void> {
  await chrome.storage.local.set({ [LOCAL_META_KEY]: meta });
}

async function readDataRevision(bundle: BackupBundle): Promise<number> {
  const items = await chrome.storage.local.get(DATA_REVISION_KEY);
  const revision = items[DATA_REVISION_KEY];
  if (isRecord(revision) && revision.version === 1 && typeof revision.updatedAt === "number" && Number.isFinite(revision.updatedAt)) {
    return Math.max(0, revision.updatedAt);
  }
  return backupModifiedAt(bundle);
}

export async function markStartTabDataChanged(at = Date.now()): Promise<void> {
  const revision: DataRevision = { version: 1, updatedAt: Math.max(0, Math.round(at)) };
  await chrome.storage.local.set({ [DATA_REVISION_KEY]: revision });
}

export async function getChromeSyncBackupMeta(): Promise<SyncMeta | null> {
  const metaResult = await chrome.storage.sync.get(META_KEY);
  return parseMeta(metaResult[META_KEY]);
}

async function prepareSnapshot(bundle = await exportBackup()): Promise<{
  bundle: BackupBundle;
  json: string;
  chunks: string[];
  checksum: string;
  contentChecksum: string;
  contentUpdatedAt: number;
}> {
  const json = JSON.stringify(bundle);
  const chunks = chunkForChromeSync(json);
  if (chunks.length > MAX_SYNC_CHUNKS) {
    throw new Error("Start Tab backup is too large for browser sync. Use JSON export or Google Drive backup instead.");
  }
  return {
    bundle,
    json,
    chunks,
    checksum: await checksum(json),
    contentChecksum: await checksum(canonicalBackupContent(bundle)),
    contentUpdatedAt: await readDataRevision(bundle),
  };
}

async function writeRemoteSnapshot(snapshot: Awaited<ReturnType<typeof prepareSnapshot>>): Promise<SyncMeta> {
  const existing = await chrome.storage.sync.get(META_KEY);
  const previousChunks = parseMeta(existing[META_KEY])?.chunks ?? 0;
  const meta: SyncMeta = {
    version: 3,
    updatedAt: new Date().toISOString(),
    contentUpdatedAt: snapshot.contentUpdatedAt,
    deviceId: await deviceId(),
    snapshotId: snapshot.bundle.snapshotId,
    checksum: snapshot.checksum,
    contentChecksum: snapshot.contentChecksum,
    chunks: snapshot.chunks.length,
    backupVersion: snapshot.bundle.version,
  };
  const payload: Record<string, unknown> = { [META_KEY]: meta };
  for (let index = 0; index < snapshot.chunks.length; index += 1) {
    payload[chunkKey(index)] = snapshot.chunks[index] ?? "";
  }
  await chrome.storage.sync.set(payload);
  const staleKeys = Array.from(
    { length: Math.max(0, previousChunks - snapshot.chunks.length) },
    (_, index) => chunkKey(index + snapshot.chunks.length),
  );
  if (staleKeys.length > 0) await chrome.storage.sync.remove(staleKeys);
  await writeLocalMeta(meta);
  return meta;
}

export async function uploadChromeSyncBackup(): Promise<void> {
  await writeRemoteSnapshot(await prepareSnapshot());
}

async function readRemoteBundle(meta: SyncMeta): Promise<BackupBundle> {
  const keys = Array.from({ length: meta.chunks }, (_, index) => chunkKey(index));
  const chunkValues = await chrome.storage.sync.get(keys);
  const chunks = keys.map((key) => chunkValues[key]);
  if (!chunks.every((chunk): chunk is string => typeof chunk === "string")) {
    throw new Error("Chrome sync backup is incomplete");
  }
  const json = chunks.join("");
  if (await checksum(json) !== meta.checksum) {
    throw new Error("Chrome sync backup checksum mismatch");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Chrome sync backup contains invalid JSON");
  }
  const bundle = migrateBackup(parsed);
  if (meta.version === 3 && await checksum(canonicalBackupContent(bundle)) !== meta.contentChecksum) {
    throw new Error("Chrome sync backup content checksum mismatch");
  }
  return bundle;
}

export async function restoreChromeSyncBackup(): Promise<void> {
  const meta = await getChromeSyncBackupMeta();
  if (!meta) throw new Error("No Start Tab backup found in chrome.storage.sync");
  const bundle = await readRemoteBundle(meta);
  await importBackup(bundle);
  await markStartTabDataChanged(meta.contentUpdatedAt);
  await writeLocalMeta(meta);
}

export async function syncChromeSyncBackup(): Promise<ChromeSyncResult> {
  const remoteMeta = await getChromeSyncBackupMeta();
  if (!remoteMeta) {
    await uploadChromeSyncBackup();
    return "uploaded";
  }

  const localSnapshot = await prepareSnapshot();
  if (localSnapshot.contentChecksum === remoteMeta.contentChecksum) {
    await writeLocalMeta(remoteMeta);
    return "unchanged";
  }

  const localMeta = await readLocalMeta();
  if (!localMeta) {
    if (remoteMeta.contentUpdatedAt > localSnapshot.contentUpdatedAt) {
      await restoreChromeSyncBackup();
      return "restored";
    }
    await writeRemoteSnapshot(localSnapshot);
    return "uploaded";
  }

  const localChanged = localSnapshot.contentChecksum !== localMeta.contentChecksum;
  const remoteChanged = remoteMeta.contentChecksum !== localMeta.contentChecksum;

  if (!localChanged && remoteChanged) {
    await restoreChromeSyncBackup();
    return "restored";
  }
  if (localChanged && !remoteChanged) {
    await writeRemoteSnapshot(localSnapshot);
    return "uploaded";
  }
  if (!localChanged && !remoteChanged) {
    await writeLocalMeta(remoteMeta);
    return "unchanged";
  }

  if (remoteMeta.contentUpdatedAt > localSnapshot.contentUpdatedAt) {
    await restoreChromeSyncBackup();
    return "restored";
  }
  await writeRemoteSnapshot(localSnapshot);
  return "uploaded";
}
