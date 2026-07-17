export const NATIVE_NEW_TAB_BYPASS_KEY = "startTabNativeNewTabBypass";

interface NativeNewTabBypass {
  tabId?: number;
  expiresAt?: number;
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

async function waitForNativeBypassConsumption(
  tabId: number,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const items = await chrome.storage.local.get(NATIVE_NEW_TAB_BYPASS_KEY);
    const value = items[NATIVE_NEW_TAB_BYPASS_KEY] as NativeNewTabBypass | undefined;
    if (value?.tabId !== tabId) return true;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return false;
}

async function removeOwnedBypass(tabId: number): Promise<void> {
  const items = await chrome.storage.local.get(NATIVE_NEW_TAB_BYPASS_KEY);
  const value = items[NATIVE_NEW_TAB_BYPASS_KEY] as NativeNewTabBypass | undefined;
  if (value?.tabId === tabId) await chrome.storage.local.remove(NATIVE_NEW_TAB_BYPASS_KEY);
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

  for (const url of NATIVE_NEW_TAB_URLS) {
    try {
      await chrome.storage.local.set({
        [NATIVE_NEW_TAB_BYPASS_KEY]: { tabId, expiresAt: Date.now() + timeoutMs },
      });
      await chrome.tabs.update(tabId, { url });
      if (await waitForNativeBypassConsumption(tabId, timeoutMs, pollIntervalMs)) return;
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
    await chrome.tabs.remove(tabId);
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
  const items = await chrome.storage.local.get(NATIVE_NEW_TAB_BYPASS_KEY);
  const value = items[NATIVE_NEW_TAB_BYPASS_KEY] as NativeNewTabBypass | undefined;
  if (typeof value?.tabId !== "number" || typeof value.expiresAt !== "number") return false;
  if (value.expiresAt < Date.now()) {
    await chrome.storage.local.remove(NATIVE_NEW_TAB_BYPASS_KEY);
    return false;
  }
  if (value.tabId !== tabId) return false;
  await chrome.storage.local.remove(NATIVE_NEW_TAB_BYPASS_KEY);
  return true;
}
