import { normalizeLastBlockedUrls } from "./blocklist.js";
import { createDictionary } from "./dictionary.js";
import { MAX_BLOCKED_SITES } from "./platform-limits.js";

export type BackupCollectionMode = "strict-import" | "local-recovery";

/**
 * Keep return-navigation data bounded and attached to an actual blocked site.
 * Strict external imports reject oversized maps before any Chrome API access;
 * local recovery deterministically keeps the first supported entries.
 */
export function normalizeBackupLastBlockedUrls(
  value: unknown,
  blockedSites: readonly string[],
  mode: BackupCollectionMode,
): Record<string, string> {
  const normalized = normalizeLastBlockedUrls(value);
  const entries = Object.keys(normalized).sort();
  if (mode === "strict-import" && entries.length > MAX_BLOCKED_SITES) {
    throw new Error(`Start Tab backup contains more than ${MAX_BLOCKED_SITES} last blocked URLs`);
  }
  const allowed = new Set(blockedSites);
  const bounded = createDictionary<string>();
  let count = 0;
  for (const host of entries) {
    if (!allowed.has(host)) continue;
    bounded[host] = normalized[host]!;
    if (++count >= MAX_BLOCKED_SITES) break;
  }
  return bounded;
}
