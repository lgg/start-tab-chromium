import { commitStorageMutationWithRevision } from "./data-revision.js";
import { sendMessage } from "./messages.js";
import { withStorageLock } from "./storage-lock.js";
import { readStartPageSettingsSnapshot, type StartPageSettings } from "./start-page-settings.js";

export const FOCUS_STATS_KEY = "focusStats";
export const FOCUS_STATS_SCHEMA_VERSION = 1;

interface CountSet {
  blockHits: number;
  avoidedVisits: number;
  estimatedMinutesSaved: number;
  unblocksAfterCountdown: number;
  focusSessionsStarted: number;
  focusSessionsCompleted: number;
  focusSessionsInterrupted: number;
  focusTimeMs: number;
}

interface DomainStats {
  blockHits: number;
  avoidedVisits: number;
  estimatedMinutesSaved: number;
  unblocksAfterCountdown: number;
  lastAvoidedAt: number;
}

export interface FocusStats {
  version: 1;
  totals: CountSet;
  byDay: Record<string, CountSet>;
  byDomain: Record<string, DomainStats>;
  processedClockCompletions: Record<string, number>;
}

const EMPTY_COUNTS: CountSet = {
  blockHits: 0, avoidedVisits: 0, estimatedMinutesSaved: 0, unblocksAfterCountdown: 0,
  focusSessionsStarted: 0, focusSessionsCompleted: 0, focusSessionsInterrupted: 0, focusTimeMs: 0,
};

