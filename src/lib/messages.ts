/** Messages exchanged between extension pages and the service worker. */

import type { LocalTask } from "./start-page-types.js";

export type ClockAction = "toggle" | "reset";

export type Message =
  | { type: "block"; host: string }
  | { type: "unblock"; host: string }
  | { type: "clear" }
  | { type: "replace-blocked-sites"; sites: string[] }
  | { type: "open-native-new-tab" }
  | { type: "reset-start-page" }
  | { type: "clock-action"; instanceId: string; action: ClockAction }
  | { type: "complete-clock"; instanceId: string; token: string }
  | { type: "reset-clocks" }
  | { type: "runtime-note"; instanceId: string; value: string }
  | { type: "runtime-tasks"; instanceId: string; tasks: LocalTask[] }
  | { type: "runtime-link-page"; instanceId: string; page: number }
  | { type: "delete-instance-runtime"; instanceId: string }
  | { type: "record-unblock"; host: string }
  | { type: "reset-stats" };

export interface Ack {
  ok: boolean;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function isLocalTask(value: unknown): value is LocalTask {
  return isRecord(value)
    && isSafeIdentifier(value.id)
    && typeof value.title === "string"
    && value.title.length <= 500
    && typeof value.done === "boolean"
    && typeof value.createdAt === "number"
    && Number.isFinite(value.createdAt)
    && typeof value.updatedAt === "number"
    && Number.isFinite(value.updatedAt);
}

export function isMessage(value: unknown): value is Message {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "block":
    case "unblock":
    case "record-unblock":
      return typeof value.host === "string" && value.host.length <= 2048;
    case "clear":
    case "open-native-new-tab":
    case "reset-start-page":
    case "reset-clocks":
    case "reset-stats":
      return true;
    case "replace-blocked-sites":
      return Array.isArray(value.sites)
        && value.sites.length <= 10_000
        && value.sites.every((site) => typeof site === "string" && site.length <= 2048);
    case "clock-action":
      return isSafeIdentifier(value.instanceId) && (value.action === "toggle" || value.action === "reset");
    case "complete-clock":
      return isSafeIdentifier(value.instanceId) && isSafeIdentifier(value.token);
    case "runtime-note":
      return isSafeIdentifier(value.instanceId) && typeof value.value === "string" && value.value.length <= 200_000;
    case "runtime-tasks":
      return isSafeIdentifier(value.instanceId)
        && Array.isArray(value.tasks)
        && value.tasks.length <= 10_000
        && value.tasks.every(isLocalTask);
    case "runtime-link-page":
      return isSafeIdentifier(value.instanceId)
        && typeof value.page === "number"
        && Number.isInteger(value.page)
        && value.page >= 0
        && value.page <= 10_000;
    case "delete-instance-runtime":
      return isSafeIdentifier(value.instanceId);
    default:
      return false;
  }
}

const SPECIAL_COMMAND_PREFIX = "startTabWorkerCommand:";
const SPECIAL_RESPONSE_PREFIX = "startTabWorkerResponse:";
const SPECIAL_WORKER_MESSAGE_TYPES = new Set<Message["type"]>([
  "replace-blocked-sites",
  "open-native-new-tab",
  "reset-start-page",
]);
let specialWorkerJob: Promise<void> = Promise.resolve();

