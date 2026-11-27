import {
  BACKUP_VERSION,
  LOCAL_SYNC_META_KEY,
  exportBackupSnapshot,
  importBackup,
  migrateBackup,
  type BackupBundle,
  type ExportedBackupSnapshot,
} from "./backup.js";
import {
  DATA_REVISION_KEY,
  StartTabDataRevisionConflictError,
  assertStartTabDataRevisionUnchanged,
  markStartTabDataChanged,
} from "./data-revision.js";
import { jsonContentEqual } from "./json-content.js";
import { FOCUS_STATS_KEY, normalizeFocusStats } from "./focus-stats.js";
import { normalizeRuntimeState } from "./start-page-runtime.js";
import { DEFAULT_SETTINGS, isRecord, normalizeStartPageSettings } from "./start-page-settings.js";
import { withStorageLock } from "./storage-lock.js";

const META_KEY = "startTabSyncMeta";
const LOCAL_META_KEY = LOCAL_SYNC_META_KEY;
const CHUNK_PREFIX = "startTabSyncChunk";
const DEVICE_ID_KEY = "startTabDeviceId";
const DEFAULT_SYNC_ITEM_QUOTA_BYTES = 8192;
const DEFAULT_SYNC_TOTAL_QUOTA_BYTES = 102_400;
const MAX_SYNC_CHUNKS = 12;
const SYNC_META_VERSION = 3;
const MAX_LOCAL_REVISION_RETRIES = 3;

interface LegacySyncMeta { version: 2; updatedAt: string; deviceId: string; checksum: string; chunks: number }
export interface SyncMeta {
  version: typeof SYNC_META_VERSION; updatedAt: string; contentUpdatedAt: number; deviceId: string; snapshotId: string;
  checksum: string; contentChecksum: string; chunks: number; backupVersion: number;
}
interface ParsedMeta { meta: SyncMeta; legacy: boolean }
interface LocalRevisionGuard { dataRevision: number; dataRevisionFallback: number; storedDataRevision: number | null }
class ChromeSyncRemoteConflictError extends Error {
  constructor() {
    super("Chrome sync remote backup changed before the selected upload could commit");
    this.name = "ChromeSyncRemoteConflictError";
  }
}
export type ChromeSyncResult = "uploaded" | "restored" | "unchanged";
export { DATA_REVISION_KEY, markStartTabDataChanged };

function chunkKey(index: number): string { return `${CHUNK_PREFIX}${index}`; }
export function completeChromeSyncPayload(meta: SyncMeta, chunks: readonly string[]): Record<string, unknown> {
  if (chunks.length < 1 || chunks.length > MAX_SYNC_CHUNKS || meta.chunks !== chunks.length) throw new Error("Invalid Browser Sync chunk frame");
  const payload: Record<string, unknown> = { [META_KEY]: meta };
  for (let index = 0; index < MAX_SYNC_CHUNKS; index += 1) {
    payload[chunkKey(index)] = chunks[index] ?? "";
  }
  return payload;
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

type CanonicalPath = readonly string[];
const VOLATILE_CONTENT_KEYS = new Set(["updatedAt", "createdAt"]);

function pathMatches(path: CanonicalPath, expected: readonly string[]): boolean {
  return path.length === expected.length
    && expected.every((part, index) => part === "*" || path[index] === part);
}

/** Remove generated timestamps only from known schema entities, never from user-keyed dictionaries. */
function isVolatileTimestampField(path: CanonicalPath, key: string): boolean {
  if (!VOLATILE_CONTENT_KEYS.has(key)) return false;
  if (pathMatches(path, ["storage", "startPageSettings"])) return key === "updatedAt";
  if (pathMatches(path, ["storage", "startPageSettings", "layout", "blocks", "[]"])) return true;
  if (pathMatches(path, ["storage", "startPageSettings", "themes", "customThemes", "[]"])) return true;
  if (pathMatches(path, ["storage", "startPageRuntimeState"])) return key === "updatedAt";
  return pathMatches(path, ["storage", "startPageRuntimeState", "tasks", "*", "[]"]);
}

function canonicalValue(value: unknown, path: CanonicalPath = []): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item, [...path, "[]"]));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value)
    .filter((key) => !isVolatileTimestampField(path, key))
    .sort()
    .map((key) => [key, canonicalValue(value[key], [...path, key])]));
}

