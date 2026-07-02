import { getLastBlockedUrl, normalizeHost } from "../lib/blocklist.js";
import { sendMessage } from "../lib/messages.js";

const UNBLOCK_SECONDS = 10;

const messageEl = document.getElementById("message") as HTMLHeadingElement;
const siteEl = document.getElementById("site") as HTMLParagraphElement;
const actionsEl = document.getElementById("actions") as HTMLDivElement;
const countdownEl = document.getElementById("countdown") as HTMLDivElement;
const countdownTextEl = document.getElementById("countdownText") as HTMLParagraphElement;
const unblockEl = document.getElementById("unblock") as HTMLButtonElement;
const cancelEl = document.getElementById("cancel") as HTMLButtonElement;

const params = new URLSearchParams(location.search);
const host = normalizeHost(params.get("site") ?? "");
let interval: number | undefined;

function t(key: string, substitutions?: string | string[]): string {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

function motivationPhrases(): string[] {
  return t("motivationPhrases").split("|").filter(Boolean);
}

function renderMessage(): void {
  const phrases = motivationPhrases();
  messageEl.textContent = phrases[Math.floor(Math.random() * phrases.length)] ?? t("blockedUnknownSiteMessage");
  siteEl.textContent = host ? t("blockedSiteMessage", host) : t("blockedUnknownSiteMessage");
}

function secondUnit(remaining: number): string {
  const language = chrome.i18n.getUILanguage().toLowerCase().split("-")[0];
  if (language !== "ru") return t(remaining === 1 ? "secondOne" : "secondMany");

  const mod10 = remaining % 10;
  const mod100 = remaining % 100;
  if (mod10 === 1 && mod100 !== 11) return t("secondOne");
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return t("secondFew");
  return t("secondMany");
}

function startCountdown(): void {
  if (!host) return;
  actionsEl.hidden = true;
  countdownEl.hidden = false;

  let remaining = UNBLOCK_SECONDS;
  const tick = (): void => {
    countdownTextEl.textContent = t("unblockingCountdown", [host, String(remaining), secondUnit(remaining)]);
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
  countdownTextEl.textContent = t("unblockingNow", host);
  const redirectUrl = (await getLastBlockedUrl(host)) ?? `https://${host}/`;
  const ack = await sendMessage({ type: "unblock", host });
  if (!ack.ok) {
    countdownTextEl.textContent = t("failedToUnblock");
    actionsEl.hidden = false;
    countdownEl.hidden = true;
    return;
  }
  location.replace(redirectUrl);
}

document.title = t("blockedPageTitle");
unblockEl.textContent = t("unblockThisSite");
cancelEl.textContent = t("cancelUnblocking");
unblockEl.addEventListener("click", startCountdown);
cancelEl.addEventListener("click", cancelCountdown);
renderMessage();