function emptyStats(): FocusStats {
  return { version: 1, totals: { ...EMPTY_COUNTS }, byDay: {}, byDomain: {}, processedClockCompletions: {} };
}
function dayKey(date = new Date()): string { return date.toISOString().slice(0, 10); }
function ensureDay(stats: FocusStats): CountSet {
  const key = dayKey();
  const existing = stats.byDay[key];
  if (existing) return existing;
  const created = { ...EMPTY_COUNTS };
  stats.byDay[key] = created;
  return created;
}
function ensureDomain(stats: FocusStats, host: string): DomainStats {
  const existing = stats.byDomain[host];
  if (existing) return existing;
  const created = { blockHits: 0, avoidedVisits: 0, estimatedMinutesSaved: 0, unblocksAfterCountdown: 0, lastAvoidedAt: 0 };
  stats.byDomain[host] = created;
  return created;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function nonNegativeNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
function normalizeCounts(value: unknown): CountSet {
  if (!isRecord(value)) return { ...EMPTY_COUNTS };
  return {
    blockHits: nonNegativeNumber(value.blockHits), avoidedVisits: nonNegativeNumber(value.avoidedVisits),
    estimatedMinutesSaved: nonNegativeNumber(value.estimatedMinutesSaved),
    unblocksAfterCountdown: nonNegativeNumber(value.unblocksAfterCountdown),
    focusSessionsStarted: nonNegativeNumber(value.focusSessionsStarted),
    focusSessionsCompleted: nonNegativeNumber(value.focusSessionsCompleted),
    focusSessionsInterrupted: nonNegativeNumber(value.focusSessionsInterrupted),
    focusTimeMs: nonNegativeNumber(value.focusTimeMs),
  };
}
function normalizeDomainStats(value: unknown): DomainStats {
  if (!isRecord(value)) return { blockHits: 0, avoidedVisits: 0, estimatedMinutesSaved: 0, unblocksAfterCountdown: 0, lastAvoidedAt: 0 };
  return {
    blockHits: nonNegativeNumber(value.blockHits), avoidedVisits: nonNegativeNumber(value.avoidedVisits),
    estimatedMinutesSaved: nonNegativeNumber(value.estimatedMinutesSaved),
    unblocksAfterCountdown: nonNegativeNumber(value.unblocksAfterCountdown), lastAvoidedAt: nonNegativeNumber(value.lastAvoidedAt),
  };
}

export function isFutureFocusStatsSchema(value: unknown): boolean {
  return isRecord(value)
    && typeof value.version === "number"
    && Number.isInteger(value.version)
    && value.version > FOCUS_STATS_SCHEMA_VERSION;
}

export function normalizeFocusStats(value: unknown): FocusStats {
  if (!isRecord(value) || value.version !== FOCUS_STATS_SCHEMA_VERSION) return emptyStats();
  const stats: FocusStats = { version: 1, totals: normalizeCounts(value.totals), byDay: {}, byDomain: {}, processedClockCompletions: {} };
  if (isRecord(value.byDay)) for (const [key, counts] of Object.entries(value.byDay)) if (key) stats.byDay[key] = normalizeCounts(counts);
  if (isRecord(value.byDomain)) for (const [host, domainStats] of Object.entries(value.byDomain)) if (host) stats.byDomain[host] = normalizeDomainStats(domainStats);
  if (isRecord(value.processedClockCompletions)) {
    const entries = Object.entries(value.processedClockCompletions)
      .flatMap(([token, completedAt]) => typeof token === "string" && token.length <= 520 ? [[token, nonNegativeNumber(completedAt)] as const] : [])
      .filter((entry) => entry[1] > 0).sort((left, right) => right[1] - left[1]).slice(0, 512);
    stats.processedClockCompletions = Object.fromEntries(entries);
  }
  return stats;
}

async function readStats(requireCompatible = false): Promise<FocusStats> {
  const items = await chrome.storage.local.get(FOCUS_STATS_KEY);
  const raw = items[FOCUS_STATS_KEY];
  if (requireCompatible && isFutureFocusStatsSchema(raw)) {
    throw new Error("Focus statistics were created by a newer extension version and cannot be modified safely");
  }
  return normalizeFocusStats(raw);
}
async function writeStatsInTransaction(stats: FocusStats): Promise<void> {
  await commitStorageMutationWithRevision(
    [FOCUS_STATS_KEY],
    () => chrome.storage.local.set({ [FOCUS_STATS_KEY]: stats }),
  );
}
async function mutateStats(mutator: (stats: FocusStats) => void): Promise<void> {
  await withStorageLock("data-write", async () => {
    const stats = await readStats(true);
    mutator(stats);
    await writeStatsInTransaction(stats);
  });
}
function addToCounts(counts: CountSet, patch: Partial<CountSet>): void {
  counts.blockHits += patch.blockHits ?? 0;
  counts.avoidedVisits += patch.avoidedVisits ?? 0;
  counts.estimatedMinutesSaved += patch.estimatedMinutesSaved ?? 0;
  counts.unblocksAfterCountdown += patch.unblocksAfterCountdown ?? 0;
  counts.focusSessionsStarted += patch.focusSessionsStarted ?? 0;
  counts.focusSessionsCompleted += patch.focusSessionsCompleted ?? 0;
  counts.focusSessionsInterrupted += patch.focusSessionsInterrupted ?? 0;
  counts.focusTimeMs += patch.focusTimeMs ?? 0;
}
function domainMinutes(host: string, settings: StartPageSettings): number {
  return settings.focusStats.domainMinutes[host] ?? settings.focusStats.defaultMinutesPerAvoidedVisit;
}

export async function getFocusStats(): Promise<FocusStats> { return readStats(); }
export async function resetFocusStats(): Promise<void> {
  if (typeof document !== "undefined") { await sendMessage({ type: "reset-stats" }); return; }
  await withStorageLock("data-write", async () => { await writeStatsInTransaction(emptyStats()); });
}
export async function recordBlockedNavigation(host: string): Promise<void> {
  await withStorageLock("data-write", async () => {
    const settings = await readStartPageSettingsSnapshot();
    const now = Date.now();
    const dedupeMs = Math.max(1, settings.focusStats.avoidedVisitDedupeSeconds) * 1000;
    const stats = await readStats(true);
    const day = ensureDay(stats);
    const domain = ensureDomain(stats, host);
    const isAvoidedVisit = now - domain.lastAvoidedAt >= dedupeMs;
    addToCounts(stats.totals, { blockHits: 1 });
    addToCounts(day, { blockHits: 1 });
    domain.blockHits += 1;
    if (isAvoidedVisit) {
      const minutes = domainMinutes(host, settings);
      addToCounts(stats.totals, { avoidedVisits: 1, estimatedMinutesSaved: minutes });
      addToCounts(day, { avoidedVisits: 1, estimatedMinutesSaved: minutes });
      domain.avoidedVisits += 1;
      domain.estimatedMinutesSaved += minutes;
      domain.lastAvoidedAt = now;
    }
    await writeStatsInTransaction(stats);
  });
}
export async function recordUnblockAfterCountdown(host: string): Promise<void> {
  await mutateStats((stats) => {
    const day = ensureDay(stats);
    const domain = ensureDomain(stats, host);
    addToCounts(stats.totals, { unblocksAfterCountdown: 1 });
    addToCounts(day, { unblocksAfterCountdown: 1 });
    domain.unblocksAfterCountdown += 1;
  });
}
export async function recordFocusSessionStarted(): Promise<void> {
  await mutateStats((stats) => {
    addToCounts(stats.totals, { focusSessionsStarted: 1 });
    addToCounts(ensureDay(stats), { focusSessionsStarted: 1 });
  });
}
export async function recordFocusSessionCompleted(focusTimeMs: number, completionId?: string): Promise<void> {
  await withStorageLock("data-write", async () => {
    const stats = await readStats(true);
    if (completionId && stats.processedClockCompletions[completionId]) return;
    addToCounts(stats.totals, { focusSessionsCompleted: 1, focusTimeMs });
    addToCounts(ensureDay(stats), { focusSessionsCompleted: 1, focusTimeMs });
    if (completionId) {
      stats.processedClockCompletions[completionId] = Date.now();
      const newest = Object.entries(stats.processedClockCompletions).sort((left, right) => right[1] - left[1]).slice(0, 512);
      stats.processedClockCompletions = Object.fromEntries(newest);
    }
    await writeStatsInTransaction(stats);
  });
}
export async function recordFocusSessionInterrupted(focusTimeMs: number): Promise<void> {
  await mutateStats((stats) => {
    addToCounts(stats.totals, { focusSessionsInterrupted: 1, focusTimeMs });
    addToCounts(ensureDay(stats), { focusSessionsInterrupted: 1, focusTimeMs });
  });
}
