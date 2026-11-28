import { withStorageLock } from "./storage-lock.js";

export const NATIVE_NEW_TAB_BYPASS_KEY = "startTabNativeNewTabBypass";

interface NativeNewTabBypass {
  tabId?: number;
  expiresAt?: number;
  consumedAt?: number;
}

export interface NativeNewTabOpenOptions {
  consumptionTimeoutMs?: number;
  pollIntervalMs?: number;
}

const NATIVE_NEW_TAB_URLS = [
  "chrome://new-tab-page/",
  "chrome-search://local-ntp/local-ntp.html",
  "about:newtab",
] as const;
const NATIVE_NEW_TAB_BYPASS_LOCK = "native-new-tab-bypass";
const PREVIOUS_BYPASSES_KEY = "startTabNativeNewTabPreviousBypasses";
const MAX_PREVIOUS_BYPASSES = 256;

interface ConsumedBypass { tabId: number; expiresAt: number; consumedAt: number }

function isLiveConsumedBypass(value: unknown, now: number): value is ConsumedBypass {
  if (!value || typeof value !== "object") return false;
  const grant = value as Partial<ConsumedBypass>;
  return typeof grant.tabId === "number" && Number.isSafeInteger(grant.tabId) && grant.tabId >= 0
    && typeof grant.expiresAt === "number" && Number.isFinite(grant.expiresAt) && grant.expiresAt > now
    && typeof grant.consumedAt === "number" && Number.isFinite(grant.consumedAt)
    && grant.consumedAt < grant.expiresAt;
}

function livePreviousBypasses(value: unknown, now: number): ConsumedBypass[] {
  return Array.isArray(value) ? value.filter((grant): grant is ConsumedBypass => isLiveConsumedBypass(grant, now)) : [];
}

async function waitForNativeBypassConsumption(
  tabId: number,
  expiresAt: number,
  pollIntervalMs: number,
): Promise<boolean> {
  while (Date.now() < expiresAt) {
    const items = await chrome.storage.local.get(NATIVE_NEW_TAB_BYPASS_KEY);
    const value = items[NATIVE_NEW_TAB_BYPASS_KEY] as NativeNewTabBypass | undefined;
    if (value?.tabId !== tabId || value.expiresAt !== expiresAt) return false;
    if (typeof value.consumedAt === "number") return true;
    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)));
  }
  return false;
}

async function writeOwnedBypass(tabId: number, timeoutMs: number): Promise<number> {
  return withStorageLock(NATIVE_NEW_TAB_BYPASS_LOCK, async () => {
    // Start this attempt's timeout only when its grant can actually be
    // published. Time spent queued behind an older consumer is not usable
    // navigation time and must not make the new grant stale on arrival.
    const items = await chrome.storage.local.get([NATIVE_NEW_TAB_BYPASS_KEY, PREVIOUS_BYPASSES_KEY]);
    const now = Date.now();
    const expiresAt = Date.now() + timeoutMs;
    const previous = items[NATIVE_NEW_TAB_BYPASS_KEY];
    const archived = livePreviousBypasses(items[PREVIOUS_BYPASSES_KEY], now)
      .filter(grant => grant.tabId !== tabId);
    // Open requests are serialized by the worker, but a previously opened
    // tab may still receive another eligible URL event during its lease.
    // Replacing the current grant must not revoke that consumed permission.
    if (isLiveConsumedBypass(previous, now) && previous.tabId !== tabId) {
      const index = archived.findIndex(grant => grant.tabId === previous.tabId);
      if (index >= 0) archived.splice(index, 1);
      archived.push(previous);
    }
    await chrome.storage.local.set({
      [NATIVE_NEW_TAB_BYPASS_KEY]: { tabId, expiresAt },
      ...(archived.length > 0 || items[PREVIOUS_BYPASSES_KEY] !== undefined
        ? { [PREVIOUS_BYPASSES_KEY]: archived.slice(-MAX_PREVIOUS_BYPASSES) } : {}),
    });
    return expiresAt;
  });
}

