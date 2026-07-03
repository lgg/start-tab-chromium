/**
 * Service worker (MV3 replacement for the old persistent background page).
 *
 * It owns the single source of truth for declarativeNetRequest rules: it
 * resyncs them from storage on install/startup and whenever the popup or
 * blocked page asks it to mutate the blocklist.
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
import { recordBlockedNavigation } from "./lib/focus-stats.js";
import { isMessage, type Ack, type Message } from "./lib/messages.js";
import { getStartPageSettings } from "./lib/start-page-settings.js";

const START_TAB_PAGE = "newtab.html";
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

chrome.runtime.onInstalled.addListener(() => {
  void migrateAndSyncRules();
});

chrome.runtime.onStartup.addListener(() => {
  void migrateAndSyncRules();
});

chrome.tabs.onCreated.addListener((tab) => {
  void redirectBrowserNewTab(tab.id, tab.url ?? tab.pendingUrl);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void redirectBrowserNewTab(tabId, changeInfo.url ?? tab.url ?? tab.pendingUrl);
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0 || !details.url) return;
  void rememberIfBlocked(details.url);
});

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (ack: Ack) => void) => {
    if (!isMessage(message)) {
      sendResponse({ ok: false, error: "Unsupported message" });
      return false;
    }

    handle(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: String(error) }),
      );
    // Returning true keeps the message channel open for the async response.
    return true;
  },
);

async function handle(message: Message): Promise<void> {
  switch (message.type) {
    case "block":
      await blockHost(message.host);
      break;
    case "unblock":
      await unblockHost(message.host);
      break;
    case "clear":
      await clearAll();
      break;
  }
}

async function redirectBrowserNewTab(tabId: number | undefined, url: string | undefined): Promise<void> {
  if (tabId === undefined || !url) return;
  if (isStartTabUrl(url) || !isBrowserNewTabUrl(url)) return;
  if (isNativeSplitViewPickerUrl(url)) return;
  if (!await shouldRedirectBrowserNewTabs()) return;

  try {
    await chrome.tabs.update(tabId, { url: chrome.runtime.getURL(START_TAB_PAGE) });
  } catch {
    // Some Chromium-derived browsers may not expose their internal new tab page
    // to extension tab updates. The manifest override remains the primary path.
  }
}

async function shouldRedirectBrowserNewTabs(): Promise<boolean> {
  const manifest = chrome.runtime.getManifest();
  if (manifest.chrome_url_overrides?.newtab !== START_TAB_PAGE) return false;
  return (await getStartPageSettings()).startTab.enabled;
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
    return marker === "newtab/"
      || marker.includes("newtab")
      || marker.includes("new-tab")
      || marker.includes("new_tab")
      || marker.includes("local-ntp");
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
  await syncRules();
}
