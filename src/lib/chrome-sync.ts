import { exportBackup, importBackup, type BackupBundle } from "./backup.js";

const META_KEY = "startTabSyncMeta";
const LOCAL_META_KEY = "startTabLocalSyncMeta";
const CHUNK_PREFIX = "startTabSyncChunk";
const DEVICE_ID_KEY = "startTabDeviceId";
const CHUNK_MAX_BYTES = 7000;
const MAX_SYNC_CHUNKS = 12;

export interface SyncMeta {
  version: 2;
  updatedAt: string;
  deviceId: string;
  checksum: string;
  chunks: number;
}

export type ChromeSyncResult = "uploaded" | "restored";

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

function isSyncMeta(value: unknown): value is SyncMeta {
  return typeof value === "object"
    && value !== null
    && (value as SyncMeta).version === 2
    && isIsoTimestamp((value as SyncMeta).updatedAt)
    && typeof (value as SyncMeta).deviceId === "string"
    && (value as SyncMeta).deviceId.length > 0
    && isSha256Checksum((value as SyncMeta).checksum)
    && Number.isInteger((value as SyncMeta).chunks)
    && (value as SyncMeta).chunks > 0
    && (value as SyncMeta).chunks <= MAX_SYNC_CHUNKS;
}

async function readLocalMeta(): Promise<SyncMeta | null> {
  const items = await chrome.storage.local.get(LOCAL_META_KEY);
  const value = items[LOCAL_META_KEY];
  return isSyncMeta(value) ? value : null;
}

async function writeLocalMeta(meta: SyncMeta): Promise<void> {
  await chrome.storage.local.set({ [LOCAL_META_KEY]: meta });
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getChromeSyncBackupMeta(): Promise<SyncMeta | null> {
  const metaResult = await chrome.storage.sync.get(META_KEY);
  const meta = metaResult[META_KEY];
  return isSyncMeta(meta) ? meta : null;
}

export async function uploadChromeSyncBackup(): Promise<void> {
  const json = JSON.stringify(await exportBackup());
  const chunks = chunkForChromeSync(json);

  if (chunks.length > MAX_SYNC_CHUNKS) {
    throw new Error("Start Tab backup is too large for browser sync. Use JSON export or Google Drive backup instead.");
  }

  const existing = await chrome.storage.sync.get(META_KEY);
  const previousChunks = isSyncMeta(existing[META_KEY]) ? existing[META_KEY].chunks : 0;
  const meta: SyncMeta = {
    version: 2,
    updatedAt: new Date().toISOString(),
    deviceId: await deviceId(),
    checksum: await checksum(json),
    chunks: chunks.length,
  };
  const payload: Record<string, unknown> = { [META_KEY]: meta };
  for (let index = 0; index < chunks.length; index += 1) {
    payload[chunkKey(index)] = chunks[index] ?? "";
  }
  await chrome.storage.sync.set(payload);
  const staleKeys = Array.from(
    { length: Math.max(0, previousChunks - chunks.length) },
    (_, index) => chunkKey(index + chunks.length),
  );
  if (staleKeys.length > 0) await chrome.storage.sync.remove(staleKeys);
  await writeLocalMeta(meta);
}

export async function restoreChromeSyncBackup(): Promise<void> {
  const meta = await getChromeSyncBackupMeta();
  if (!meta) {
    throw new Error("No Start Tab backup found in chrome.storage.sync");
  }

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
  await importBackup(JSON.parse(json) as BackupBundle);
  await writeLocalMeta(meta);
}

export async function syncChromeSyncBackup(): Promise<ChromeSyncResult> {
  const remoteMeta = await getChromeSyncBackupMeta();
  if (!remoteMeta) {
    await uploadChromeSyncBackup();
    return "uploaded";
  }

  const localMeta = await readLocalMeta();
  if (!localMeta || timestamp(remoteMeta.updatedAt) > timestamp(localMeta.updatedAt)) {
    await restoreChromeSyncBackup();
    return "restored";
  }

  await uploadChromeSyncBackup();
  return "uploaded";
}
