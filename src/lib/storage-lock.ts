type StorageOperation<T> = () => Promise<T>;

const fallbackQueues = new Map<string, Promise<void>>();

function lockManager(): LockManager | null {
  return typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null;
}

async function withFallbackLock<T>(name: string, operation: StorageOperation<T>): Promise<T> {
  const previous = fallbackQueues.get(name) ?? Promise.resolve();
  const execution = previous.catch(() => undefined).then(operation);
  const tail = execution.then(() => undefined, () => undefined);
  fallbackQueues.set(name, tail);
  try {
    return await execution;
  } finally {
    if (fallbackQueues.get(name) === tail) fallbackQueues.delete(name);
  }
}

/**
 * Serialize extension storage read-modify-write sequences across pages and the
 * MV3 worker. Chrome exposes Web Locks in Window and Worker contexts. The
 * fallback keeps unit tests and older Chromium-derived runtimes deterministic
 * within the current context.
 */
export async function withStorageLock<T>(name: string, operation: StorageOperation<T>): Promise<T> {
  const manager = lockManager();
  if (!manager) return withFallbackLock(name, operation);
  return manager.request(`start-tab:${name}`, { mode: "exclusive" }, operation);
}
