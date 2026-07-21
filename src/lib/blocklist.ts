// Shared blocklist persistence and the declarativeNetRequest rules that enforce it.

import { commitStorageMutationWithRevision, DATA_REVISION_KEY, markStartTabDataChanged } from "./data-revision.js";
import { cloneDictionary, createDictionary, ownValue } from "./dictionary.js";
import { runIndependentEffects } from "./independent-effects.js";
import { sendMessage } from "./messages.js";
import { MAX_BLOCKED_SITES } from "./platform-limits.js";
import { withStorageLock } from "./storage-lock.js";

const STORAGE_KEY = "blockedSites";
const LEGACY_STORAGE_KEY = "blocked";
const LAST_BLOCKED_URLS_KEY = "lastBlockedUrls";
let migrationPromise: Promise<void> | undefined;
let mutationJob: Promise<void> = Promise.resolve();

function runMutation<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutationJob.catch(() => undefined).then(() => withStorageLock("data-write", operation));
  mutationJob = next.then(() => undefined, () => undefined);
  return next;
}

function isPageContext(): boolean {
  return typeof document !== "undefined";
}

export const BLOCKED_PAGE = "blocked.html";

export function normalizeHost(host: string): string {
  return host.trim().replace(/\.$/, "").replace(/^www\./i, "").toLowerCase();
}

function normalizeHostCandidate(host: string): string | null {
  const candidate = normalizeHost(host);
  if (!candidate) return null;
  if (candidate.startsWith(".") || candidate.endsWith(".")) return null;
  if (/[\s/:]/.test(candidate)) return null;
  return candidate;
}

export function hostFromUrl(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "http:" && protocol !== "https:") return null;
    return normalizeHostCandidate(hostname);
  } catch {
    return null;
  }
}

function normalizeStoredHost(value: string): string | null {
  const trimmed = value.trim();
  const fromUrl = hostFromUrl(trimmed);
  if (fromUrl) return fromUrl;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) return null;
  const rawHost = trimmed.replace(/\/.*$/, "");
  return hostFromUrl(`https://${rawHost}/`);
}

function normalizeSites(sites: string[]): string[] {
  return [...new Set(sites.map(normalizeStoredHost))]
    .filter((site): site is string => Boolean(site))
    .sort();
}

export function normalizeBlockedSites(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return normalizeSites(value.filter((site): site is string => typeof site === "string"));
}

export function assertBlockedSiteCapacity(sites: readonly string[]): void {
  if (sites.length > MAX_BLOCKED_SITES) {
    throw new Error(`Start Tab supports at most ${MAX_BLOCKED_SITES} blocked sites because each redirect uses one Chrome dynamic rule`);
  }
}

export function normalizeLastBlockedUrls(value: unknown): Record<string, string> {
  const normalized = createDictionary<string>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return normalized;
  for (const [host, url] of Object.entries(value)) {
    if (typeof url !== "string") continue;
    const normalizedHost = normalizeStoredHost(host);
    if (!normalizedHost) continue;
    const urlHost = hostFromUrl(url);
    if (!urlHost || !hostMatchesBlockedSite(urlHost, normalizedHost)) continue;
    normalized[normalizedHost] = url;
  }
  return normalized;
}

function lastBlockedUrlsForSites(
  urls: Record<string, string>,
  sites: readonly string[],
): Record<string, string> {
  const filtered = createDictionary<string>();
  for (const site of sites) {
    const url = ownValue(urls, site);
    if (url !== undefined) filtered[site] = url;
  }
  return filtered;
}

function requireHost(host: string): string {
  const normalized = normalizeStoredHost(host);
  if (!normalized) throw new Error("Invalid host");
  return normalized;
}

function hostMatchesBlockedSite(host: string, site: string): boolean {
  return host === site || host.endsWith(`.${site}`);
}

/** Prefer the most-specific suffix when parent and child domains are both blocked. */
function matchingBlockedSite(host: string, sites: readonly string[]): string | null {
  let match: string | null = null;
  for (const site of sites) {
    if (!hostMatchesBlockedSite(host, site)) continue;
    if (match === null || site.length > match.length || (site.length === match.length && site < match)) {
      match = site;
    }
  }
  return match;
}

function storedSitesEqual(raw: unknown, expected: readonly string[]): boolean {
  return Array.isArray(raw)
    && raw.length === expected.length
    && raw.every((site, index) => site === expected[index]);
}

