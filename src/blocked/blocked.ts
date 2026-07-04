import { getLastBlockedUrl, normalizeHost } from "../lib/blocklist.js";
import { recordUnblockAfterCountdown } from "../lib/focus-stats.js";
import { loadI18n, type I18n } from "../lib/i18n.js";
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
let countdownActive = false;
let i18n: I18n;

function unit(value: number): string {
  if (i18n.locale !== "ru") return i18n.t(value === 1 ? "secondOne" : "secondMany");

  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return i18n.t("secondOne");
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return i18n.t("secondFew");
  return i18n.t("secondMany");
}

function renderMessage(): void {
  const phrases = i18n.list("motivationPhrases");
  messageEl.textContent = phrases[Math.floor(Math.random() * phrases.length)] ?? i18n.t("blockedUnknownSiteMessage");
  siteEl.textContent = host
    ? i18n.t("blockedSiteMessage", { host })
    : i18n.t("blockedUnknownSiteMessage");
}

function clearCountdownTimer(): void {
  window.clearInterval(interval);
  interval = undefined;
}

function startCountdown(): void {
  if (!host || countdownActive) return;
  countdownActive = true;
  unblockEl.disabled = true;
  actionsEl.hidden = true;
  countdownEl.hidden = false;
  let remaining = WAIT_SECONDS;

  const tick = (): void => {
    countdownTextEl.textContent = i18n.t("unblockingCountdown", {
      host,
      remaining,
      unit: unit(remaining),
    });
    if (remaining <= 0) {
      clearCountdownTimer();
      void finishUnblock();
      return;
    }
    remaining -= 1;
  };

  tick();
  interval = window.setInterval(tick, 1000);
}

function cancelCountdown(): void {
  clearCountdownTimer();
  countdownActive = false;
  unblockEl.disabled = false;
  countdownEl.hidden = true;
  actionsEl.hidden = false;
}

function showUnblockFailed(): void {
  countdownTextEl.textContent = i18n.t("failedToUnblock");
  countdownActive = false;
  unblockEl.disabled = false;
  actionsEl.hidden = false;
  countdownEl.hidden = true;
}

async function requestUnblock(): Promise<boolean> {
  try {
    const ack = await sendMessage({ type: "unblock", host });
    return ack.ok;
  } catch {
    // The MV3 service worker can restart while the blocked page is open.
    return false;
  }
}

async function finishUnblock(): Promise<void> {
  countdownTextEl.textContent = i18n.t("unblockingNow", { host });
  const redirectUrl = (await getLastBlockedUrl(host)) ?? `https://${host}/`;
  if (!(await requestUnblock())) {
    showUnblockFailed();
    return;
  }
  await recordUnblockAfterCountdown(host);
  location.replace(redirectUrl);
}

async function init(): Promise<void> {
  i18n = await loadI18n();
  document.title = i18n.t("blockedPageTitle");
  unblockEl.textContent = i18n.t("unblockThisSite");
  cancelEl.textContent = i18n.t("cancelUnblocking");
  unblockEl.addEventListener("click", startCountdown);
  cancelEl.addEventListener("click", cancelCountdown);
  window.addEventListener("pagehide", clearCountdownTimer);
  renderMessage();
}

void init();
