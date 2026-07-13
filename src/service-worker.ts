/**
 * Manifest V3 service worker.
 *
 * It owns declarativeNetRequest synchronization, fallback new-tab redirects,
 * focus statistics, schema migration, and durable per-instance clock alarms.
 */

import {
  blockedSiteForUrl,
  blockHost,
  clearAll,
  migrateLegacyStorage,
  rememberBlockedNavigation,
  syncRules,
  unblockHost,
} from "./lib/blocklist.js";
import { recordBlockedNavigation, recordFocusSessionCompleted } from "./lib/focus-stats.js";
import { isMessage, type Ack, type Message } from "./lib/messages.js";
import {
  completeClockInstance,
  getStartPageRuntimeState,
  parseClockAlarmName,
  scheduleClockAlarm,
} from "./lib/start-page-runtime.js";
import { getStartPageSettings } from "./lib/start-page-settings.js";

const START_TAB_PAGE = "newtab.html";
const NATIVE_NEW_TAB_BYPASS_KEY = "startTabNativeNewTabBypass";
const LOCALE_OVERRIDE_KEY = "localeOverride";
const NEW_TAB_INTERNAL_SCHEMES = new Set([
  "chrome:",
  "chrome-search:",
  "chrome-untrusted:",
  "edge:",
  "brave:",
  "opera:",
  "vivaldi:",
  "comet:",
  "perplexity:",
]);
const SPLIT_VIEW_MARKERS = [
  "split-view",
  "split_view",
  "splitview",
  "split",
  "side-by-side",
  "sidebyside",
  "side_panel",
  "side-panel",
  "tab-picker",
  "tab_picker",
  "tabpicker",
  "select-tab",
  "select_tab",
  "selecttab",
  "picker",
  "pane",
];

interface NativeNewTabBypass {
  tabId?: number;
  expiresAt?: number;
}

interface LocaleCatalog {
  [key: string]: { message?: string };
}

function ignoreBackgroundError(): void {
  // Event listeners cannot surface async failures to callers in MV3.
}

chrome.runtime.onInstalled.addListener(() => {
  void migrateAndSyncRules().catch(ignoreBackgroundError);
});

chrome.runtime.onStartup.addListener(() => {
  void migrateAndSyncRules().catch(ignoreBackgroundError);
});

chrome.tabs.onCreated.addListener((tab) => {
  void redirectBrowserNewTab(tab.id, tab.url ?? tab.pendingUrl).catch(ignoreBackgroundError);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void redirectBrowserNewTab(tabId, changeInfo.url ?? tab.url ?? tab.pendingUrl).catch(ignoreBackgroundError);
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0 || !details.url) return;
  void rememberIfBlocked(details.url).catch(ignoreBackgroundError);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void handleClockAlarm(alarm.name).catch(ignoreBackgroundError);
});

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (ack: Ack) => void) => {
    if (!isMessage(message)) {
      sendResponse({ ok: false, error: "Unsupported message" });
      return false;
    }
    handle(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
    return true;
  },
);

async function handle(message: Message): Promise<void> {
  switch (message.type) {
    case "block": await blockHost(message.host); break;
    case "unblock": await unblockHost(message.host); break;
    case "clear": await clearAll(); break;
  }
}

async function handleClockAlarm(name: string): Promise<void> {
  const parsed = parseClockAlarmName(name);
  if (!parsed) return;
  const result = await completeClockInstance(parsed.instanceId, parsed.token);
  if (!result.completed || !result.block) return;
  if (result.focusTimeMs > 0) await recordFocusSessionCompleted(result.focusTimeMs);
  if (!result.notify) return;
  const messageKey = result.block.type === "pomodoro" ? "pomodoroDone" : "timerDone";
  await chrome.notifications.create(`start-tab-clock-${parsed.instanceId}-${parsed.token}`, {
    type: "basic",
    iconUrl: "icons/icon.128.png",
    title: result.block.title,
    message: await workerMessage(messageKey),
  });
}

