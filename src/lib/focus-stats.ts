import { getStartPageSettings } from "./start-page-settings.js";

export const FOCUS_STATS_KEY = "focusStats";

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
}

const EMPTY_COUNTS: CountSet = {
  blockHits: 0,
  avoidedVisits: 0,
  estimatedMinutesSaved: 0,
  unblocksAfterCountdown: 0,
  focusSessionsStarted: 0,
  focusSessionsCompleted: 0,
  focusSessionsInterrupted: 0,
  focusTimeMs: 0,
};

function emptyStats(): FocusStats {
  return {
    version: 1,
    totals: { ...EMPTY_COUNTS },
    byDay: {},
    byDomain: {},
  };
}

function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

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
  const created = {
    blockHits: 0,
    avoidedVisits: 0,
    estimatedMinutesSaved: 0,
    unblocksAfterCountdown: 0,
    lastAvoidedAt: 0,
  };
  stats.byDomain[host] = created;
  return created;
}

function isStats(value: unknown): value is FocusStats {
  return typeof value === "object" && value !== null && (value as FocusStats).version === 1;
}

async function readStats(): Promise<FocusStats> {
  const items = await chrome.storage.local.get(FOCUS_STATS_KEY);
  const value = items[FOCUS_STATS_KEY];
  return isStats(value) ? value : emptyStats();
}

async function writeStats(stats: FocusStats): Promise<void> {
  await chrome.storage.local.set({ [FOCUS_STATS_KEY]: stats });
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

async function domainMinutes(host: string): Promise<number> {
  const settings = await getStartPageSettings();
  return settings.focusStats.domainMinutes[host] ?? settings.focusStats.defaultMinutesPerAvoidedVisit;
}

export async function getFocusStats(): Promise<FocusStats> {
  return readStats();
}

export async function resetFocusStats(): Promise<void> {
  await writeStats(emptyStats());
}

export async function recordBlockedNavigation(host: string): Promise<void> {
  const settings = await getStartPageSettings();
  const now = Date.now();
  const dedupeMs = Math.max(1, settings.focusStats.avoidedVisitDedupeSeconds) * 1000;
  const stats = await readStats();
  const day = ensureDay(stats);
  const domain = ensureDomain(stats, host);
  const isAvoidedVisit = now - domain.lastAvoidedAt >= dedupeMs;

  addToCounts(stats.totals, { blockHits: 1 });
  addToCounts(day, { blockHits: 1 });
  domain.blockHits += 1;

  if (isAvoidedVisit) {
    const minutes = await domainMinutes(host);
    addToCounts(stats.totals, { avoidedVisits: 1, estimatedMinutesSaved: minutes });
    addToCounts(day, { avoidedVisits: 1, estimatedMinutesSaved: minutes });
    domain.avoidedVisits += 1;
    domain.estimatedMinutesSaved += minutes;
    domain.lastAvoidedAt = now;
  }

  await writeStats(stats);
}

export async function recordUnblockAfterCountdown(host: string): Promise<void> {
  const stats = await readStats();
  const day = ensureDay(stats);
  const domain = ensureDomain(stats, host);
  addToCounts(stats.totals, { unblocksAfterCountdown: 1 });
  addToCounts(day, { unblocksAfterCountdown: 1 });
  domain.unblocksAfterCountdown += 1;
  await writeStats(stats);
}

export async function recordFocusSessionStarted(): Promise<void> {
  const stats = await readStats();
  addToCounts(stats.totals, { focusSessionsStarted: 1 });
  addToCounts(ensureDay(stats), { focusSessionsStarted: 1 });
  await writeStats(stats);
}

export async function recordFocusSessionCompleted(focusTimeMs: number): Promise<void> {
  const stats = await readStats();
  addToCounts(stats.totals, { focusSessionsCompleted: 1, focusTimeMs });
  addToCounts(ensureDay(stats), { focusSessionsCompleted: 1, focusTimeMs });
  await writeStats(stats);
}

export async function recordFocusSessionInterrupted(focusTimeMs: number): Promise<void> {
  const stats = await readStats();
  addToCounts(stats.totals, { focusSessionsInterrupted: 1, focusTimeMs });
  addToCounts(ensureDay(stats), { focusSessionsInterrupted: 1, focusTimeMs });
  await writeStats(stats);
}
