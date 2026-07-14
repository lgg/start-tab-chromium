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

export interface Ack { ok: boolean; error?: string }

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
      return isSafeIdentifier(value.instanceId) && Array.isArray(value.tasks)
        && value.tasks.length <= 10_000 && value.tasks.every(isLocalTask);
    case "runtime-link-page":
      return isSafeIdentifier(value.instanceId) && typeof value.page === "number"
        && Number.isInteger(value.page) && value.page >= 0 && value.page <= 10_000;
    case "delete-instance-runtime":
      return isSafeIdentifier(value.instanceId);
    default:
      return false;
  }
}

export async function sendMessage(message: Message): Promise<Ack> {
  const response = await chrome.runtime.sendMessage(message) as Ack | undefined;
  if (!response || response.ok !== true) {
    throw new Error(response?.error || "The service worker did not acknowledge the request");
  }
  return response;
}
