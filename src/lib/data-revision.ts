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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFutureDataRevisionSchema(value: unknown): boolean {
  return isRecord(value)
    && typeof value.version === "number"
    && Number.isInteger(value.version)
    && value.version > DATA_REVISION_SCHEMA_VERSION;
}

function revisionValue(value: unknown, fallback = 0): number {
  if (isRecord(value)
    && value.version === DATA_REVISION_SCHEMA_VERSION
    && typeof value.updatedAt === "number"
    && Number.isFinite(value.updatedAt)) {
    return Math.max(0, value.updatedAt, fallback);
  }
  return Math.max(0, fallback);
}

export async function readStartTabDataRevision(fallback = 0): Promise<number> {
  const items = await chrome.storage.local.get(DATA_REVISION_KEY);
  const revision = items[DATA_REVISION_KEY];
  if (isFutureDataRevisionSchema(revision)) {
    throw new Error("Start Tab data revision was created by a newer extension version");
  }
  return revisionValue(revision, fallback);
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
    const revision: DataRevision = {
      version: DATA_REVISION_SCHEMA_VERSION,
      updatedAt: Math.max(current + 1, Math.max(0, Math.round(Number.isFinite(at) ? at : Date.now()))),
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
  options: DataRevisionWriteOptions = {},
): Promise<T> {
  const keys = uniqueStorageKeys(storageKeys);
  const previous = await chrome.storage.local.get(keys);
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
