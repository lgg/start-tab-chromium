import { exportBackup, importBackup, type BackupBundle } from "./backup.js";

const META_KEY = "startTabSyncMeta";
const CHUNK_PREFIX = "startTabSyncChunk";
const DEVICE_ID_KEY = "startTabDeviceId";
const CHUNK_SIZE = 7000;

export interface SyncMeta {
  version: 2;
  updatedAt: string;
  deviceId: string;
  checksum: string;
  chunks: number;
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

function isSyncMeta(value: unknown): value is SyncMeta {
  return typeof value === "object"
    && value !== null
    && (value as SyncMeta).version === 2
    && typeof (value as SyncMeta).updatedAt === "string"
    && typeof (value as SyncMeta).deviceId === "string"
    && typeof (value as SyncMeta).checksum === "string"
    && Number.isInteger((value as SyncMeta).chunks)
    && (value as SyncMeta).chunks > 0;
}

export async function getChromeSyncBackupMeta(): Promise<SyncMeta | null> {
  const metaResult = await chrome.storage.sync.get(META_KEY);
  const meta = metaResult[META_KEY];
  return isSyncMeta(meta) ? meta : null;
}

export async function uploadChromeSyncBackup(): Promise<void> {
  const json = JSON.stringify(await exportBackup());
  const chunks: string[] = [];
  for (let index = 0; index < json.length; index += CHUNK_SIZE) {
    chunks.push(json.slice(index, index + CHUNK_SIZE));
  }

  const existing = await chrome.storage.sync.get(META_KEY);
  const previousChunks = (existing[META_KEY] as Partial<SyncMeta> | undefined)?.chunks ?? 0;
  const removeKeys = Array.from({ length: previousChunks }, (_, index) => chunkKey(index));
  if (removeKeys.length > 0) await chrome.storage.sync.remove(removeKeys);

  const payload: Record<string, unknown> = {
    [META_KEY]: {
      version: 2,
      updatedAt: new Date().toISOString(),
      deviceId: await deviceId(),
      checksum: await checksum(json),
      chunks: chunks.length,
    } satisfies SyncMeta,
  };
  for (let index = 0; index < chunks.length; index += 1) {
    payload[chunkKey(index)] = chunks[index] ?? "";
  }
  await chrome.storage.sync.set(payload);
}

export async function restoreChromeSyncBackup(): Promise<void> {
  const meta = await getChromeSyncBackupMeta();
  if (!meta) {
    throw new Error("No Start Tab backup found in chrome.storage.sync");
  }

  const keys = Array.from({ length: meta.chunks }, (_, index) => chunkKey(index));
  const chunks = await chrome.storage.sync.get(keys);
  const json = keys.map((key) => chunks[key]).join("");
  if (await checksum(json) !== meta.checksum) {
    throw new Error("Chrome sync backup checksum mismatch");
  }
  await importBackup(JSON.parse(json) as BackupBundle);
}
