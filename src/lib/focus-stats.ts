import { commitStorageMutationWithRevision } from "./data-revision.js";
import { createDictionary, ownValue } from "./dictionary.js";
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
  return {
    version: 1,
    totals: { ...EMPTY_COUNTS },
    byDay: createDictionary<CountSet>(),
    byDomain: createDictionary<DomainStats>(),
    processedClockCompletions: createDictionary<number>(),
  };
}
function dayKey(date = new Date()): string { return date.toISOString().slice(0, 10); }
function ensureDay(stats: FocusStats, occurredAt = Date.now()): CountSet {
  const key = dayKey(new Date(occurredAt));
  const existing = ownValue(stats.byDay, key);
  if (existing) return existing;
  const created = { ...EMPTY_COUNTS };
  stats.byDay[key] = created;
  return created;
}
function ensureDomain(stats: FocusStats, host: string): DomainStats {
  const existing = ownValue(stats.byDomain, host);
  if (existing) return existing;
  const created = { blockHits: 0, avoidedVisits: 0, estimatedMinutesSaved: 0, unblocksAfterCountdown: 0, lastAvoidedAt: 0 };
  stats.byDomain[host] = created;
  return created;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
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
  const stats: FocusStats = {
    version: 1,
    totals: normalizeCounts(value.totals),
    byDay: createDictionary<CountSet>(),
    byDomain: createDictionary<DomainStats>(),
    processedClockCompletions: createDictionary<number>(),
  };
  if (isRecord(value.byDay)) for (const [key, counts] of Object.entries(value.byDay)) if (key) stats.byDay[key] = normalizeCounts(counts);
  if (isRecord(value.byDomain)) for (const [host, domainStats] of Object.entries(value.byDomain)) if (host) stats.byDomain[host] = normalizeDomainStats(domainStats);
  if (isRecord(value.processedClockCompletions)) {
    const entries = Object.entries(value.processedClockCompletions)
      .flatMap(([token, completedAt]) => typeof token === "string" && token.length <= 520 ? [[token, nonNegativeNumber(completedAt)] as const] : [])
      .filter((entry) => entry[1] > 0).sort((left, right) => right[1] - left[1]).slice(0, 512);
    const completions = createDictionary<number>();
    for (const [token, completedAt] of entries) completions[token] = completedAt;
    stats.processedClockCompletions = completions;
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

export interface FocusClockStatsPatch {
  startedSessions?: number;
  completedFocusTimeMs?: number;
  interruptedFocusTimesMs?: readonly number[];
  completionId?: string;
  occurredAt?: number;
}

function normalizedFocusTimes(values: readonly number[] | undefined): number[] {
  return (values ?? [])
    .filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
    .map((value) => Math.max(0, value));
}

function applyFocusClockStatsPatch(stats: FocusStats, patch: FocusClockStatsPatch): boolean {
  const completionId = typeof patch.completionId === "string" && patch.completionId.length <= 520
    ? patch.completionId
    : undefined;
  if (completionId && ownValue(stats.processedClockCompletions, completionId)) return false;

  const startedSessions = typeof patch.startedSessions === "number" && Number.isFinite(patch.startedSessions)
    ? Math.max(0, Math.round(patch.startedSessions))
    : 0;
  const completedFocusTimeMs = typeof patch.completedFocusTimeMs === "number"
    && Number.isFinite(patch.completedFocusTimeMs)
    && patch.completedFocusTimeMs > 0
    ? Math.max(0, patch.completedFocusTimeMs)
    : 0;
  const interrupted = normalizedFocusTimes(patch.interruptedFocusTimesMs);
  const interruptedFocusTimeMs = interrupted.reduce((total, value) => total + value, 0);
  if (startedSessions === 0 && completedFocusTimeMs === 0 && interrupted.length === 0) return false;

  const countsPatch: Partial<CountSet> = {
    focusSessionsStarted: startedSessions,
    focusSessionsCompleted: completedFocusTimeMs > 0 ? 1 : 0,
    focusSessionsInterrupted: interrupted.length,
    focusTimeMs: completedFocusTimeMs + interruptedFocusTimeMs,
  };
  addToCounts(stats.totals, countsPatch);
  addToCounts(ensureDay(stats, patch.occurredAt), countsPatch);

  if (completionId) {
    stats.processedClockCompletions[completionId] = Math.max(1, patch.occurredAt ?? Date.now());
    const newest = Object.entries(stats.processedClockCompletions)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 512);
    const completions = createDictionary<number>();
    for (const [token, completedAt] of newest) completions[token] = completedAt;
    stats.processedClockCompletions = completions;
  }
  return true;
}

/**
 * Apply clock statistics while the caller already owns the shared data-write
 * lock and the surrounding storage/revision transaction. This intentionally
 * writes no separate data revision.
 */
export async function applyFocusClockStatsPatchInExistingTransaction(patch: FocusClockStatsPatch): Promise<void> {
  const stats = await readStats(true);
  if (!applyFocusClockStatsPatch(stats, patch)) return;
  await chrome.storage.local.set({ [FOCUS_STATS_KEY]: stats });
}

function domainMinutes(host: string, settings: StartPageSettings): number {
  return ownValue(settings.focusStats.domainMinutes, host) ?? settings.focusStats.defaultMinutesPerAvoidedVisit;
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
    if (!applyFocusClockStatsPatch(stats, { completedFocusTimeMs: focusTimeMs, completionId })) return;
    await writeStatsInTransaction(stats);
  });
}
export async function recordFocusSessionsInterrupted(focusTimesMs: readonly number[]): Promise<void> {
  await withStorageLock("data-write", async () => {
    const stats = await readStats(true);
    if (!applyFocusClockStatsPatch(stats, { interruptedFocusTimesMs: focusTimesMs })) return;
    await writeStatsInTransaction(stats);
  });
}

export async function recordFocusSessionInterrupted(focusTimeMs: number): Promise<void> {
  await recordFocusSessionsInterrupted([focusTimeMs]);
}
