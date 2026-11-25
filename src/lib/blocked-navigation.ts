import { hostFromUrl } from "./blocklist.js";

interface NavigationStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

interface BlockedNavigation {
  host: string;
  url: string;
}

const PREFIX = "startTabBlockedNavigation:";
const MAX_URL_LENGTH = 65_536;

function validTabId(tabId: number | undefined): tabId is number {
  return typeof tabId === "number" && Number.isSafeInteger(tabId) && tabId >= 0;
}

function validNavigation(value: unknown, expectedHost?: string): value is BlockedNavigation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<BlockedNavigation>;
  if (typeof entry.host !== "string" || typeof entry.url !== "string" || entry.url.length > MAX_URL_LENGTH
    || (expectedHost !== undefined && entry.host !== expectedHost)) return false;
  const urlHost = hostFromUrl(entry.url);
  return !!urlHost && (urlHost === entry.host || urlHost.endsWith("." + entry.host));
}

export function isBlockedPageNavigation(url: string, blockedPageUrl: string): boolean {
  try {
    const target = new URL(url);
    const page = new URL(blockedPageUrl);
    return target.protocol === page.protocol && target.host === page.host && target.pathname === page.pathname;
  } catch { return false; }
}

/** Keep the exact blocked destination per tab in session storage. Reads wait
 * for the corresponding navigation event even when the blocked page loads
 * before its asynchronous host lookup has settled. No entry is backed up. */
export class BlockedNavigationRegistry {
  private readonly pending = new Map<number, Promise<void>>();
  // Only retain entries whose session write failed. A null overlay masks a
  // stale persisted URL until invalidation succeeds, including failed matches.
  private readonly unsaved = new Map<number, BlockedNavigation | null>();
  constructor(private readonly storage: () => NavigationStorage) {}

  private enqueue<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(tabId) ?? Promise.resolve();
    const job = previous.then(operation);
    const tail = job.then(() => undefined, () => undefined);
    this.pending.set(tabId, tail);
    void tail.then(() => {
      if (this.pending.get(tabId) === tail) this.pending.delete(tabId);
    });
    return job;
  }

  private async persist(tabId: number, entry: BlockedNavigation | null): Promise<void> {
    this.unsaved.set(tabId, entry);
    const key = PREFIX + tabId;
    try {
      if (entry) {
        await this.storage().set({ [key]: entry });
      } else {
        try {
          await this.storage().remove(key);
        } catch {
          // If removal is unavailable, a durable tombstone is preferable
          // to an obsolete URL that could survive a worker restart.
          await this.storage().set({ [key]: null });
        }
      }
      this.unsaved.delete(tabId);
    } catch {
      // Session storage is auxiliary. Continue matching and statistics;
      // the in-memory overlay remains authoritative in this worker.
    }
  }

  observe(tabId: number, url: string, resolveHost: (url: string) => Promise<string | null>): Promise<string | null> {
    if (!validTabId(tabId)) return Promise.resolve(null);
    return this.enqueue(tabId, async () => {
      // Invalidate the old destination before an asynchronous match. If the
      // new navigation fails to resolve, the old URL must never be reused.
      await this.persist(tabId, null);
      const host = await resolveHost(url);
      const entry = { host, url };
      if (validNavigation(entry)) await this.persist(tabId, entry);
      return host;
    });
  }

  lookup(tabId: number | undefined, host: string): Promise<string | null> {
    if (!validTabId(tabId)) return Promise.resolve(null);
    return this.enqueue(tabId, async () => {
      if (this.unsaved.has(tabId)) {
        const entry = this.unsaved.get(tabId);
        return validNavigation(entry, host) ? entry.url : null;
      }
      try {
        const key = PREFIX + tabId;
        const entry = (await this.storage().get(key))[key];
        return validNavigation(entry, host) ? entry.url : null;
      } catch {
        return null;
      }
    });
  }

  forget(tabId: number): Promise<void> {
    if (!validTabId(tabId)) return Promise.resolve();
    return this.enqueue(tabId, () => this.persist(tabId, null));
  }
}
