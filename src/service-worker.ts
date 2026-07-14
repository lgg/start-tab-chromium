/**
 * Manifest V3 service worker.
 *
 * It owns declarativeNetRequest synchronization, fallback new-tab redirects,
 * focus statistics, schema migration, and every mutation of durable clocks.
 */

import {
  blockedSiteForUrl,
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
  recordFocusSessionCompleted,
  recordFocusSessionInterrupted,
  recordFocusSessionStarted,
  recordUnblockAfterCountdown,
  resetFocusStats,
} from "./lib/focus-stats.js";
import { isMessage, type Ack, type ClockAction, type Message } from "./lib/messages.js";
import {
  completeClockInstance,
  defaultClockForBlock,
  deleteInstanceRuntime,
  getStartPageRuntimeState,
  parseClockAlarmName,
  pauseClockState,
  resetClockState,
  resetStartPageRuntimeState,
  scheduleClockAlarm,
  setStartPageRuntimeState,
  startClockState,
} from "./lib/start-page-runtime.js";
import {
  getStartPageSettings,
  resetStartPageSettings,
  type BlockInstance,
  type ClockRuntimeState,
  type LocalTask,
  type StartPageRuntimeState,
  type StartPageSettings,
} from "./lib/start-page-settings.js";

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
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  },
);

function runNativeTabJob(operation: () => Promise<void>): Promise<void> {
  const next = nativeTabJob.catch(ignoreBackgroundError).then(operation);
  nativeTabJob = next;
  return next;
}

