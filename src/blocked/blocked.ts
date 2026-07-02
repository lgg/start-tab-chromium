import { getLastBlockedUrl, normalizeHost } from "../lib/blocklist.js";
import { sendMessage } from "../lib/messages.js";

const WAIT_SECONDS = 10;
const messageEl = document.getElementById("message") as HTMLHeadingElement;
const siteEl = document.getElementById("site") as HTMLParagraphElement;
const actionsEl = document.getElementById("actions") as HTMLDivElement;
const countdownEl = document.getElementById("countdown") as HTMLDivElement;
const countdownTextEl = document.getElementById("countdownText") as HTMLParagraphElement;
const unblockEl = document.getElementById("unblock") as HTMLButtonElement;
const cancelEl = document.getElementById("cancel") as HTMLButtonElement;

const host = normalizeHost(new URLSearchParams(location.search).get("site") ?? "");
let interval: number | undefined;

function msg(key: string): string {
  return chrome.i18n.getMessage(key) || key;
}

function fill(text: string, values: Record<string, string | number>): string {
  let result = text;
  for (const [key, value] of Object.entries(values)) {
    result = result.split("{" + key + "}").join(String(value));
  }
  return result;
}

function unit(value: number): string {
  const lang = chrome.i18n.getUILanguage().toLowerCase().split("-")[0];
  if (lang !== "ru") return msg(value === 1 ? "secondOne" : "secondMany");
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return msg("secondOne");
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return msg("secondFew");
  return msg("secondMany");
}

function renderMessage(): void {
  const phrases = msg("motivationPhrases").split("|").filter(Boolean);
  messageEl.textContent = phrases[Math.floor(Math.random() * phrases.length)] ?? msg("blockedUnknownSiteMessage");
  siteEl.textContent = host ? fill(msg("blockedSiteMessage"), { host }) : msg("blockedUnknownSiteMessage");
}

function startCountdown(): void {
  if (!host) return;
  actionsEl.hidden = true;
  countdownEl.hidden = false;
  let remaining = WAIT_SECONDS;
  const tick = (): void => {
    countdownTextEl.textContent = fill(msg("unblockingCountdown"), {
      host,
      remaining,
      unit: unit(remaining),
    });
    if (remaining <= 0) {
      window.clearInterval(interval);
      void finishUnblock();
      return;
    }
    remaining -= 1;
  };
  tick();
  interval = window.setInterval(tick, 1000);
}

function cancelCountdown(): void {
  window.clearInterval(interval);
  countdownEl.hidden = true;
  actionsEl.hidden = false;
}

async function finishUnblock(): Promise<void> {
  countdownTextEl.textContent = fill(msg("unblockingNow"), { host });
  const redirectUrl = (await getLastBlockedUrl(host)) ?? `https://${host}/`;
  const ack = await sendMessage({ type: "unblock", host });
  if (!ack.ok) {
    countdownTextEl.textContent = msg("failedToUnblock");
    actionsEl.hidden = false;
    countdownEl.hidden = true;
    return;
  }
  location.replace(redirectUrl);
}

document.title = msg("blockedPageTitle");
unblockEl.textContent = msg("unblockThisSite");
cancelEl.textContent = msg("cancelUnblocking");
unblockEl.addEventListener("click", startCountdown);
cancelEl.addEventListener("click", cancelCountdown);
renderMessage();