/** Previous v3 checksum behavior retained only to verify already-uploaded snapshots. */
function previousCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(previousCanonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value)
    .filter((key) => !VOLATILE_CONTENT_KEYS.has(key))
    .sort()
    .map((key) => [key, previousCanonicalValue(value[key])]));
}

function canonicalJson(value: unknown, path: CanonicalPath): string { return JSON.stringify(canonicalValue(value, path)); }
export function canonicalBackupContent(bundle: BackupBundle): string {
  return JSON.stringify(canonicalValue({ app: bundle.app, version: bundle.version, schema: bundle.schema, storage: bundle.storage }));
}
export function previousCanonicalBackupContent(bundle: BackupBundle): string {
  return JSON.stringify(previousCanonicalValue({ app: bundle.app, version: bundle.version, schema: bundle.schema, storage: bundle.storage }));
}
function legacyCanonicalBackupContent(bundle: BackupBundle): string {
  return JSON.stringify({ app: bundle.app, version: bundle.version, schema: bundle.schema, storage: bundle.storage });
}
function isPristineBackup(bundle: BackupBundle): boolean {
  const storage = bundle.storage;
  const settings = normalizeStartPageSettings(storage.startPageSettings);
  const defaults = normalizeStartPageSettings(DEFAULT_SETTINGS);
  if (canonicalJson(settings, ["storage", "startPageSettings"])
    !== canonicalJson(defaults, ["storage", "startPageSettings"])) return false;
  const runtime = normalizeRuntimeState(storage.startPageRuntimeState, settings);
  const defaultRuntime = normalizeRuntimeState(undefined, defaults);
  if (canonicalJson(runtime, ["storage", "startPageRuntimeState"])
    !== canonicalJson(defaultRuntime, ["storage", "startPageRuntimeState"])) return false;
  if (Array.isArray(storage.blockedSites) && storage.blockedSites.length > 0) return false;
  if (isRecord(storage.lastBlockedUrls) && Object.keys(storage.lastBlockedUrls).length > 0) return false;
  if (isRecord(storage.startPageOnboarding) && storage.startPageOnboarding.onboarded === true) return false;
  if (storage.localeOverride === "en" || storage.localeOverride === "ru") return false;
  if (Object.prototype.hasOwnProperty.call(storage, FOCUS_STATS_KEY)
    && !jsonContentEqual(normalizeFocusStats(storage[FOCUS_STATS_KEY]), normalizeFocusStats(undefined))) return false;
  return true;
}
function remoteWins(remote: SyncMeta, local: Awaited<ReturnType<typeof prepareSnapshot>>): boolean {
  if (remote.contentUpdatedAt !== local.contentUpdatedAt) return remote.contentUpdatedAt > local.contentUpdatedAt;
  return remote.contentChecksum > local.contentChecksum;
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
    && typeof value.contentUpdatedAt === "number" && Number.isSafeInteger(value.contentUpdatedAt) && value.contentUpdatedAt >= 0 && value.contentUpdatedAt < Number.MAX_SAFE_INTEGER
    && typeof value.deviceId === "string" && value.deviceId.length > 0
    && typeof value.snapshotId === "string" && value.snapshotId.length > 0
    && isSha256Checksum(value.checksum) && isSha256Checksum(value.contentChecksum)
    && Number.isInteger(value.chunks) && (value.chunks as number) > 0 && (value.chunks as number) <= MAX_SYNC_CHUNKS
    && Number.isInteger(value.backupVersion) && (value.backupVersion as number) >= 1 && (value.backupVersion as number) <= BACKUP_VERSION;
}
function normalizeLegacyMeta(meta: LegacySyncMeta): SyncMeta {
  return { version: SYNC_META_VERSION, updatedAt: meta.updatedAt, contentUpdatedAt: Date.parse(meta.updatedAt), deviceId: meta.deviceId,
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
function parsedMetaEqual(left: ParsedMeta | null, right: ParsedMeta | null): boolean {
  if (left === null || right === null) return left === right;
  return left.legacy === right.legacy && syncMetaEqual(left.meta, right.meta);
}
function assertCompatibleSyncMeta(value: unknown, location: "remote" | "local"): void {
  if (isFutureSyncMeta(value)) {
    throw new Error(`The ${location} Start Tab sync metadata was created by a newer extension version`);
  }
  if (isRecord(value) && value.version === SYNC_META_VERSION
    && (typeof value.contentUpdatedAt !== "number" || !Number.isSafeInteger(value.contentUpdatedAt)
      || value.contentUpdatedAt < 0 || value.contentUpdatedAt >= Number.MAX_SAFE_INTEGER)) {
    throw new Error(`The ${location} Start Tab sync metadata contains an invalid data revision`);
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
  dataRevisionFallback: number; storedDataRevision: number | null;
}> {
  const captured = await exportBackupSnapshot();
  // exportBackupSnapshot captures and validates the revision under data-write.
  // Keep the revision invariant in its allocator/reader, not in every consumer.
  const bundle = captured.bundle;
  const json = JSON.stringify(bundle);
  const chunks = chunkForChromeSync(json, syncItemQuotaBytes());
  if (chunks.length > MAX_SYNC_CHUNKS) throw new Error("Start Tab backup is too large for browser sync. Use JSON export or Google Drive backup instead.");
  return { bundle, json, chunks, checksum: await checksum(json), contentChecksum: await checksum(canonicalBackupContent(bundle)),
    contentUpdatedAt: captured.dataRevision, dataRevisionFallback: captured.dataRevisionFallback, storedDataRevision: captured.storedDataRevision };
}

async function captureLocalRevisionGuard(): Promise<LocalRevisionGuard> {
  const captured: ExportedBackupSnapshot = await exportBackupSnapshot();
  return { dataRevision: captured.dataRevision, dataRevisionFallback: captured.dataRevisionFallback, storedDataRevision: captured.storedDataRevision };
}

async function assertLocalRevisionGuard(
  guard: LocalRevisionGuard,
  message: string,
  meta?: SyncMeta,
): Promise<void> {
  await withStorageLock("data-write", async () => {
    await assertStartTabDataRevisionUnchanged(guard.dataRevision, guard.dataRevisionFallback, message, guard.storedDataRevision);
    // Do not release the local data lock between accepting a snapshot and
    // persisting its sync metadata.
    if (meta) await writeLocalMeta(meta);
  });
}

function snapshotRevisionGuard(snapshot: Awaited<ReturnType<typeof prepareSnapshot>>): LocalRevisionGuard {
  return { dataRevision: snapshot.contentUpdatedAt, dataRevisionFallback: snapshot.dataRevisionFallback, storedDataRevision: snapshot.storedDataRevision };
}

async function retrySyncConflicts<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof StartTabDataRevisionConflictError) && !(error instanceof ChromeSyncRemoteConflictError)) throw error;
      if (attempt >= MAX_LOCAL_REVISION_RETRIES) throw error;
    }
  }
}