async function waitForNativeBypassConsumption(tabId: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const items = await chrome.storage.local.get(NATIVE_NEW_TAB_BYPASS_KEY);
    const value = items[NATIVE_NEW_TAB_BYPASS_KEY] as NativeNewTabBypass | undefined;
    if (value?.tabId !== tabId) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function openNativeNewTab(): Promise<void> {
  const tab = await chrome.tabs.create({ active: true, url: "about:blank" });
  if (typeof tab.id !== "number") throw new Error("The browser did not return a tab id");
  await chrome.storage.local.set({
    [NATIVE_NEW_TAB_BYPASS_KEY]: { tabId: tab.id, expiresAt: Date.now() + 5000 },
  });
  for (const url of ["chrome://new-tab-page/", "chrome-search://local-ntp/local-ntp.html", "about:newtab"]) {
    try {
      await chrome.tabs.update(tab.id, { url });
      await waitForNativeBypassConsumption(tab.id);
      return;
    } catch {
      // Try the next browser-specific URL.
    }
  }
  await chrome.storage.local.remove(NATIVE_NEW_TAB_BYPASS_KEY);
  throw new Error("The browser rejected every native new-tab URL");
}

async function resetStartPage(): Promise<void> {
  await resetStartPageSettings();
  await resetStartPageRuntimeState();
}

async function handle(message: Message): Promise<void> {
  switch (message.type) {
    case "block": await blockHost(message.host); break;
    case "unblock": await unblockHost(message.host); break;
    case "clear": await clearAll(); break;
    case "replace-blocked-sites": await replaceBlockedSites(message.sites); break;
    case "open-native-new-tab": await runNativeTabJob(openNativeNewTab); break;
    case "reset-start-page": await runRuntimeJob(resetStartPage); break;
    case "clock-action": await runRuntimeJob(() => performClockAction(message.instanceId, message.action)); break;
    case "complete-clock": await runRuntimeJob(() => finishClockCompletion(message.instanceId, message.token)); break;
    case "reset-clocks": await resetAllClocks(); break;
    case "runtime-note": await runRuntimeJob(() => updateRuntimeNote(message.instanceId, message.value)); break;
    case "runtime-tasks": await runRuntimeJob(() => updateRuntimeTasks(message.instanceId, message.tasks)); break;
    case "runtime-link-page": await runRuntimeJob(() => updateRuntimeLinkPage(message.instanceId, message.page)); break;
    case "delete-instance-runtime": await runRuntimeJob(() => deleteInstanceRuntime(message.instanceId)); break;
    case "record-unblock": await runStatsJob(() => recordUnblockAfterCountdown(message.host)); break;
    case "reset-stats": await runStatsJob(resetFocusStats); break;
  }
}

async function clockContext(instanceId: string): Promise<{
  settings: StartPageSettings;
  runtime: StartPageRuntimeState;
  block: ClockBlock | null;
  clock: ClockRuntimeState | null;
}> {
  const settings = await getStartPageSettings();
  const block = settings.layout.blocks.find(
    (candidate): candidate is ClockBlock => candidate.id === instanceId && isClockBlock(candidate),
  ) ?? null;
  const runtime = await getStartPageRuntimeState(settings);
  const clock = block ? runtime.clocks[instanceId] ?? defaultClockForBlock(block) : null;
  return { settings, runtime, block, clock };
}

async function updateRuntimeNote(instanceId: string, value: string): Promise<void> {
  const settings = await getStartPageSettings();
  if (!settings.layout.blocks.some((block) => block.id === instanceId && block.type === "note")) return;
  const runtime = await getStartPageRuntimeState(settings);
  runtime.notes[instanceId] = value.slice(0, 200_000);
  await setStartPageRuntimeState(runtime);
}

async function updateRuntimeTasks(instanceId: string, tasks: LocalTask[]): Promise<void> {
  const settings = await getStartPageSettings();
  if (!settings.layout.blocks.some((block) => block.id === instanceId && block.type === "localTasks")) return;
  const runtime = await getStartPageRuntimeState(settings);
  runtime.tasks[instanceId] = structuredClone(tasks);
  await setStartPageRuntimeState(runtime);
}

async function updateRuntimeLinkPage(instanceId: string, page: number): Promise<void> {
  const settings = await getStartPageSettings();
  if (!settings.layout.blocks.some((block) => block.id === instanceId && (block.type === "links" || block.type === "startPinned"))) return;
  const runtime = await getStartPageRuntimeState(settings);
  runtime.linkPages[instanceId] = Math.min(10_000, Math.max(0, Math.round(page)));
  await setStartPageRuntimeState(runtime);
}

async function performClockAction(instanceId: string, action: ClockAction): Promise<void> {
  const { runtime, block, clock } = await clockContext(instanceId);
  if (!block || !clock) return;

  const now = Date.now();
  let next: ClockRuntimeState;
  let interruptedMs = 0;
  let startedWork = false;

  if (action === "reset") {
    if (block.type === "pomodoro" && clock.running && clock.phase === "work" && clock.focusSessionStartedAt !== null) {
      interruptedMs = Math.max(0, now - clock.focusSessionStartedAt);
    }
    next = resetClockState(block);
  } else if (clock.running) {
    if (block.type === "pomodoro" && clock.phase === "work" && clock.focusSessionStartedAt !== null) {
      interruptedMs = Math.max(0, now - clock.focusSessionStartedAt);
    }
    next = pauseClockState(clock, now);
    if (next.type === "pomodoro") next.focusSessionStartedAt = null;
  } else {
    startedWork = block.type === "pomodoro" && (clock.phase ?? "work") === "work";
    next = startClockState(clock, now);
  }

  runtime.clocks[instanceId] = next;
  await setStartPageRuntimeState(runtime);
  await scheduleClockAlarm(instanceId, next);
  if (startedWork) await runStatsJob(recordFocusSessionStarted);
  if (interruptedMs > 0) await runStatsJob(() => recordFocusSessionInterrupted(interruptedMs));
}

async function resetAllClocks(): Promise<void> {
  const settings = await getStartPageSettings();
  const clockIds = settings.layout.blocks.filter(isClockBlock).map((block) => block.id);
  for (const instanceId of clockIds) {
    await runRuntimeJob(() => performClockAction(instanceId, "reset"));
  }
}

async function finishClockCompletion(instanceId: string, token: string): Promise<void> {
  const result = await completeClockInstance(instanceId, token);
  if (!result.completed || !result.block) return;
  const completionId = `${instanceId}:${token}`;
  if (result.focusTimeMs > 0) await runStatsJob(() => recordFocusSessionCompleted(result.focusTimeMs, completionId));
  if (!result.notify) return;
  const messageKey = result.block.type === "pomodoro" ? "pomodoroDone" : "timerDone";
  await chrome.notifications.create(`start-tab-clock-${instanceId}-${token}`, {
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
      await runRuntimeJob(() => finishClockCompletion(instanceId, clock.completionToken!));
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
  await runStatsJob(() => recordBlockedNavigation(host));
}

async function migrateAndSyncRules(): Promise<void> {
  await migrateLegacyStorage();
  await getStartPageSettings();
  await reconcileClockAlarms();
  await syncRules();
}
