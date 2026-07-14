import { withStorageLock } from "./storage-lock.js";

export const DATA_REVISION_KEY = "startTabDataRevision";

interface DataRevision {
  version: 1;
  updatedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readStartTabDataRevision(fallback = 0): Promise<number> {
  const items = await chrome.storage.local.get(DATA_REVISION_KEY);
  const revision = items[DATA_REVISION_KEY];
  if (isRecord(revision)
    && revision.version === 1
    && typeof revision.updatedAt === "number"
    && Number.isFinite(revision.updatedAt)) {
    return Math.max(0, revision.updatedAt, fallback);
  }
  return Math.max(0, fallback);
}

export async function markStartTabDataChanged(at = Date.now()): Promise<number> {
  return withStorageLock("data-revision", async () => {
    const current = await readStartTabDataRevision();
    const revision: DataRevision = {
      version: 1,
      updatedAt: Math.max(current + 1, Math.max(0, Math.round(Number.isFinite(at) ? at : Date.now()))),
    };
    await chrome.storage.local.set({ [DATA_REVISION_KEY]: revision });
    return revision.updatedAt;
  });
}