async function removeOwnedBypass(tabId: number): Promise<void> {
  await withStorageLock(NATIVE_NEW_TAB_BYPASS_LOCK, async () => {
    const items = await chrome.storage.local.get(NATIVE_NEW_TAB_BYPASS_KEY);
    const value = items[NATIVE_NEW_TAB_BYPASS_KEY] as NativeNewTabBypass | undefined;
    if (value?.tabId === tabId) await chrome.storage.local.remove(NATIVE_NEW_TAB_BYPASS_KEY);
  });
}

/** Only a tab whose live and pending URLs belong to this attempt may be
 * navigated or removed. Failure to inspect the tab is not proof of ownership. */
async function stillOwnsTemporaryTab(tabId: number, attempted: ReadonlySet<string>): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const urls = [tab.url, tab.pendingUrl].filter((url): url is string => typeof url === "string" && url.length > 0);
    return tab.id === tabId && urls.length > 0 && urls.every((url) => attempted.has(url));
  } catch {
    return false;
  }
}

/**
 * Open the browser-owned new-tab page without leaving an orphan about:blank tab
 * when every browser-specific URL is rejected or bypass consumption times out.
 */
export async function openNativeNewTab(options: NativeNewTabOpenOptions = {}): Promise<void> {
  const timeoutMs = Math.max(1, options.consumptionTimeoutMs ?? 5000);
  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 50);
  const tab = await chrome.tabs.create({ active: true, url: "about:blank" });
  if (typeof tab.id !== "number") throw new Error("The browser did not return a tab id");
  const tabId = tab.id;
  const failures: unknown[] = [];
  const attempted = new Set(["about:blank"]);

  for (const url of NATIVE_NEW_TAB_URLS) {
    if (!await stillOwnsTemporaryTab(tabId, attempted)) break;
    try {
      const expiresAt = await writeOwnedBypass(tabId, timeoutMs);
      // The grant write can wait behind another consumer. Recheck after it,
      // before issuing a browser navigation that could replace user content.
      if (!await stillOwnsTemporaryTab(tabId, attempted)) break;
      attempted.add(url);
      await chrome.tabs.update(tabId, { url });
      if (await waitForNativeBypassConsumption(tabId, expiresAt, pollIntervalMs)) return;
      failures.push(new Error(`Native new-tab bypass was not consumed for ${url}`));
    } catch (error) {
      failures.push(error);
    }
  }

  const primary = new AggregateError(failures, "The browser rejected every native new-tab URL");
  const cleanupErrors: unknown[] = [];
  try {
    await removeOwnedBypass(tabId);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    if (await stillOwnsTemporaryTab(tabId, attempted)) await chrome.tabs.remove(tabId);
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [primary, ...cleanupErrors],
      "Opening the native new tab failed and cleanup of its temporary tab was incomplete",
    );
  }
  throw primary;
}

export async function consumeNativeNewTabBypass(tabId: number): Promise<boolean> {
  return withStorageLock(NATIVE_NEW_TAB_BYPASS_LOCK, async () => {
    const items = await chrome.storage.local.get(NATIVE_NEW_TAB_BYPASS_KEY);
    const value = items[NATIVE_NEW_TAB_BYPASS_KEY] as NativeNewTabBypass | undefined;
    if (typeof value?.tabId === "number" && typeof value.expiresAt === "number") {
      if (value.expiresAt <= Date.now()) {
        // Expired cleanup shares the lock with publication of newer grants.
        await chrome.storage.local.remove(NATIVE_NEW_TAB_BYPASS_KEY);
        if (value.tabId === tabId) return false;
      } else if (value.tabId === tabId) {
        if (typeof value.consumedAt !== "number") {
          await chrome.storage.local.set({
            [NATIVE_NEW_TAB_BYPASS_KEY]: { ...value, consumedAt: Date.now() },
          });
        }
        return true;
      }
    }
    const previous = await chrome.storage.local.get(PREVIOUS_BYPASSES_KEY);
    return livePreviousBypasses(previous[PREVIOUS_BYPASSES_KEY], Date.now())
      .some(grant => grant.tabId === tabId);
  });
}
