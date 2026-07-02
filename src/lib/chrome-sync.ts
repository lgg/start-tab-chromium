import { exportBackup, importBackup, type BackupBundle } from "./backup.js";

const META_KEY = "startTabSyncMeta";
const CHUNK_PREFIX = "startTabSyncChunk";
const CHUNK_SIZE = 7000;

interface SyncMeta {
  version: 1;
  updatedAt: string;
  chunks: number;
}

function chunkKey(index: number): string {
  return `${CHUNK_PREFIX}${index}`;
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
      version: 1,
      updatedAt: new Date().toISOString(),
      chunks: chunks.length,
    } satisfies SyncMeta,
  };
  for (let index = 0; index < chunks.length; index += 1) {
    payload[chunkKey(index)] = chunks[index] ?? "";
  }
  await chrome.storage.sync.set(payload);
}

export async function restoreChromeSyncBackup(): Promise<void> {
  const metaResult = await chrome.storage.sync.get(META_KEY);
  const meta = metaResult[META_KEY] as SyncMeta | undefined;
  if (!meta || meta.version !== 1 || meta.chunks <= 0) {
    throw new Error("No Start Tab backup found in chrome.storage.sync");
  }

  const keys = Array.from({ length: meta.chunks }, (_, index) => chunkKey(index));
  const chunks = await chrome.storage.sync.get(keys);
  const json = keys.map((key) => chunks[key]).join("");
  await importBackup(JSON.parse(json) as BackupBundle);
}