/** Metadata and chunks can arrive independently from Chrome Sync. A smart
 * upload may claim a missing frame only when there is no remote evidence.
 * An explicit Upload intentionally replaces an older/corrupt backup. */
function assertEmptyRemoteFrame(storage: Record<string, unknown>): void {
  if (Object.hasOwn(storage, META_KEY) || Object.keys(storage).some((key) =>
    key.startsWith(CHUNK_PREFIX) && /^\d+$/.test(key.slice(CHUNK_PREFIX.length)) && storage[key] !== "")) {
    throw new Error("Chrome sync backup metadata or chunks are incomplete; retry sync after the remote backup arrives, or use explicit Upload to replace it");
  }
}

async function writeRemoteSnapshot(
  snapshot: Awaited<ReturnType<typeof prepareSnapshot>>,
  expectedRemote?: ParsedMeta | null,
): Promise<SyncMeta> {
  const existing = await chrome.storage.sync.get(null);
  assertCompatibleSyncMeta(existing[META_KEY], "remote");
  if (expectedRemote !== undefined && !parsedMetaEqual(parseMeta(existing[META_KEY]), expectedRemote)) {
    throw new ChromeSyncRemoteConflictError();
  }
  if (expectedRemote === null) assertEmptyRemoteFrame(existing);
  const meta: SyncMeta = { version: SYNC_META_VERSION, updatedAt: new Date().toISOString(), contentUpdatedAt: snapshot.contentUpdatedAt,
    deviceId: await deviceId(), snapshotId: snapshot.bundle.snapshotId, checksum: snapshot.checksum,
    contentChecksum: snapshot.contentChecksum, chunks: snapshot.chunks.length, backupVersion: snapshot.bundle.version };
  const payload = completeChromeSyncPayload(meta, snapshot.chunks);
  const finalState = { ...existing, ...payload };
  const totalQuota = syncTotalQuotaBytes();
  if (chromeSyncStorageBytes(finalState) > totalQuota) {
    throw new Error("Start Tab backup is too large for the browser sync total quota. Use JSON export or Google Drive backup instead.");
  }

  const guard = snapshotRevisionGuard(snapshot);
  await assertLocalRevisionGuard(guard, "Start Tab data changed before the Browser Sync upload could commit");
  // Chrome Sync is not a distributed CAS service. Revalidate any remotely
  // observed decision as late as possible, before overwriting the frame.
  if (expectedRemote === null) {
    // Repeat the full-frame absence check immediately before writing. Chunks
    // alone may have arrived since the quota read without changing metadata.
    const current = await chrome.storage.sync.get(null);
    assertCompatibleSyncMeta(current[META_KEY], "remote");
    if (parseMeta(current[META_KEY]) !== null) throw new ChromeSyncRemoteConflictError();
    assertEmptyRemoteFrame(current);
  } else if (expectedRemote !== undefined) {
    if (!parsedMetaEqual(await readRemoteMeta(), expectedRemote)) throw new ChromeSyncRemoteConflictError();
  } else {
    // Explicit Upload may replace a damaged/older frame, but not future
    // metadata that arrived after the initial full-frame compatibility check.
    await readRemoteMeta();
  }
  await chrome.storage.sync.set(payload);
  const committed = await readRemoteMeta();
  if (!committed || committed.legacy || !syncMetaEqual(committed.meta, meta)) {
    throw new Error("Chrome sync backup changed concurrently before the upload commit was confirmed");
  }
  await readVerifiedRemoteBundle(committed);
  await assertLocalRevisionGuard(guard, "Start Tab data changed while the Browser Sync upload was committing", meta);
  return meta;
}
async function uploadChromeSyncBackupInTransaction(expectedRemote?: ParsedMeta | null): Promise<void> {
  await writeRemoteSnapshot(await prepareSnapshot(), expectedRemote);
}
export async function uploadChromeSyncBackup(): Promise<void> {
  await withStorageLock("chrome-sync", async () => {
    await assertCompatibleSyncMetadata();
    await retrySyncConflicts(uploadChromeSyncBackupInTransaction);
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
    const rawBundle = value as BackupBundle;
    const acceptedChecksums = await Promise.all([
      checksum(canonicalBackupContent(rawBundle)),
      checksum(previousCanonicalBackupContent(rawBundle)),
      checksum(legacyCanonicalBackupContent(rawBundle)),
      checksum(canonicalBackupContent(bundle)),
      checksum(previousCanonicalBackupContent(bundle)),
      checksum(legacyCanonicalBackupContent(bundle)),
    ]);
    if (!acceptedChecksums.includes(meta.contentChecksum)) {
      throw new Error("Chrome sync backup content checksum mismatch");
    }
  }
  return bundle;
}
async function assertRemoteMetaUnchanged(parsed: ParsedMeta, message: string): Promise<void> {
  if (!parsedMetaEqual(await readRemoteMeta(), parsed)) throw new Error(message);
}
async function readVerifiedRemoteBundle(parsed: ParsedMeta): Promise<BackupBundle> {
  const bundle = await readRemoteBundle(parsed);
  await assertRemoteMetaUnchanged(parsed, "Chrome sync backup changed concurrently while it was being verified");
  return bundle;
}
async function restoreParsedSnapshot(parsed: ParsedMeta, guard: LocalRevisionGuard): Promise<void> {
  const bundle = await readVerifiedRemoteBundle(parsed);
  // Capture the canonical baseline of the content actually restored, even
  // for a legacy frame whose metadata has no semantic content checksum.
  const restoredChecksum = await checksum(canonicalBackupContent(bundle));
  await importBackup(bundle, {
    dataRevisionAt: parsed.meta.contentUpdatedAt,
    expectedCurrentDataRevision: guard.dataRevision,
    expectedCurrentDataRevisionFallback: guard.dataRevisionFallback,
    expectedCurrentStoredDataRevision: guard.storedDataRevision,
    revisionConflictMessage: "Start Tab data changed while the Browser Sync restore was being prepared",
    syncBaseline: parsed.legacy ? { ...parsed.meta, contentChecksum: restoredChecksum, backupVersion: bundle.version } : parsed.meta,
  });
  if (parsed.legacy) {
    // Import is already committed. Never retry the destructive decision if
    // the optional legacy-frame upgrade conflicts with a subsequent edit.
    try {
      const snapshot = await prepareSnapshot();
      if (snapshot.contentChecksum !== restoredChecksum) return;
      await writeRemoteSnapshot(snapshot, parsed);
    } catch (error) {
      if (!(error instanceof StartTabDataRevisionConflictError) && !(error instanceof ChromeSyncRemoteConflictError)) {
        throw new Error("Browser Sync restore committed, but legacy metadata upgrade failed", { cause: error });
      }
    }
  }
}
async function restoreChromeSyncBackupInTransaction(guard: LocalRevisionGuard): Promise<void> {
  const parsed = await readRemoteMeta();
  if (!parsed) {
    const current = await chrome.storage.sync.get(null);
    assertCompatibleSyncMeta(current[META_KEY], "remote");
    if (parseMeta(current[META_KEY])) {
      throw new Error("Chrome sync backup changed while restore was being prepared; retry restore");
    }
    // Unlike explicit upload, restore cannot use an incomplete frame.
    // Distinguish missing data from existing damaged/partly replicated data.
    assertEmptyRemoteFrame(current);
    throw new Error("No Start Tab backup found in chrome.storage.sync");
  }
  await restoreParsedSnapshot(parsed, guard);
}
export async function restoreChromeSyncBackup(): Promise<void> {
  const guard = await captureLocalRevisionGuard();
  await withStorageLock("chrome-sync", async () => {
    await assertCompatibleSyncMetadata();
    await restoreChromeSyncBackupInTransaction(guard);
  });
}
async function syncChromeSyncBackupInTransaction(): Promise<ChromeSyncResult> {
  const remote = await readRemoteMeta();
  if (!remote) { await uploadChromeSyncBackupInTransaction(null); return "uploaded"; }
  const localSnapshot = await prepareSnapshot();
  const guard = snapshotRevisionGuard(localSnapshot);
  if (remote.legacy) {
    const remoteBundle = await readVerifiedRemoteBundle(remote);
    const remoteChecksum = await checksum(canonicalBackupContent(remoteBundle));
    if (remoteChecksum === localSnapshot.contentChecksum) { await writeRemoteSnapshot(localSnapshot, remote); return "unchanged"; }
    if (isPristineBackup(localSnapshot.bundle) || remote.meta.contentUpdatedAt > localSnapshot.contentUpdatedAt) {
      await restoreParsedSnapshot(remote, guard); return "restored";
    }
    await writeRemoteSnapshot(localSnapshot, remote); return "uploaded";
  }
  if (localSnapshot.contentChecksum === remote.meta.contentChecksum) {
    try {
      await readVerifiedRemoteBundle(remote);
    } catch (error) {
      let currentRemote: ParsedMeta | null;
      try {
        currentRemote = await readRemoteMeta();
      } catch (metadataError) {
        throw new AggregateError([error, metadataError], "Matching Chrome sync backup verification and metadata refresh both failed");
      }
      if (!parsedMetaEqual(currentRemote, remote)) {
        throw new AggregateError([error], "Chrome sync backup changed concurrently while matching content was being verified");
      }
      await writeRemoteSnapshot(localSnapshot, remote);
      return "uploaded";
    }
    await assertLocalRevisionGuard(guard, "Start Tab data changed while Browser Sync was confirming matching content", remote.meta);
    return "unchanged";
  }
  // A different checksum is not evidence that the remote frame is fully
  // replicated. Verify it before choosing either direction; only matching
  // content above may be repaired automatically from a known local copy.
  await readVerifiedRemoteBundle(remote);
  const local = await readLocalMeta();
  if (!local || local.legacy) {
    if (isPristineBackup(localSnapshot.bundle) || remoteWins(remote.meta, localSnapshot)) { await restoreParsedSnapshot(remote, guard); return "restored"; }
    await writeRemoteSnapshot(localSnapshot, remote); return "uploaded";
  }
  const localChanged = localSnapshot.contentChecksum !== local.meta.contentChecksum;
  const remoteChanged = remote.meta.contentChecksum !== local.meta.contentChecksum;
  if (!localChanged && remoteChanged) { await restoreParsedSnapshot(remote, guard); return "restored"; }
  if (localChanged && !remoteChanged) { await writeRemoteSnapshot(localSnapshot, remote); return "uploaded"; }

  if (remoteWins(remote.meta, localSnapshot)) { await restoreParsedSnapshot(remote, guard); return "restored"; }
  await writeRemoteSnapshot(localSnapshot, remote);
  return "uploaded";
}
export async function syncChromeSyncBackup(): Promise<ChromeSyncResult> {
  return withStorageLock("chrome-sync", async () => {
    await assertCompatibleSyncMetadata();
    return retrySyncConflicts(syncChromeSyncBackupInTransaction);
  });
}
