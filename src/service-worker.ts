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
import { MAX_NOTE_LENGTH } from "./lib/platform-limits.js";
import { runIndependentEffects } from "./lib/independent-effects.js";
import { isMessage, type Ack, type ClockAction, type Message } from "./lib/messages.js";
import { consumeNativeNewTabBypass, openNativeNewTab } from "./lib/native-new-tab.js";
import {
  completeClockInstance,
  defaultClockForBlock,
  deleteInstanceRuntime,
  getStartPageRuntimeState,
  parseClockAlarmName,
  pauseClockState,
  reconcileStoredClockAlarms,
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
  getStartPageSettings,
  type BlockInstance,
  type ClockRuntimeState,
  type LocalTask,
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

interface LocaleCatalog {
  [key: string]: { message?: string };
}

interface HandlerResult {
  changed?: boolean;
}

type ClockBlock = Extract<BlockInstance, { type: "timer" | "stopwatch" | "pomodoro" }>;

let runtimeJob: Promise<void> = Promise.resolve();
let statsJob: Promise<void> = Promise.resolve();
let nativeTabJob: Promise<void> = Promise.resolve();

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

function runRuntimeJob(operation: () => Promise<void>): Promise<void> {
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
  const parsed = parseClockAlarmName(alarm.name);
  if (!parsed) return;
  void runRuntimeJob(() => finishClockCompletion(parsed.instanceId, parsed.token)).catch(ignoreBackgroundError);
});

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (ack: Ack) => void) => {
    if (!isMessage(message)) {
      sendResponse({ ok: false, error: "Unsupported message" });
      return false;
    }
    handle(message)
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

async function handle(message: Message): Promise<HandlerResult | void> {
  switch (message.type) {
    case "block": await blockHost(message.host); break;
    case "unblock": return { changed: await unblockHost(message.host) };
    case "clear": await clearAll(); break;
    case "replace-blocked-sites": await replaceBlockedSites(message.sites); break;
    case "open-native-new-tab": await runNativeTabJob(openNativeNewTab); break;
    case "reset-start-page": await runRuntimeJob(async () => { await resetStartPageData(); }); break;
    case "replace-start-page-settings": await runRuntimeJob(async () => {
      await replaceStartPageSettingsWithRuntime(
        message.settings,
        message.expectedSettingsUpdatedAt,
        message.expectedRuntimeUpdatedAt,
      );
    }); break;
    case "clock-action": await runRuntimeJob(() => performClockAction(message.instanceId, message.action)); break;
    case "complete-clock": await runRuntimeJob(() => finishClockCompletion(message.instanceId, message.token)); break;
    case "reset-clocks": await runRuntimeJob(resetAllClocks); break;
    case "runtime-note": await runRuntimeJob(() => updateRuntimeNote(message.instanceId, message.value, message.expectedValue)); break;
    case "runtime-tasks": await runRuntimeJob(() => updateRuntimeTasks(message.instanceId, message.tasks, message.expectedTasks)); break;
    case "runtime-link-page": await runRuntimeJob(() => updateRuntimeLinkPage(message.instanceId, message.page, message.expectedPage)); break;
    case "delete-instance-runtime": await runRuntimeJob(() => deleteInstanceRuntime(message.instanceId)); break;
    case "record-unblock": await runStatsJob(() => recordUnblockAfterCountdown(message.host)); break;
    case "reset-stats": await runStatsJob(resetFocusStats); break;
  }
}

function sameTasks(left: readonly LocalTask[], right: readonly LocalTask[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function updateRuntimeNote(instanceId: string, value: string, expectedValue: string): Promise<void> {
  await updateStartPageRuntimeState((runtime) => {
    const current = ownValue(runtime.notes, instanceId) ?? "";
    if (current !== expectedValue) {
      throw new Error("Start Tab note changed in another extension context; latest data was kept");
    }
    runtime.notes[instanceId] = value.slice(0, MAX_NOTE_LENGTH);
    return runtime;
  });
}

async function updateRuntimeTasks(instanceId: string, tasks: LocalTask[], expectedTasks: LocalTask[]): Promise<void> {
  await updateStartPageRuntimeState((runtime) => {
    const current = ownValue(runtime.tasks, instanceId) ?? [];
    if (!sameTasks(current, expectedTasks)) {
      throw new Error("Start Tab tasks changed in another extension context; latest data was kept");
    }
    runtime.tasks[instanceId] = structuredClone(tasks);
    return runtime;
  });
}

async function updateRuntimeLinkPage(instanceId: string, page: number, expectedPage: number): Promise<void> {
  await updateStartPageRuntimeState((runtime) => {
    const current = ownValue(runtime.linkPages, instanceId) ?? 0;
    if (current !== expectedPage) {
      throw new Error("Start Tab link page changed in another extension context; latest data was kept");
    }
    runtime.linkPages[instanceId] = Math.min(10_000, Math.max(0, Math.round(page)));
    return runtime;
  });
}

async function performClockAction(instanceId: string, action: ClockAction): Promise<void> {
  const now = Date.now();
  await mutateStartPageRuntimeStateWithAlarmsAndStorageEffect<{
    next: ClockRuntimeState;
    interruptedMs: number;
    startedWork: boolean;
  } | null>((runtime, settings) => {
    const block = settings.layout.blocks.find(
      (candidate): candidate is ClockBlock => candidate.id === instanceId && isClockBlock(candidate),
    ) ?? null;
    if (!block) return { state: null, result: null };
    const clock = ownValue(runtime.clocks, instanceId) ?? defaultClockForBlock(block);
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
    return { state: runtime, result: { next, interruptedMs, startedWork } };
  }, [FOCUS_STATS_KEY], async (outcome) => {
    if (!outcome || (!outcome.startedWork && outcome.interruptedMs <= 0)) return;
    await applyFocusClockStatsPatchInExistingTransaction({
      startedSessions: outcome.startedWork ? 1 : 0,
      interruptedFocusTimesMs: outcome.interruptedMs > 0 ? [outcome.interruptedMs] : [],
      occurredAt: now,
    });
  });
}

async function resetAllClocks(): Promise<void> {
  await resetAllClockRuntimeWithAlarms();
}

async function finishClockCompletion(instanceId: string, token: string): Promise<void> {
  const result = await completeClockInstance(instanceId, token);
  // completeClockInstance performs the same durable scheduleClockAlarm reconciliation atomically.
  if (!result.completed || !result.block || !result.clock) return;
  const block = result.block;
  const effects: Array<() => Promise<void>> = [];
  if (result.notify) {
    const messageKey = block.type === "pomodoro" ? "pomodoroDone" : "timerDone";
    effects.push(async () => {
      await chrome.notifications.create(`start-tab-clock-${instanceId}-${token}`, {
        type: "basic",
        iconUrl: "icons/icon.128.png",
        title: block.title,
        message: await workerMessage(messageKey),
      });
    });
  }
  await runIndependentEffects(effects, "Clock completed but one or more secondary effects failed");
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
    return SPLIT_VIEW_MARKERS.some((marker) => haystack.includes(marker));
  } catch {
    return false;
  }
}

async function rememberIfBlocked(url: string): Promise<void> {
  const host = await rememberBlockedNavigation(url);
  if (!host) return;
  await runStatsJob(() => recordBlockedNavigation(host));
}

async function migrateAndSyncRules(): Promise<void> {
  await migrateLegacyStorage();
  const settings = await getStartPageSettings();
  await getStartPageRuntimeState(settings);
  await reconcileClockAlarms();
  await syncRules();
}
