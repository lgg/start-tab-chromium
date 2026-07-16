import {
  BACKUP_VERSION,
  exportBackupSnapshot,
  importBackup,
  migrateBackup,
  type BackupBundle,
} from "./backup.js";
import {
  DATA_REVISION_KEY,
  markStartTabDataChanged,
} from "./data-revision.js";
import { FOCUS_STATS_KEY, normalizeFocusStats } from "./focus-stats.js";
import { normalizeRuntimeState } from "./start-page-runtime.js";
import { DEFAULT_SETTINGS, isRecord, normalizeStartPageSettings } from "./start-page-settings.js";
import { withStorageLock } from "./storage-lock.js";

const META_KEY = "startTabSyncMeta";
const LOCAL_META_KEY = "startTabLocalSyncMeta";
const CHUNK_PREFIX = "startTabSyncChunk";
const DEVICE_ID_KEY = "startTabDeviceId";
const DEFAULT_SYNC_ITEM_QUOTA_BYTES = 8192;
const DEFAULT_SYNC_TOTAL_QUOTA_BYTES = 102_400;
const MAX_SYNC_CHUNKS = 12;
const SYNC_META_VERSION = 3;

interface LegacySyncMeta { version: 2; updatedAt: string; deviceId: string; checksum: string; chunks: number }
export interface SyncMeta {
  version: typeof SYNC_META_VERSION; updatedAt: string; contentUpdatedAt: number; deviceId: string; snapshotId: string;
  checksum: string; contentChecksum: string; chunks: number; backupVersion: number;
}
interface ParsedMeta { meta: SyncMeta; legacy: boolean }
export type ChromeSyncResult = "uploaded" | "restored" | "unchanged";
export { DATA_REVISION_KEY, markStartTabDataChanged };

function chunkKey(index: number): string { return `${CHUNK_PREFIX}${index}`; }
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

