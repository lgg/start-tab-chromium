interface CacheEntry {
  expiresAt: number;
  promise: Promise<unknown>;
}

/** Bounded page cache; deduplicate pending loads and start TTL on success. */
export class WidgetRequestCache {
  private readonly entries = new Map<string, CacheEntry>();
  constructor(
    private readonly maxEntries = 1024,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id);
    }
    const existing = this.entries.get(key);
    if (existing) return existing.promise as Promise<T>;
    // Prefer evicting a completed entry. Bound pending entries too; a full
    // cache must never grow forever with distinct edited widget endpoints.
    while (this.entries.size >= Math.max(1, this.maxEntries)) {
      const oldest = [...this.entries].find(([, entry]) => Number.isFinite(entry.expiresAt))?.[0]
        ?? this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    const promise = Promise.resolve().then(loader);
    const entry: CacheEntry = { expiresAt: Number.POSITIVE_INFINITY, promise };
    this.entries.set(key, entry);
    void promise.then(() => {
      if (this.entries.get(key) === entry) entry.expiresAt = this.now() + ttlMs;
    }, () => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return promise;
  }
}
