/**
 * Shared blocklist logic: persistence in chrome.storage.local and the
 * declarativeNetRequest (DNR) dynamic rules that actually do the blocking.
 *
 * Manifest V3 removed blocking webRequest, so instead of intercepting each
 * request in a background page we install one DNR redirect rule per blocked
 * host. Any top-level navigation to a blocked host is redirected to the
 * extension's blocked.html page.
 */

import { commitStorageMutationWithRevision, DATA_REVISION_KEY, markStartTabDataChanged } from "./data-revision.js";
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
  const normalized: Record<string, string> = {};
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

function requireHost(host: string): string {
  const normalized = normalizeStoredHost(host);
  if (!normalized) throw new Error("Invalid host");
  return normalized;
}

function hostMatchesBlockedSite(host: string, site: string): boolean {
  return host === site || host.endsWith(`.${site}`);
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
  migrationPromise ??= withStorageLock("data-write", async () => {
    const items = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
    const current = Array.isArray(items[STORAGE_KEY]) ? (items[STORAGE_KEY] as string[]) : [];
    const legacy = Array.isArray(items[LEGACY_STORAGE_KEY]) ? (items[LEGACY_STORAGE_KEY] as string[]) : [];
    if (legacy.length === 0) return;
    const normalized = normalizeBlockedSites([...current, ...legacy]);
    assertBlockedSiteCapacity(normalized);
    await commitStorageMutationWithRevision(
      [STORAGE_KEY, LEGACY_STORAGE_KEY],
      async () => {
        await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
        await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
      },
    );
  }).catch((error) => {
    migrationPromise = undefined;
    throw error;
  });
  await migrationPromise;
}

async function getLastBlockedUrls(): Promise<Record<string, string>> {
  const items = await chrome.storage.local.get(LAST_BLOCKED_URLS_KEY);
  return normalizeLastBlockedUrls(items[LAST_BLOCKED_URLS_KEY]);
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
  return sites.find((site) => hostMatchesBlockedSite(host, site)) ?? null;
}

export async function isBlocked(url: string): Promise<boolean> {
  return (await blockedSiteForUrl(url)) !== null;
}

export async function rememberBlockedNavigation(url: string): Promise<void> {
  const urlHost = hostFromUrl(url);
  if (!urlHost) return;
  await migrateLegacyStorage();
  await withStorageLock("data-write", async () => {
    const sites = await readBlockedSites();
    const host = sites.find((site) => hostMatchesBlockedSite(urlHost, site));
    if (!host) return;
    const urls = await getLastBlockedUrls();
    urls[host] = url;
    await commitStorageMutationWithRevision(
      [LAST_BLOCKED_URLS_KEY],
      () => chrome.storage.local.set({ [LAST_BLOCKED_URLS_KEY]: urls }),
    );
  });
}

export async function getLastBlockedUrl(host: string): Promise<string | null> {
  const normalized = normalizeStoredHost(host);
  if (!normalized) return null;
  const urls = await getLastBlockedUrls();
  const url = urls[normalized];
  return typeof url === "string" ? url : null;
}

export async function clearLastBlockedUrl(host: string): Promise<void> {
  const normalized = normalizeStoredHost(host);
  if (!normalized) return;
  await withStorageLock("data-write", async () => {
    const urls = await getLastBlockedUrls();
    if (!Object.prototype.hasOwnProperty.call(urls, normalized)) return;
    delete urls[normalized];
    await commitStorageMutationWithRevision(
      [LAST_BLOCKED_URLS_KEY],
      () => chrome.storage.local.set({ [LAST_BLOCKED_URLS_KEY]: urls }),
    );
  });
}

function buildRules(sites: string[]): chrome.declarativeNetRequest.Rule[] {
  const normalized = normalizeBlockedSites(sites);
  assertBlockedSiteCapacity(normalized);
  return normalized.map((host, index) => ({
    id: index + 1,
    priority: 1,
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

async function replaceDynamicRules(sites: string[]): Promise<void> {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: buildRules(sites),
  });
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
  if (Object.keys(payload).length > 0) await chrome.storage.local.set(payload);
  if (removals.length > 0) await chrome.storage.local.remove(removals);
}

async function applyBlocklistMutation(
  transform: (current: { sites: string[]; lastBlockedUrls: Record<string, string> }) => BlocklistMutationState,
): Promise<string[]> {
  const original = await chrome.storage.local.get([STORAGE_KEY, LAST_BLOCKED_URLS_KEY, DATA_REVISION_KEY]);
  const previousSites = normalizeBlockedSites(original[STORAGE_KEY]);
  const current = { sites: previousSites, lastBlockedUrls: normalizeLastBlockedUrls(original[LAST_BLOCKED_URLS_KEY]) };
  const requested = transform(structuredClone(current));
  const nextSites = normalizeBlockedSites(requested.sites);
  assertBlockedSiteCapacity(nextSites);
  const nextUrls = requested.lastBlockedUrls === null ? null : normalizeLastBlockedUrls(requested.lastBlockedUrls);
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: nextSites });
    if (nextUrls === null || Object.keys(nextUrls).length === 0) await chrome.storage.local.remove(LAST_BLOCKED_URLS_KEY);
    else await chrome.storage.local.set({ [LAST_BLOCKED_URLS_KEY]: nextUrls });
    await replaceDynamicRules(nextSites);
    await markStartTabDataChanged();
    return nextSites;
  } catch (error) {
    try {
      await restoreBlocklistStorage(original);
      await replaceDynamicRules(previousSites);
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

export async function unblockHost(host: string): Promise<void> {
  const normalized = requireHost(host);
  if (isPageContext()) {
    await sendMessage({ type: "unblock", host: normalized });
    return;
  }
  await migrateLegacyStorage();
  await runMutation(() => applyBlocklistMutation((current) => {
    delete current.lastBlockedUrls[normalized];
    return { sites: current.sites.filter((site) => site !== normalized), lastBlockedUrls: current.lastBlockedUrls };
  }));
}

export async function clearAll(): Promise<void> {
  if (isPageContext()) {
    await sendMessage({ type: "clear" });
    return;
  }
  await migrateLegacyStorage();
  await runMutation(() => applyBlocklistMutation(() => ({ sites: [], lastBlockedUrls: null })));
}