function storedLastBlockedUrlsEqual(snapshot: Record<string, unknown>, expected: Record<string, string> | null): boolean {
  const expectedEntries = expected === null ? [] : Object.entries(expected);
  if (expectedEntries.length === 0) {
    return !Object.prototype.hasOwnProperty.call(snapshot, LAST_BLOCKED_URLS_KEY);
  }
  const raw = snapshot[LAST_BLOCKED_URLS_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const rawRecord = raw as Record<string, unknown>;
  const rawEntries = Object.entries(rawRecord);
  return rawEntries.length === expectedEntries.length
    && expectedEntries.every(([host, url]) => Object.prototype.hasOwnProperty.call(rawRecord, host) && rawRecord[host] === url);
}

interface LastBlockedUrlSnapshot {
  snapshot: Record<string, unknown>;
  urls: Record<string, string>;
}

async function readLastBlockedUrlSnapshot(): Promise<LastBlockedUrlSnapshot> {
  const snapshot = await chrome.storage.local.get(LAST_BLOCKED_URLS_KEY) as Record<string, unknown>;
  return { snapshot, urls: normalizeLastBlockedUrls(snapshot[LAST_BLOCKED_URLS_KEY]) };
}

async function writeCanonicalLastBlockedUrls(urls: Record<string, string>): Promise<void> {
  if (Object.keys(urls).length === 0) {
    await chrome.storage.local.remove(LAST_BLOCKED_URLS_KEY);
    return;
  }
  await chrome.storage.local.set({ [LAST_BLOCKED_URLS_KEY]: urls });
}

export async function getBlockedSites(): Promise<string[]> {
  await migrateLegacyStorage();
  return readBlockedSites();
}

async function readBlockedSites(): Promise<string[]> {
  const items = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeBlockedSites(items[STORAGE_KEY]);
}

export async function migrateLegacyStorage(): Promise<void> {
  if (migrationPromise) {
    await migrationPromise;
    return;
  }

  const migration = withStorageLock("data-write", async () => {
    const items = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
    if (!Object.prototype.hasOwnProperty.call(items, LEGACY_STORAGE_KEY)) return;

    const current = Array.isArray(items[STORAGE_KEY]) ? (items[STORAGE_KEY] as string[]) : [];
    const legacy = Array.isArray(items[LEGACY_STORAGE_KEY]) ? (items[LEGACY_STORAGE_KEY] as string[]) : [];
    const normalized = normalizeBlockedSites([...current, ...legacy]);
    assertBlockedSiteCapacity(normalized);
    await commitStorageMutationWithRevision(
      [STORAGE_KEY, LEGACY_STORAGE_KEY],
      async () => {
        if (!storedSitesEqual(items[STORAGE_KEY], normalized)) {
          await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
        }
        await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
      },
    );
  });

  migrationPromise = migration;
  try {
    await migration;
  } finally {
    if (migrationPromise === migration) migrationPromise = undefined;
  }
}

async function getLastBlockedUrls(): Promise<Record<string, string>> {
  return (await readLastBlockedUrlSnapshot()).urls;
}

export async function replaceBlockedSites(sites: string[]): Promise<string[]> {
  const normalized = normalizeBlockedSites(sites);
  assertBlockedSiteCapacity(normalized);
  if (isPageContext()) {
    await sendMessage({ type: "replace-blocked-sites", sites: normalized });
    return normalized;
  }
  await migrateLegacyStorage();
  return runMutation(() => applyBlocklistMutation(() => ({ sites: normalized, lastBlockedUrls: null })));
}

export async function blockedSiteForUrl(url: string): Promise<string | null> {
  const host = hostFromUrl(url);
  if (!host) return null;
  const sites = await getBlockedSites();
  return matchingBlockedSite(host, sites);
}

export async function isBlocked(url: string): Promise<boolean> {
  return (await blockedSiteForUrl(url)) !== null;
}

/**
 * Remember one blocked navigation and return the exact site selected from the
 * same locked blocklist snapshot. The worker uses this return value for stats,
 * avoiding a second match against possibly changed storage.
 */
export async function rememberBlockedNavigation(url: string): Promise<string | null> {
  const urlHost = hostFromUrl(url);
  if (!urlHost) return null;
  await migrateLegacyStorage();
  return withStorageLock("data-write", async () => {
    const sites = await readBlockedSites();
    const host = matchingBlockedSite(urlHost, sites);
    if (!host) return null;
    const { snapshot, urls: storedUrls } = await readLastBlockedUrlSnapshot();
    const urls = lastBlockedUrlsForSites(storedUrls, sites);
    if (ownValue(urls, host) === url && storedLastBlockedUrlsEqual(snapshot, urls)) return host;
    urls[host] = url;
    await commitStorageMutationWithRevision(
      [LAST_BLOCKED_URLS_KEY],
      () => writeCanonicalLastBlockedUrls(urls),
    );
    return host;
  });
}

export async function getLastBlockedUrl(host: string): Promise<string | null> {
  const normalized = normalizeStoredHost(host);
  if (!normalized) return null;
  const urls = await getLastBlockedUrls();
  return ownValue(urls, normalized) ?? null;
}

export async function clearLastBlockedUrl(host: string): Promise<void> {
  const normalized = normalizeStoredHost(host);
  if (!normalized) return;
  await migrateLegacyStorage();
  await withStorageLock("data-write", async () => {
    const sites = await readBlockedSites();
    const { snapshot, urls: storedUrls } = await readLastBlockedUrlSnapshot();
    const urls = lastBlockedUrlsForSites(storedUrls, sites);
    const contained = Object.prototype.hasOwnProperty.call(urls, normalized);
    if (contained) delete urls[normalized];
    if (!contained && storedLastBlockedUrlsEqual(snapshot, urls)) return;
    await commitStorageMutationWithRevision(
      [LAST_BLOCKED_URLS_KEY],
      () => writeCanonicalLastBlockedUrls(urls),
    );
  });
}

function rulePriorityForHost(host: string): number {
  // A proper child suffix always contains at least one additional label. Using
  // the complete label depth keeps that ordering strict even for one-label
  // parents such as localhost or a deliberately blocked public suffix.
  return host.split(".").length;
}

function buildRules(sites: string[]): chrome.declarativeNetRequest.Rule[] {
  const normalized = normalizeBlockedSites(sites);
  assertBlockedSiteCapacity(normalized);
  return normalized.map((host, index) => ({
    id: index + 1,
    priority: rulePriorityForHost(host),
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
      redirect: { url: chrome.runtime.getURL(`${BLOCKED_PAGE}?site=${encodeURIComponent(host)}`) },
    },
    condition: {
      requestDomains: [host],
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
    },
  }));
}

function stableRuleValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(stableRuleValue)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableRuleValue(child)]),
  );
}

function dynamicRulesEqual(
  actual: readonly chrome.declarativeNetRequest.Rule[],
  expected: readonly chrome.declarativeNetRequest.Rule[],
): boolean {
  if (actual.length !== expected.length) return false;
  const normalized = (rules: readonly chrome.declarativeNetRequest.Rule[]) => [...rules]
    .sort((left, right) => left.id - right.id)
    .map(stableRuleValue);
  return JSON.stringify(normalized(actual)) === JSON.stringify(normalized(expected));
}

function isBlocklistDynamicRule(rule: chrome.declarativeNetRequest.Rule): boolean {
  const redirectUrl = rule.action.redirect?.url;
  return rule.action.type === chrome.declarativeNetRequest.RuleActionType.REDIRECT
    && typeof redirectUrl === "string"
    && redirectUrl.startsWith(chrome.runtime.getURL(BLOCKED_PAGE) + "?site=");
}

function blocklistDynamicRules(
  rules: readonly chrome.declarativeNetRequest.Rule[],
): chrome.declarativeNetRequest.Rule[] {
  return rules.filter(isBlocklistDynamicRule);
}

export async function readDynamicRulesSnapshot(): Promise<chrome.declarativeNetRequest.Rule[]> {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  return structuredClone(blocklistDynamicRules(rules));
}

async function replaceDynamicRulesExact(
  rules: readonly chrome.declarativeNetRequest.Rule[],
  _existing?: readonly chrome.declarativeNetRequest.Rule[],
): Promise<void> {
  const allCurrentRules = await chrome.declarativeNetRequest.getDynamicRules();
  const currentRules = blocklistDynamicRules(allCurrentRules);
  const foreignRuleIds = new Set(
    allCurrentRules
      .filter((rule) => !isBlocklistDynamicRule(rule))
      .map((rule) => rule.id),
  );
  const collision = rules.find((rule) => foreignRuleIds.has(rule.id));
  if (collision) {
    throw new Error(
      `Blocklist DNR rule ID ${collision.id} conflicts with a dynamic rule owned by another Start Tab feature`,
    );
  }
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: currentRules.map((rule) => rule.id),
    addRules: structuredClone([...rules]),
  });
}

export async function restoreDynamicRulesSnapshot(
  snapshot: readonly chrome.declarativeNetRequest.Rule[],
): Promise<void> {
  const current = await readDynamicRulesSnapshot();
  if (dynamicRulesEqual(current, snapshot)) return;
  await replaceDynamicRulesExact(snapshot, current);
}

async function replaceDynamicRules(
  sites: string[],
  existing?: readonly chrome.declarativeNetRequest.Rule[],
): Promise<void> {
  await replaceDynamicRulesExact(buildRules(sites), existing);
}

export async function syncRulesInCurrentTransaction(): Promise<void> {
  await replaceDynamicRules(await readBlockedSites());
}

export async function syncRules(): Promise<void> {
  await migrateLegacyStorage();
  await runMutation(syncRulesInCurrentTransaction);
}

interface BlocklistMutationState {
  sites: string[];
  lastBlockedUrls: Record<string, string> | null;
}

