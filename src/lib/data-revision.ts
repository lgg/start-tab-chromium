import { jsonContentEqual } from "./json-content.js";
import { runIndependentEffects } from "./independent-effects.js";
import { withStorageLock } from "./storage-lock.js";

export const DATA_REVISION_KEY = "startTabDataRevision";
export const DATA_REVISION_SCHEMA_VERSION = 1;

interface DataRevision {
  version: typeof DATA_REVISION_SCHEMA_VERSION;
  updatedAt: number;
}

export interface DataRevisionWriteOptions {
  allowFutureOverwrite?: boolean;
}

/** Optional compare-and-swap against the snapshot used to prepare a write.
 * Guard-only keys are read but are never included in the rollback payload. */
export interface StorageMutationWriteOptions extends DataRevisionWriteOptions {
  expectedStorage?: Readonly<Record<string, unknown>>;
  conflictMessage?: string;
}

export class StartTabDataRevisionConflictError extends Error {
  constructor(message = "Start Tab data changed in another extension context; retry the operation") {
    super(message);
    this.name = "StartTabDataRevisionConflictError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFutureDataRevisionSchema(value: unknown): boolean {
  return isRecord(value)
    && typeof value.version === "number"
    && Number.isInteger(value.version)
    && value.version > DATA_REVISION_SCHEMA_VERSION;
}

function storedRevisionValue(value: unknown): number | null {
  return isRecord(value)
    && value.version === DATA_REVISION_SCHEMA_VERSION
    && typeof value.updatedAt === "number"
    && Number.isFinite(value.updatedAt) ? value.updatedAt : null;
}

function revisionValue(value: unknown, fallback = 0): number {
  const stored = storedRevisionValue(value);
  // The fallback belongs only to legacy profiles without a valid stored
  // counter. Taking max(stored, fallback) can hide real revision increments.
  return Math.max(0, stored ?? fallback);
}

export interface StartTabDataRevisionSnapshot {
  dataRevision: number;
  storedDataRevision: number | null;
}

export async function readStartTabDataRevisionSnapshot(fallback = 0): Promise<StartTabDataRevisionSnapshot> {
  const items = await chrome.storage.local.get(DATA_REVISION_KEY);
  const revision = items[DATA_REVISION_KEY];
  if (isFutureDataRevisionSchema(revision)) {
    throw new Error("Start Tab data revision was created by a newer extension version");
  }
  const current = revisionValue(revision, fallback);
  if (!Number.isSafeInteger(current) || current >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Start Tab data revision exceeds the safe integer range");
  }
  return { dataRevision: current, storedDataRevision: storedRevisionValue(revision) };
}

export async function readStartTabDataRevision(fallback = 0): Promise<number> {
  return (await readStartTabDataRevisionSnapshot(fallback)).dataRevision;
}

/**
 * Optimistic-concurrency guard for callers that already own any stronger lock
 * required by their transaction. The fallback must be the same value used when
 * the expected revision was captured so legacy states without a revision key
 * remain comparable until their first revisioned mutation. Capture the
 * stored token too: a legacy profile's first stored revision can be exactly
 * equal to the fallback, but that transition still represents a mutation.
 */
export async function assertStartTabDataRevisionUnchanged(
  expected: number,
  fallback = 0,
  message = "Start Tab data changed in another extension context; retry the operation",
  expectedStoredRevision?: number | null,
): Promise<void> {
  const current = await readStartTabDataRevisionSnapshot(fallback);
  if (current.dataRevision !== expected
    || (expectedStoredRevision !== undefined && current.storedDataRevision !== expectedStoredRevision)) {
    throw new StartTabDataRevisionConflictError(message);
  }
}

export async function markStartTabDataChanged(
  at = Date.now(),
  options: DataRevisionWriteOptions = {},
): Promise<number> {
  return withStorageLock("data-revision", async () => {
    const items = await chrome.storage.local.get(DATA_REVISION_KEY);
    const raw = items[DATA_REVISION_KEY];
    if (!options.allowFutureOverwrite && isFutureDataRevisionSchema(raw)) {
      throw new Error("Start Tab data revision was created by a newer extension version and cannot be modified safely");
    }
    const futureFloor = options.allowFutureOverwrite && isFutureDataRevisionSchema(raw)
      && typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
      ? Math.max(0, raw.updatedAt)
      : 0;
    const current = Math.max(revisionValue(raw), futureFloor);
    const updatedAt = Math.max(current + 1, Math.max(0, Math.round(Number.isFinite(at) ? at : Date.now())));
    // A non-safe integer can stop advancing under +1 and defeat every CAS.
    // Reject it before writing; callers' existing transaction rollback then
    // preserves the previous state instead of publishing an unusable revision.
    if (!Number.isSafeInteger(updatedAt) || updatedAt >= Number.MAX_SAFE_INTEGER || updatedAt <= current) {
      throw new Error("Start Tab data revision exceeds the safe integer range");
    }
    const revision: DataRevision = {
      version: DATA_REVISION_SCHEMA_VERSION,
      updatedAt,
    };
    await chrome.storage.local.set({ [DATA_REVISION_KEY]: revision });
    return revision.updatedAt;
  });
}

function uniqueStorageKeys(keys: readonly string[]): string[] {
  return [...new Set([...keys, DATA_REVISION_KEY])];
}

async function restoreExactStorageSnapshot(snapshot: Record<string, unknown>, keys: readonly string[]): Promise<void> {
  const absent = keys.filter((key) => !Object.prototype.hasOwnProperty.call(snapshot, key));
  const effects: Array<() => Promise<void>> = [];
  if (absent.length > 0) effects.push(() => chrome.storage.local.remove(absent));
  if (Object.keys(snapshot).length > 0) effects.push(() => chrome.storage.local.set(snapshot));
  await runIndependentEffects(effects, "Revisioned storage rollback was incomplete");
}

/**
 * Commit one storage mutation and its Sync revision as a recoverable unit.
 * Callers must already hold the shared `data-write` lock.
 */
export async function commitStorageMutationWithRevision<T>(
  storageKeys: readonly string[],
  mutation: () => Promise<T>,
  at = Date.now(),
  options: StorageMutationWriteOptions = {},
): Promise<T> {
  const keys = uniqueStorageKeys(storageKeys);
  const expected = Object.entries(options.expectedStorage ?? {});
  const captured = await chrome.storage.local.get([...new Set([...keys, ...expected.map(([key]) => key)])]);
  if (expected.some(([key, value]) => !jsonContentEqual(captured[key], value))) {
    // No mutation has begun. Do not roll back another context\'s write.
    throw new StartTabDataRevisionConflictError(options.conflictMessage);
  }
  const previous = Object.fromEntries(keys.filter(key => Object.hasOwn(captured, key)).map(key => [key, captured[key]]));
  try {
    const result = await mutation();
    await markStartTabDataChanged(at, options);
    return result;
  } catch (error) {
    try {
      await restoreExactStorageSnapshot(previous, keys);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Storage mutation failed and its previous revisioned state could not be restored");
    }
    throw error;
  }
}