function specialCommandId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function sendSpecialWorkerCommand(message: Message): Promise<Ack> {
  const id = specialCommandId();
  const commandKey = `${SPECIAL_COMMAND_PREFIX}${id}`;
  const responseKey = `${SPECIAL_RESPONSE_PREFIX}${id}`;
  return new Promise<Ack>((resolve, reject) => {
    let settled = false;
    const finish = (result: Ack | Error): void => {
      if (settled) return;
      settled = true;
      chrome.storage.onChanged.removeListener(listener);
      window.clearTimeout(timeout);
      void chrome.storage.local.remove([commandKey, responseKey]);
      if (result instanceof Error) reject(result);
      else if (result.ok) resolve(result);
      else reject(new Error(result.error || "The service worker did not acknowledge the request"));
    };
    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string): void => {
      if (areaName !== "local" || !(responseKey in changes)) return;
      const value = changes[responseKey]?.newValue;
      if (!isRecord(value) || typeof value.ok !== "boolean") {
        finish(new Error("The service worker returned an invalid response"));
        return;
      }
      finish({ ok: value.ok, error: typeof value.error === "string" ? value.error : undefined });
    };
    const timeout = window.setTimeout(() => finish(new Error("The service worker command timed out")), 10_000);
    chrome.storage.onChanged.addListener(listener);
    void chrome.storage.local.set({ [commandKey]: { id, message } }).catch((error: unknown) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

export async function sendMessage(message: Message): Promise<Ack> {
  if (typeof document !== "undefined" && SPECIAL_WORKER_MESSAGE_TYPES.has(message.type)) {
    return sendSpecialWorkerCommand(message);
  }
  const response = await chrome.runtime.sendMessage(message) as Ack | undefined;
  if (!response || response.ok !== true) {
    throw new Error(response?.error || "The service worker did not acknowledge the request");
  }
  return response;
}

async function waitForNativeBypassConsumption(key: string, tabId: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const items = await chrome.storage.local.get(key);
    const value = items[key];
    if (!isRecord(value) || value.tabId !== tabId) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function nativeNewTabUrl(tabId: number): Promise<void> {
  const key = "startTabNativeNewTabBypass";
  await chrome.storage.local.set({ [key]: { tabId, expiresAt: Date.now() + 5000 } });
  for (const url of ["chrome://new-tab-page/", "chrome-search://local-ntp/local-ntp.html", "about:newtab"]) {
    try {
      await chrome.tabs.update(tabId, { url });
      await waitForNativeBypassConsumption(key, tabId);
      return;
    } catch {
      // Try the next browser-specific URL.
    }
  }
  await chrome.storage.local.remove(key);
  throw new Error("The browser rejected every native new-tab URL");
}

async function handleSpecialWorkerMessage(message: Message): Promise<void> {
  switch (message.type) {
    case "replace-blocked-sites": {
      const { replaceBlockedSites } = await import("./blocklist.js");
      await replaceBlockedSites(message.sites);
      break;
    }
    case "open-native-new-tab": {
      const tab = await chrome.tabs.create({ active: true, url: "about:blank" });
      if (typeof tab.id !== "number") throw new Error("The browser did not return a tab id");
      await nativeNewTabUrl(tab.id);
      break;
    }
    case "reset-start-page": {
      const [{ resetStartPageSettings }, { resetStartPageRuntimeState }] = await Promise.all([
        import("./start-page-settings.js"),
        import("./start-page-runtime.js"),
      ]);
      await resetStartPageSettings();
      await resetStartPageRuntimeState();
      break;
    }
    default:
      break;
  }
}

if (typeof document === "undefined" && typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith(SPECIAL_COMMAND_PREFIX)) continue;
      const value = change.newValue;
      if (!isRecord(value) || typeof value.id !== "string" || !isMessage(value.message)
        || !SPECIAL_WORKER_MESSAGE_TYPES.has(value.message.type)) {
        void chrome.storage.local.remove(key);
        continue;
      }
      const responseKey = `${SPECIAL_RESPONSE_PREFIX}${value.id}`;
      const operation = () => handleSpecialWorkerMessage(value.message as Message);
      const next = specialWorkerJob.catch(() => undefined).then(operation);
      specialWorkerJob = next;
      void next.then(
        () => chrome.storage.local.set({ [responseKey]: { ok: true } }),
        (error: unknown) => chrome.storage.local.set({ [responseKey]: { ok: false, error: error instanceof Error ? error.message : String(error) } }),
      ).finally(() => chrome.storage.local.remove(key));
    }
  });
}