async function restoreBlocklistStorage(snapshot: Record<string, unknown>): Promise<void> {
  const payload: Record<string, unknown> = {};
  const removals: string[] = [];
  for (const key of [STORAGE_KEY, LAST_BLOCKED_URLS_KEY, DATA_REVISION_KEY]) {
    if (Object.prototype.hasOwnProperty.call(snapshot, key)) payload[key] = snapshot[key];
    else removals.push(key);
  }
  const effects: Array<() => Promise<void>> = [];
  if (Object.keys(payload).length > 0) effects.push(() => chrome.storage.local.set(payload));
  if (removals.length > 0) effects.push(() => chrome.storage.local.remove(removals));
  await runIndependentEffects(effects, "Blocklist storage rollback was incomplete");
}

async function restoreBlocklistTransaction(
  storageSnapshot: Record<string, unknown>,
  rulesSnapshot: readonly chrome.declarativeNetRequest.Rule[],
): Promise<void> {
  await runIndependentEffects([
    () => restoreBlocklistStorage(storageSnapshot),
    () => restoreDynamicRulesSnapshot(rulesSnapshot),
  ], "Blocklist storage and DNR rollback was incomplete");
}

async function applyBlocklistMutation(
  transform: (current: { sites: string[]; lastBlockedUrls: Record<string, string> }) => BlocklistMutationState,
): Promise<string[]> {
  const original = await chrome.storage.local.get([STORAGE_KEY, LAST_BLOCKED_URLS_KEY, DATA_REVISION_KEY]);
  const originalRules = await readDynamicRulesSnapshot();
  const previousSites = normalizeBlockedSites(original[STORAGE_KEY]);
  const current = { sites: previousSites, lastBlockedUrls: normalizeLastBlockedUrls(original[LAST_BLOCKED_URLS_KEY]) };
  const requested = transform({
    sites: structuredClone(current.sites),
    lastBlockedUrls: cloneDictionary(current.lastBlockedUrls),
  });
  const nextSites = normalizeBlockedSites(requested.sites);
  assertBlockedSiteCapacity(nextSites);
  const normalizedUrls = requested.lastBlockedUrls === null ? null : normalizeLastBlockedUrls(requested.lastBlockedUrls);
  const nextUrls = normalizedUrls === null ? null : lastBlockedUrlsForSites(normalizedUrls, nextSites);
  const storageUnchanged = storedSitesEqual(original[STORAGE_KEY], nextSites)
    && storedLastBlockedUrlsEqual(original, nextUrls);
  if (storageUnchanged) {
    const expectedRules = buildRules(nextSites);
    if (dynamicRulesEqual(originalRules, expectedRules)) return previousSites;
    try {
      await replaceDynamicRules(nextSites, originalRules);
      return previousSites;
    } catch (error) {
      try {
        await restoreDynamicRulesSnapshot(originalRules);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "DNR repair failed and its prior rule snapshot could not be restored");
      }
      throw error;
    }
  }
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: nextSites });
    if (nextUrls === null || Object.keys(nextUrls).length === 0) await chrome.storage.local.remove(LAST_BLOCKED_URLS_KEY);
    else await chrome.storage.local.set({ [LAST_BLOCKED_URLS_KEY]: nextUrls });
    await replaceDynamicRules(nextSites, originalRules);
    await markStartTabDataChanged();
    return nextSites;
  } catch (error) {
    try {
      await restoreBlocklistTransaction(original, originalRules);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Blocklist mutation failed and rollback was incomplete");
    }
    throw error;
  }
}

export async function blockHost(host: string): Promise<void> {
  const normalized = requireHost(host);
  if (isPageContext()) {
    await sendMessage({ type: "block", host: normalized });
    return;
  }
  await migrateLegacyStorage();
  await runMutation(() => applyBlocklistMutation((current) => ({
    sites: current.sites.includes(normalized) ? current.sites : [...current.sites, normalized],
    lastBlockedUrls: current.lastBlockedUrls,
  })));
}

export async function unblockHost(host: string): Promise<boolean> {
  const normalized = requireHost(host);
  if (isPageContext()) {
    const ack = await sendMessage({ type: "unblock", host: normalized });
    return ack.changed === true;
  }
  await migrateLegacyStorage();
  return runMutation(async () => {
    let changed = false;
    await applyBlocklistMutation((current) => {
      changed = current.sites.includes(normalized);
      if (changed) delete current.lastBlockedUrls[normalized];
      return {
        sites: changed ? current.sites.filter((site) => site !== normalized) : current.sites,
        lastBlockedUrls: current.lastBlockedUrls,
      };
    });
    return changed;
  });
}

export async function clearAll(): Promise<void> {
  if (isPageContext()) {
    await sendMessage({ type: "clear" });
    return;
  }
  await migrateLegacyStorage();
  await runMutation(() => applyBlocklistMutation(() => ({ sites: [], lastBlockedUrls: null })));
}
