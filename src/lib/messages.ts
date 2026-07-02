/** Messages exchanged between the popup / blocked page and the service worker. */

export type Message =
  | { type: "block"; host: string }
  | { type: "unblock"; host: string }
  | { type: "clear" };

export interface Ack {
  ok: boolean;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isMessage(value: unknown): value is Message {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "block":
    case "unblock":
      return typeof value.host === "string";
    case "clear":
      return true;
    default:
      return false;
  }
}

export function sendMessage(message: Message): Promise<Ack> {
  return chrome.runtime.sendMessage(message);
}