async function workerMessage(key: string): Promise<string> {
  const nativeMessage = chrome.i18n.getMessage(key);
  const items = await chrome.storage.local.get(LOCALE_OVERRIDE_KEY);
  const override = items[LOCALE_OVERRIDE_KEY];
  if (override !== "en" && override !== "ru") return nativeMessage || key;
  try {
    const response = await fetch(chrome.runtime.getURL(`_locales/${override}/messages.json`));
    if (!response.ok) return nativeMessage || key;
    const catalog = await response.json() as LocaleCatalog;
    return catalog[key]?.message || nativeMessage || key;
  } catch {
    return nativeMessage || key;
  }
}

async function reconcileClockAlarms(): Promise<void> {
  const settings = await getStartPageSettings();
  const runtime = await getStartPageRuntimeState(settings);
  const clocks = new Map(Object.entries(runtime.clocks));
  const existing = await chrome.alarms.getAll();
  await Promise.all(existing.flatMap((alarm) => {
    const parsed = parseClockAlarmName(alarm.name);
    if (!parsed) return [];
    const clock = clocks.get(parsed.instanceId);
    if (!clock || !clock.running || clock.completionToken !== parsed.token || clock.targetAt === null) {
      return [chrome.alarms.clear(alarm.name)];
    }
    return [];
  }));

  const now = Date.now();
  for (const [instanceId, clock] of clocks) {
    if (!clock.running || clock.type === "stopwatch" || clock.targetAt === null || !clock.completionToken) continue;
    if (clock.targetAt <= now + 1000) {
      await handleClockAlarm(`start-tab-clock:${encodeURIComponent(instanceId)}:${encodeURIComponent(clock.completionToken)}`);
    } else {
      await scheduleClockAlarm(instanceId, clock);
    }
  }
}

async function redirectBrowserNewTab(tabId: number | undefined, url: string | undefined): Promise<void> {
  if (tabId === undefined || !url) return;
  if (isStartTabUrl(url) || !isBrowserNewTabUrl(url)) return;
  if (isNativeSplitViewPickerUrl(url)) return;
  if (await shouldBypassNativeNewTab(tabId)) return;
  if (!await shouldRedirectBrowserNewTabs()) return;
  try {
    await chrome.tabs.update(tabId, { url: chrome.runtime.getURL(START_TAB_PAGE) });
  } catch {
    // Some Chromium-derived browsers do not expose their internal new tab page.
  }
}

async function shouldRedirectBrowserNewTabs(): Promise<boolean> {
  const manifest = chrome.runtime.getManifest();
  if (manifest.chrome_url_overrides?.newtab !== START_TAB_PAGE) return false;
  return (await getStartPageSettings()).startTab.enabled;
}

async function shouldBypassNativeNewTab(tabId: number): Promise<boolean> {
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

function isStartTabUrl(url: string): boolean {
  return url === chrome.runtime.getURL(START_TAB_PAGE);
}

function isBrowserNewTabUrl(url: string): boolean {
  if (url === "about:newtab") return true;
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase();
    const marker = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
    if (!NEW_TAB_INTERNAL_SCHEMES.has(protocol)) return false;
    return marker === "newtab/" || marker.includes("newtab") || marker.includes("new-tab") || marker.includes("new_tab") || marker.includes("local-ntp");
  } catch {
    return false;
  }
}

function isNativeSplitViewPickerUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!NEW_TAB_INTERNAL_SCHEMES.has(parsed.protocol.toLowerCase())) return false;
    const haystack = `${parsed.protocol}//${parsed.hostname}${parsed.pathname}${parsed.search}${parsed.hash}`.toLowerCase();
    return SPLIT_VIEW_MARKERS.some((marker) => haystack.includes(marker));
  } catch {
    return false;
  }
}

async function rememberIfBlocked(url: string): Promise<void> {
  const host = await blockedSiteForUrl(url);
  if (!host) return;
  await rememberBlockedNavigation(url);
  await recordBlockedNavigation(host);
}

async function migrateAndSyncRules(): Promise<void> {
  await migrateLegacyStorage();
  await getStartPageSettings();
  await reconcileClockAlarms();
  await syncRules();
}