const VOLATILE_CONTENT_KEYS = new Set(["updatedAt", "createdAt"]);
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value)
    .filter((key) => !VOLATILE_CONTENT_KEYS.has(key))
    .sort((left, right) => left.localeCompare(right))
    .map((key) => [key, canonicalValue(value[key])]));
}
function stableJson(value: unknown): string { return JSON.stringify(canonicalValue(value)); }
function canonicalBackupContent(bundle: BackupBundle): string {
  return stableJson({ app: bundle.app, version: bundle.version, schema: bundle.schema, storage: bundle.storage });
}
function legacyCanonicalBackupContent(bundle: BackupBundle): string {
  return JSON.stringify({ app: bundle.app, version: bundle.version, schema: bundle.schema, storage: bundle.storage });
}
function isPristineBackup(bundle: BackupBundle): boolean {
  const storage = bundle.storage;
  const settings = normalizeStartPageSettings(storage.startPageSettings);
  const defaults = normalizeStartPageSettings(DEFAULT_SETTINGS);
  if (stableJson(settings) !== stableJson(defaults)) return false;
  const runtime = normalizeRuntimeState(storage.startPageRuntimeState, settings);
  const defaultRuntime = normalizeRuntimeState(undefined, defaults);
  if (stableJson(runtime) !== stableJson(defaultRuntime)) return false;
  if (Array.isArray(storage.blockedSites) && storage.blockedSites.length > 0) return false;
  if (isRecord(storage.lastBlockedUrls) && Object.keys(storage.lastBlockedUrls).length > 0) return false;
  if (isRecord(storage.startPageOnboarding) && storage.startPageOnboarding.onboarded === true) return false;
  if (storage.localeOverride === "en" || storage.localeOverride === "ru") return false;
  if (Object.prototype.hasOwnProperty.call(storage, FOCUS_STATS_KEY)
    && stableJson(normalizeFocusStats(storage[FOCUS_STATS_KEY])) !== stableJson(normalizeFocusStats(undefined))) return false;
  return true;
}
function remoteWins(remote: SyncMeta, local: Awaited<ReturnType<typeof prepareSnapshot>>): boolean {
  if (remote.contentUpdatedAt !== local.contentUpdatedAt) return remote.contentUpdatedAt > local.contentUpdatedAt;
  return remote.contentChecksum.localeCompare(local.contentChecksum) > 0;
}
const utf8 = new TextEncoder();
function syncItemQuotaBytes(): number {
  const quota = chrome.storage.sync.QUOTA_BYTES_PER_ITEM;
  return typeof quota === "number" && Number.isFinite(quota) && quota > 0
    ? Math.floor(quota)
    : DEFAULT_SYNC_ITEM_QUOTA_BYTES;
}
function syncTotalQuotaBytes(): number {
  const quota = chrome.storage.sync.QUOTA_BYTES;
  return typeof quota === "number" && Number.isFinite(quota) && quota > 0
    ? Math.floor(quota)
    : DEFAULT_SYNC_TOTAL_QUOTA_BYTES;
}
function serializedStringCharacterBytes(character: string): number {
  const serialized = JSON.stringify(character);
  return utf8.encode(serialized.slice(1, -1)).byteLength;
}
export function chromeSyncItemBytes(key: string, value: unknown): number {
  return utf8.encode(key).byteLength + utf8.encode(JSON.stringify(value)).byteLength;
}
export function chromeSyncStorageBytes(items: Record<string, unknown>): number {
  return Object.entries(items).reduce((total, [key, value]) => total + chromeSyncItemBytes(key, value), 0);
}
export function chunkForChromeSync(value: string, quotaBytes = DEFAULT_SYNC_ITEM_QUOTA_BYTES): string[] {
  if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) throw new Error("Invalid browser sync item quota");
  const quota = Math.floor(quotaBytes);
  const chunks: string[] = [];
  let current = "";
  let currentBytes = chromeSyncItemBytes(chunkKey(0), "");
  for (const character of value) {
    const characterBytes = serializedStringCharacterBytes(character);
    if (current && currentBytes + characterBytes > quota) {
      chunks.push(current);
      current = "";
      currentBytes = chromeSyncItemBytes(chunkKey(chunks.length), "");
    }
    if (currentBytes + characterBytes > quota) {
      throw new Error("A Start Tab backup character cannot fit into one browser sync item");
    }
    current += character;
    currentBytes += characterBytes;
  }
  if (current || value.length === 0) chunks.push(current);
  return chunks;
}
function isIsoTimestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function isSha256Checksum(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function isLegacySyncMeta(value: unknown): value is LegacySyncMeta {
  return isRecord(value) && value.version === 2 && isIsoTimestamp(value.updatedAt)
    && typeof value.deviceId === "string" && value.deviceId.length > 0 && isSha256Checksum(value.checksum)
    && Number.isInteger(value.chunks) && (value.chunks as number) > 0 && (value.chunks as number) <= MAX_SYNC_CHUNKS;
}
function isFutureSyncMeta(value: unknown): boolean {
  if (!isRecord(value) || typeof value.version !== "number" || !Number.isInteger(value.version)) return false;
  if (value.version > SYNC_META_VERSION) return true;
  return value.version === SYNC_META_VERSION
    && typeof value.backupVersion === "number"
    && Number.isInteger(value.backupVersion)
    && value.backupVersion > BACKUP_VERSION;
}
function isSyncMeta(value: unknown): value is SyncMeta {
  return isRecord(value) && value.version === SYNC_META_VERSION && isIsoTimestamp(value.updatedAt)
    && typeof value.contentUpdatedAt === "number" && Number.isFinite(value.contentUpdatedAt) && value.contentUpdatedAt >= 0
    && typeof value.deviceId === "string" && value.deviceId.length > 0
    && typeof value.snapshotId === "string" && value.snapshotId.length > 0
    && isSha256Checksum(value.checksum) && isSha256Checksum(value.contentChecksum)
    && Number.isInteger(value.chunks) && (value.chunks as number) > 0 && (value.chunks as number) <= MAX_SYNC_CHUNKS
    && Number.isInteger(value.backupVersion) && (value.backupVersion as number) >= 1 && (value.backupVersion as number) <= BACKUP_VERSION;
}
function timestamp(value: string): number { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : 0; }
function normalizeLegacyMeta(meta: LegacySyncMeta): SyncMeta {
  return { version: SYNC_META_VERSION, updatedAt: meta.updatedAt, contentUpdatedAt: timestamp(meta.updatedAt), deviceId: meta.deviceId,
    snapshotId: `legacy-${meta.checksum.slice(0, 16)}`, checksum: meta.checksum, contentChecksum: "0".repeat(64),
    chunks: meta.chunks, backupVersion: 3 };
}
function parseMeta(value: unknown): ParsedMeta | null {
  if (isSyncMeta(value)) return { meta: value, legacy: false };
  return isLegacySyncMeta(value) ? { meta: normalizeLegacyMeta(value), legacy: true } : null;
}
function syncMetaEqual(left: SyncMeta, right: SyncMeta): boolean {
  return left.version === right.version
    && left.updatedAt === right.updatedAt
    && left.contentUpdatedAt === right.contentUpdatedAt
    && left.deviceId === right.deviceId
    && left.snapshotId === right.snapshotId
    && left.checksum === right.checksum
    && left.contentChecksum === right.contentChecksum
    && left.chunks === right.chunks
    && left.backupVersion === right.backupVersion;
}
function assertCompatibleSyncMeta(value: unknown, location: "remote" | "local"): void {
  if (isFutureSyncMeta(value)) {
    throw new Error(`The ${location} Start Tab sync metadata was created by a newer extension version`);
  }
}
async function readRemoteMeta(): Promise<ParsedMeta | null> {
  const result = await chrome.storage.sync.get(META_KEY);
  assertCompatibleSyncMeta(result[META_KEY], "remote");
  return parseMeta(result[META_KEY]);
}
async function readLocalMeta(): Promise<ParsedMeta | null> {
  const items = await chrome.storage.local.get(LOCAL_META_KEY);
  assertCompatibleSyncMeta(items[LOCAL_META_KEY], "local");
  return parseMeta(items[LOCAL_META_KEY]);
}
async function assertCompatibleSyncMetadata(): Promise<void> {
  await Promise.all([readRemoteMeta(), readLocalMeta()]);
}
async function writeLocalMeta(meta: SyncMeta): Promise<void> { await chrome.storage.local.set({ [LOCAL_META_KEY]: meta }); }
export async function getChromeSyncBackupMeta(): Promise<SyncMeta | null> { return (await readRemoteMeta())?.meta ?? null; }

async function prepareSnapshot(): Promise<{
  bundle: BackupBundle; json: string; chunks: string[]; checksum: string; contentChecksum: string; contentUpdatedAt: number;
}> {
  const captured = await exportBackupSnapshot();
  const bundle = captured.bundle;
  const json = JSON.stringify(bundle);
  const chunks = chunkForChromeSync(json, syncItemQuotaBytes());
  if (chunks.length > MAX_SYNC_CHUNKS) throw new Error("Start Tab backup is too large for browser sync. Use JSON export or Google Drive backup instead.");
  return { bundle, json, chunks, checksum: await checksum(json), contentChecksum: await checksum(canonicalBackupContent(bundle)),
    contentUpdatedAt: captured.dataRevision };
}
async function writeRemoteSnapshot(snapshot: Awaited<ReturnType<typeof prepareSnapshot>>): Promise<SyncMeta> {
  const existing = await chrome.storage.sync.get(null);
  assertCompatibleSyncMeta(existing[META_KEY], "remote");
  const meta: SyncMeta = { version: SYNC_META_VERSION, updatedAt: new Date().toISOString(), contentUpdatedAt: snapshot.contentUpdatedAt,
    deviceId: await deviceId(), snapshotId: snapshot.bundle.snapshotId, checksum: snapshot.checksum,
    contentChecksum: snapshot.contentChecksum, chunks: snapshot.chunks.length, backupVersion: snapshot.bundle.version };
  const payload: Record<string, unknown> = { [META_KEY]: meta };
  snapshot.chunks.forEach((chunk, index) => { payload[chunkKey(index)] = chunk; });
  const activeChunkKeys = new Set(snapshot.chunks.map((_, index) => chunkKey(index)));
  const staleKeys = Object.keys(existing).filter((key) => key.startsWith(CHUNK_PREFIX) && !activeChunkKeys.has(key));
  const finalState = { ...existing, ...payload };
  for (const key of staleKeys) delete finalState[key];
  const totalQuota = syncTotalQuotaBytes();
  if (chromeSyncStorageBytes(finalState) > totalQuota) {
    throw new Error("Start Tab backup is too large for the browser sync total quota. Use JSON export or Google Drive backup instead.");
  }

  const writeState = { ...existing, ...payload };
  let staleRemovedBeforeWrite = false;
  if (staleKeys.length > 0 && chromeSyncStorageBytes(writeState) > totalQuota) {
    await chrome.storage.sync.remove(staleKeys);
    staleRemovedBeforeWrite = true;
  }
  try {
    await chrome.storage.sync.set(payload);
  } catch (error) {
    if (staleRemovedBeforeWrite) {
      const rollback = Object.fromEntries(staleKeys.map((key) => [key, existing[key]]));
      try {
        await chrome.storage.sync.set(rollback);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Browser sync upload failed and stale-chunk rollback was incomplete");
      }
    }
    throw error;
  }
  if (!staleRemovedBeforeWrite && staleKeys.length > 0) await chrome.storage.sync.remove(staleKeys);
  const committed = await readRemoteMeta();
  if (!committed || committed.legacy || !syncMetaEqual(committed.meta, meta)) {
    throw new Error("Chrome sync backup changed concurrently before the upload commit was confirmed");
  }
  await writeLocalMeta(meta);
  return meta;
}
async function uploadChromeSyncBackupInTransaction(): Promise<void> { await writeRemoteSnapshot(await prepareSnapshot()); }
export async function uploadChromeSyncBackup(): Promise<void> {
  await withStorageLock("chrome-sync", async () => {
    await assertCompatibleSyncMetadata();
    await uploadChromeSyncBackupInTransaction();
  });
}
async function readRemoteBundle(parsed: ParsedMeta): Promise<BackupBundle> {
  const { meta } = parsed;
  const keys = Array.from({ length: meta.chunks }, (_, index) => chunkKey(index));
  const values = await chrome.storage.sync.get(keys);
  const chunks = keys.map((key) => values[key]);
  if (!chunks.every((chunk): chunk is string => typeof chunk === "string")) throw new Error("Chrome sync backup is incomplete");
  const json = chunks.join("");
  if (await checksum(json) !== meta.checksum) throw new Error("Chrome sync backup checksum mismatch");
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error("Chrome sync backup contains invalid JSON"); }
  const bundle = migrateBackup(value);
  if (!parsed.legacy) {
    const currentChecksum = await checksum(canonicalBackupContent(bundle));
    const legacyChecksum = await checksum(legacyCanonicalBackupContent(bundle));
    if (currentChecksum !== meta.contentChecksum && legacyChecksum !== meta.contentChecksum) throw new Error("Chrome sync backup content checksum mismatch");
  }
  return bundle;
}
async function restoreParsedSnapshot(parsed: ParsedMeta): Promise<void> {
  const bundle = await readRemoteBundle(parsed);
  const currentRemote = await readRemoteMeta();
  if (!currentRemote || currentRemote.legacy !== parsed.legacy || !syncMetaEqual(currentRemote.meta, parsed.meta)) {
    throw new Error("Chrome sync backup changed concurrently while it was being restored");
  }
  await importBackup(bundle, { dataRevisionAt: parsed.meta.contentUpdatedAt });
  if (parsed.legacy) await writeRemoteSnapshot(await prepareSnapshot());
  else await writeLocalMeta(parsed.meta);
}
async function restoreChromeSyncBackupInTransaction(): Promise<void> {
  const parsed = await readRemoteMeta();
  if (!parsed) throw new Error("No Start Tab backup found in chrome.storage.sync");
  await restoreParsedSnapshot(parsed);
}
export async function restoreChromeSyncBackup(): Promise<void> {
  await withStorageLock("chrome-sync", async () => {
    await assertCompatibleSyncMetadata();
    await restoreChromeSyncBackupInTransaction();
  });
}
async function syncChromeSyncBackupInTransaction(): Promise<ChromeSyncResult> {
  const remote = await readRemoteMeta();
  if (!remote) { await uploadChromeSyncBackupInTransaction(); return "uploaded"; }
  const localSnapshot = await prepareSnapshot();
  if (remote.legacy) {
    const remoteBundle = await readRemoteBundle(remote);
    const remoteChecksum = await checksum(canonicalBackupContent(remoteBundle));
    if (remoteChecksum === localSnapshot.contentChecksum) { await writeRemoteSnapshot(localSnapshot); return "unchanged"; }
    if (isPristineBackup(localSnapshot.bundle) || remote.meta.contentUpdatedAt > localSnapshot.contentUpdatedAt) {
      await restoreParsedSnapshot(remote); return "restored";
    }
    await writeRemoteSnapshot(localSnapshot); return "uploaded";
  }
  if (localSnapshot.contentChecksum === remote.meta.contentChecksum) { await writeLocalMeta(remote.meta); return "unchanged"; }
  const local = await readLocalMeta();
  if (!local || local.legacy) {
    if (isPristineBackup(localSnapshot.bundle) || remoteWins(remote.meta, localSnapshot)) { await restoreParsedSnapshot(remote); return "restored"; }
    await writeRemoteSnapshot(localSnapshot); return "uploaded";
  }
  const localChanged = localSnapshot.contentChecksum !== local.meta.contentChecksum;
  const remoteChanged = remote.meta.contentChecksum !== local.meta.contentChecksum;
  if (!localChanged && remoteChanged) { await restoreParsedSnapshot(remote); return "restored"; }
  if (localChanged && !remoteChanged) { await writeRemoteSnapshot(localSnapshot); return "uploaded"; }
  if (!localChanged && !remoteChanged) { await writeLocalMeta(remote.meta); return "unchanged"; }
  if (remoteWins(remote.meta, localSnapshot)) { await restoreParsedSnapshot(remote); return "restored"; }
  await writeRemoteSnapshot(localSnapshot);
  return "uploaded";
}
export async function syncChromeSyncBackup(): Promise<ChromeSyncResult> {
  return withStorageLock("chrome-sync", async () => {
    await assertCompatibleSyncMetadata();
    return syncChromeSyncBackupInTransaction();
  });
}
