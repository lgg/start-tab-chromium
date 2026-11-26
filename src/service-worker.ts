/**
 * Manifest V3 service worker.
 *
 * It owns declarativeNetRequest synchronization, fallback new-tab redirects,
 * focus statistics, schema migration, and every mutation of durable clocks.
 */

import {
  blockHost,
  clearAll,
  migrateLegacyStorage,
  rememberBlockedNavigation,
  replaceBlockedSites,
  syncRules,
  unblockHost,
} from "./lib/blocklist.js";
import {
  recordBlockedNavigation,
  FOCUS_STATS_KEY,
  applyFocusClockStatsPatchInExistingTransaction,
  recordUnblockAfterCountdown,
  resetFocusStats,
} from "./lib/focus-stats.js";
import { ownValue } from "./lib/dictionary.js";
import { jsonContentEqual } from "./lib/json-content.js";
import { MAX_NOTE_LENGTH } from "./lib/platform-limits.js";
import { runIndependentEffects } from "./lib/independent-effects.js";
import { containsSplitViewMarker } from "./lib/split-view-markers.js";
import { changedTabNavigationUrl, currentTabNavigationUrl, NewTabRedirectGuard } from "./lib/tab-navigation-change.js";
import { assertRuntimeMutationTarget } from "./lib/runtime-mutation-target.js";
import { isMessage, type Ack, type ClockAction, type Message } from "./lib/messages.js";
import { consumeNativeNewTabBypass, openNativeNewTab } from "./lib/native-new-tab.js";
import { BlockedNavigationRegistry, isBlockedPageNavigation, readBlockedDestinationForSender, mayMutateFromBlockedPage } from "./lib/blocked-navigation.js";
import {
  completeClockInstance,
  defaultClockForBlock,
  deleteInstanceRuntime,
  getStartPageRuntimeState,
  parseClockAlarmName,
  pauseClockState,
  reconcileStoredClockAlarms,
  rearmClockAlarmIfPending,
  replaceStartPageSettingsWithRuntime,
  resetAllClockRuntimeWithAlarms,
  resetClockState,
  resetStartPageData,
  startClockState,
  mutateStartPageRuntimeStateWithAlarmsAndStorageEffect,
  pomodoroFocusElapsedMs,
  updateStartPageRuntimeState,
} from "./lib/start-page-runtime.js";
import {
  blockTitleKey,
  blockUsesDefaultTitle,
  getStartPageSettings,
  type BlockInstance,
  type ClockRuntimeState,
  type LocalTask,
  type StartPageSettings,
} from "./lib/start-page-settings.js";

const START_TAB_PAGE = "newtab.html";
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
interface LocaleCatalog {
  [key: string]: { message?: string };
}

interface HandlerResult {
  changed?: boolean;
  runtimeUpdatedAt?: number;
  savedSettings?: StartPageSettings;
  blockedUrl?: string;
  savedTasks?: LocalTask[];
  savedLinkPage?: number;
  notificationFailed?: true;
}

type ClockBlock = Extract<BlockInstance, { type: "timer" | "stopwatch" | "pomodoro" }>;

let runtimeJob: Promise<unknown> = Promise.resolve();
let statsJob: Promise<void> = Promise.resolve();
let nativeTabJob: Promise<void> = Promise.resolve();
const blockedNavigations = new BlockedNavigationRegistry(() => chrome.storage.session);
const blockedPageUrl = (): string => chrome.runtime.getURL("blocked.html");

const newTabRedirectGuard = new NewTabRedirectGuard({
  isEligible: (url) => !isStartTabUrl(url) && isBrowserNewTabUrl(url) && !isNativeSplitViewPickerUrl(url),
  getTab: (tabId) => chrome.tabs.get(tabId),
  shouldBypass: shouldBypassNativeNewTab,
  isEnabled: shouldRedirectBrowserNewTabs,
  redirect: async (tabId) => {
    try {
      await chrome.tabs.update(tabId, { url: chrome.runtime.getURL(START_TAB_PAGE) });
    } catch {
      // Some Chromium-derived browsers do not expose their internal new tab page.
    }
  },
});

function ignoreBackgroundError(): void {
  // Event listeners cannot surface async failures to callers in MV3.
}

function isClockBlock(block: BlockInstance): block is ClockBlock {
  return block.type === "timer" || block.type === "stopwatch" || block.type === "pomodoro";
}

