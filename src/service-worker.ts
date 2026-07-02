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

chrome.runtime.onInstalled.addListener(() => {
  void migrateAndSyncRules();
});

chrome.runtime.onStartup.addListener(() => {
  void migrateAndSyncRules();
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