function runStatsJob(operation: () => Promise<void>): Promise<void> {
  const next = statsJob.catch(ignoreBackgroundError).then(operation);
  statsJob = next;
  return next;
}

function runRuntimeJob<T>(operation: () => Promise<T>): Promise<T> {
  const next = runtimeJob.catch(ignoreBackgroundError).then(operation);
  runtimeJob = next;
  return next;
}

chrome.runtime.onInstalled.addListener(() => {
  void migrateAndSyncRules().catch(ignoreBackgroundError);
});

chrome.runtime.onStartup.addListener(() => {
  void migrateAndSyncRules().catch(ignoreBackgroundError);
});

chrome.tabs.onCreated.addListener((tab) => {
  void newTabRedirectGuard.observe(tab.id, currentTabNavigationUrl(tab)).catch(ignoreBackgroundError);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const url = changedTabNavigationUrl(changeInfo);
  if (!url) return;
  void newTabRedirectGuard.observe(tabId, url).catch(ignoreBackgroundError);
});

chrome.tabs.onRemoved.addListener((tabId) => newTabRedirectGuard.cancel(tabId));
chrome.tabs.onRemoved.addListener((tabId) => {
  void blockedNavigations.forget(tabId).catch(ignoreBackgroundError);
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0 || !details.url || isBlockedPageNavigation(details.url, blockedPageUrl())) return;
  void rememberIfBlocked(details.tabId, details.url).catch(ignoreBackgroundError);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  const parsed = parseClockAlarmName(alarm.name);
  if (!parsed) return;
  void runRuntimeJob(() => finishClockAlarm(parsed.instanceId, parsed.token)).catch(ignoreBackgroundError);
});

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse: (ack: Ack) => void) => {
    if (!isMessage(message)) {
      sendResponse({ ok: false, error: "Unsupported message" });
      return false;
    }
    handle(message, sender)
      .then((result) => sendResponse({ ok: true, ...(result ?? {}) }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  },
);

function runNativeTabJob(operation: () => Promise<void>): Promise<void> {
  const next = nativeTabJob.catch(ignoreBackgroundError).then(operation);
  nativeTabJob = next;
  return next;
}

async function handle(message: Message, sender: chrome.runtime.MessageSender): Promise<HandlerResult | void> {
  if ((message.type === "unblock" || message.type === "record-unblock")
    && !mayMutateFromBlockedPage(sender, blockedPageUrl(), message.host)) {
    throw new Error("Blocked page mutation requires an active top-level document for the requested site");
  }
  switch (message.type) {
    case "block": await blockHost(message.host); break;
    case "unblock": return { changed: await unblockHost(message.host) };
    case "clear": await clearAll(message.expectedSites); break;
    case "replace-blocked-sites": await replaceBlockedSites(message.sites); break;
    case "open-native-new-tab": await runNativeTabJob(openNativeNewTab); break;
    case "reset-start-page": await runRuntimeJob(async () => { await resetStartPageData(); }); break;
    case "replace-start-page-settings": return {
      savedSettings: await runRuntimeJob(() => replaceStartPageSettingsWithRuntime(
        message.settings,
        message.expectedSettingsUpdatedAt,
        message.expectedRuntimeUpdatedAt,
        message.localeChange,
        message.completeOnboarding,
      )),
    };
    case "clock-action": await runRuntimeJob(() => performClockAction(message.instanceId, message.action)); break;
    case "complete-clock": return runRuntimeJob(() => finishClockCompletion(message.instanceId, message.token));
    case "reset-clocks": await runRuntimeJob(resetAllClocks); break;
    case "runtime-note": return { runtimeUpdatedAt: await runRuntimeJob(() => updateRuntimeNote(message.instanceId, message.value, message.expectedValue)) };
    case "runtime-tasks": return runRuntimeJob(() => updateRuntimeTasks(message.instanceId, message.tasks, message.expectedTasks));
    case "runtime-link-page": return runRuntimeJob(() => updateRuntimeLinkPage(message.instanceId, message.page, message.expectedPage));
    case "delete-instance-runtime": await runRuntimeJob(() => deleteInstanceRuntime(
      message.instanceId,
      message.expectedBlockUpdatedAt,
      message.expectedRuntimeUpdatedAt,
    )); break;
    case "blocked-original-url": {
      // Only the actual blocked page can retrieve its own tab's destination.
      const blockedUrl = await readBlockedDestinationForSender(
        sender, blockedPageUrl(), message.host,
        (id) => chrome.tabs.get(id),
        (id, host) => blockedNavigations.lookup(id, host),
        (id) => chrome.webNavigation.getFrame({ tabId: id, frameId: 0 }),
      );
      return blockedUrl ? { blockedUrl } : {};
    }
    case "record-unblock": await runStatsJob(() => recordUnblockAfterCountdown(message.host)); break;
    case "reset-stats": await runStatsJob(resetFocusStats); break;
  }
}

export function sameTasks(left: readonly LocalTask[], right: readonly LocalTask[]): boolean {
  return jsonContentEqual(left, right);
}

async function updateRuntimeNote(instanceId: string, value: string, expectedValue: string): Promise<number> {
  const saved = await updateStartPageRuntimeState((runtime, settings) => {
    assertRuntimeMutationTarget(settings, instanceId, "note");
    const current = ownValue(runtime.notes, instanceId) ?? "";
    if (current !== expectedValue) {
      throw new Error("Start Tab note changed in another extension context; latest data was kept");
    }
    runtime.notes[instanceId] = value.slice(0, MAX_NOTE_LENGTH);
    return runtime;
  });
  return saved.updatedAt;
}

async function updateRuntimeTasks(instanceId: string, tasks: LocalTask[], expectedTasks: LocalTask[]): Promise<HandlerResult> {
  const saved = await updateStartPageRuntimeState((runtime, settings) => {
    assertRuntimeMutationTarget(settings, instanceId, "tasks");
    const current = ownValue(runtime.tasks, instanceId) ?? [];
    if (!sameTasks(current, expectedTasks)) {
      throw new Error("Start Tab tasks changed in another extension context; latest data was kept");
    }
    runtime.tasks[instanceId] = structuredClone(tasks);
    return runtime;
  });
  return { runtimeUpdatedAt: saved.updatedAt, savedTasks: ownValue(saved.tasks, instanceId) ?? [] };
}

async function updateRuntimeLinkPage(instanceId: string, page: number, expectedPage: number): Promise<HandlerResult> {
  const saved = await updateStartPageRuntimeState((runtime, settings) => {
    assertRuntimeMutationTarget(settings, instanceId, "linkPage");
    const current = ownValue(runtime.linkPages, instanceId) ?? 0;
    if (current !== expectedPage) {
      throw new Error("Start Tab link page changed in another extension context; latest data was kept");
    }
    runtime.linkPages[instanceId] = Math.min(10_000, Math.max(0, Math.round(page)));
    return runtime;
  });
  return { runtimeUpdatedAt: saved.updatedAt, savedLinkPage: ownValue(saved.linkPages, instanceId) ?? 0 };
}

async function performClockAction(instanceId: string, action: ClockAction): Promise<void> {
  await mutateStartPageRuntimeStateWithAlarmsAndStorageEffect<{
    next: ClockRuntimeState;
    interruptedMs: number;
    startedWork: boolean;
    occurredAt: number;
  } | null>((runtime, settings) => {
    const now = Date.now();
    assertRuntimeMutationTarget(settings, instanceId, "clock");
    const block = settings.layout.blocks.find(
      (candidate): candidate is ClockBlock => candidate.id === instanceId && isClockBlock(candidate),
    ) ?? null;
    if (!block) return { state: null, result: null };
    const clock = ownValue(runtime.clocks, instanceId) ?? defaultClockForBlock(block);
    // Two pages can display the same Start/Pause button. Apply the intended
    // state under the lock instead of inverting an already changed clock.
    if ((action === "start" && clock.running) || (action === "pause" && !clock.running)) {
      return { state: null, result: null };
    }
    let next: ClockRuntimeState;
    let interruptedMs = 0;
    let startedWork = false;

    if (action === "reset") {
      if (block.type === "pomodoro" && clock.running && clock.phase === "work" && clock.focusSessionStartedAt !== null) {
        interruptedMs = pomodoroFocusElapsedMs(clock, now);
      }
      next = resetClockState(block);
    } else if (clock.running) {
      if (block.type === "pomodoro" && clock.phase === "work" && clock.focusSessionStartedAt !== null) {
        interruptedMs = pomodoroFocusElapsedMs(clock, now);
      }
      next = pauseClockState(clock, now);
      if (next.type === "pomodoro") next.focusSessionStartedAt = null;
    } else {
      startedWork = block.type === "pomodoro" && (clock.phase ?? "work") === "work";
      next = startClockState(clock, now);
    }

    runtime.clocks[instanceId] = next;
    return { state: runtime, result: { next, interruptedMs, startedWork, occurredAt: now } };
  }, [FOCUS_STATS_KEY], async (outcome) => {
    if (!outcome || (!outcome.startedWork && outcome.interruptedMs <= 0)) return;
    await applyFocusClockStatsPatchInExistingTransaction({
      startedSessions: outcome.startedWork ? 1 : 0,
      interruptedFocusTimesMs: outcome.interruptedMs > 0 ? [outcome.interruptedMs] : [],
      occurredAt: outcome.occurredAt,
    });
  });
}

async function resetAllClocks(): Promise<void> {
  await resetAllClockRuntimeWithAlarms();
}

async function finishClockAlarm(instanceId: string, token: string): Promise<void> {
  try {
    await finishClockCompletion(instanceId, token);
  } catch (error) {
    try {
      // Avoid a tight retry loop when storage is temporarily unavailable.
      await rearmClockAlarmIfPending(instanceId, token, 30_000);
    } catch (rearmError) {
      throw new AggregateError([error, rearmError], "Clock completion and alarm retry both failed");
    }
    throw error;
  }
  // A clock change or stale token makes this a no-op. An early alarm must
  // still have its original deadline covered even when no page is open.
  await rearmClockAlarmIfPending(instanceId, token, 100);
}

async function finishClockCompletion(instanceId: string, token: string): Promise<HandlerResult | void> {
  const result = await completeClockInstance(instanceId, token);
  // completeClockInstance performs the same durable scheduleClockAlarm reconciliation atomically.
  if (!result.completed || !result.block || !result.clock) return;
  const block = result.block;
  if (!result.notify) return;
  const messageKey = block.type === "pomodoro" ? "pomodoroDone" : "timerDone";
  try {
    await chrome.notifications.create(`start-tab-clock-${instanceId}-${token}`, {
      type: "basic",
      iconUrl: "icons/icon.128.png",
      title: blockUsesDefaultTitle(block) ? await workerMessage(blockTitleKey(block.type)) : block.title,
      message: await workerMessage(messageKey),
    });
  } catch (error) {
    // Runtime, statistics and next-phase alarms have already committed.
    // Never report a failed clock mutation or retry its completion solely
    // because the optional notification could not be delivered.
    console.warn("Start Tab clock completed, but its notification failed", error);
    return { notificationFailed: true };
  }
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
  await reconcileStoredClockAlarms();
}

async function shouldRedirectBrowserNewTabs(): Promise<boolean> {
  const manifest = chrome.runtime.getManifest();
  if (manifest.chrome_url_overrides?.newtab !== START_TAB_PAGE) return false;
  return (await getStartPageSettings()).startTab.enabled;
}

async function shouldBypassNativeNewTab(tabId: number): Promise<boolean> {
  return consumeNativeNewTabBypass(tabId);
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
    return containsSplitViewMarker(haystack);
  } catch {
    return false;
  }
}

async function rememberIfBlocked(tabId: number, url: string): Promise<void> {
  let matched: string | null = null;
  try {
    await blockedNavigations.observe(tabId, url, async (destination) => {
      matched = await rememberBlockedNavigation(destination);
      return matched;
    });
  } finally {
    // Preserve statistics independently if session storage failed after
    // matching/remembering the host in the existing local transaction.
    if (matched) await runStatsJob(() => recordBlockedNavigation(matched!));
  }
}

async function migrateAndSyncRules(): Promise<void> {
  // Settings migration and alarms are independent of DNR reconciliation.
  // A damaged layout must not prevent startup repair of the site blocker,
  // and a blocker migration error must not prevent clock recovery.
  await runIndependentEffects([
    async () => {
      const settings = await getStartPageSettings();
      await getStartPageRuntimeState(settings);
    },
    reconcileClockAlarms,
    async () => {
      await migrateLegacyStorage();
      await syncRules();
    },
  ], "Start Tab startup reconciliation was incomplete");
}
