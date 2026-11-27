import { blockedSiteForUrl, hostFromUrl, normalizeHost } from "../lib/blocklist.js";
import { loadI18n, type I18n } from "../lib/i18n.js";
import { sendMessage } from "../lib/messages.js";
import { remainingCountdownSeconds, countdownSecondUnitKey } from "./countdown.js";

const WAIT_SECONDS = 10;
const messageEl = document.getElementById("message") as HTMLHeadingElement;
const siteEl = document.getElementById("site") as HTMLParagraphElement;
const actionsEl = document.getElementById("actions") as HTMLDivElement;
const countdownEl = document.getElementById("countdown") as HTMLDivElement;
const countdownTextEl = document.getElementById("countdownText") as HTMLParagraphElement;
const unblockEl = document.getElementById("unblock") as HTMLButtonElement;
const cancelEl = document.getElementById("cancel") as HTMLButtonElement;
const errorEl = document.getElementById("unblockError") as HTMLParagraphElement;

const host = readBlockedHost();
let interval: number | undefined;
let countdownActive = false;
let countdownGeneration = 0;
let pageActive = true;
let i18n: I18n;

function readBlockedHost(): string {
  const sites = new URLSearchParams(location.search).getAll("site");
  if (sites.length !== 1) return "";
  const value = sites[0]!;
  const normalized = normalizeHost(value);
  return normalized && normalized === value && hostFromUrl(`https://${normalized}/`) === normalized ? normalized : "";
}

async function blockedHostIsActive(): Promise<boolean> {
  return Boolean(host) && await blockedSiteForUrl(`https://${host}/`) === host;
}

function renderMessage(): void {
  const phrases = i18n.list("motivationPhrases");
  messageEl.textContent = phrases[Math.floor(Math.random() * phrases.length)] ?? i18n.t("blockedUnknownSiteMessage");
  siteEl.textContent = host
    ? i18n.t("blockedSiteMessage", { host })
    : i18n.t("blockedUnknownSiteMessage");
}

function clearCountdownTimer(): void {
  countdownGeneration += 1;
  window.clearInterval(interval);
  interval = undefined;
}

function startCountdown(): void {
  if (!pageActive || !host || countdownActive) return;
  countdownActive = true;
  errorEl.hidden = true;
  errorEl.textContent = "";
  unblockEl.disabled = true;
  cancelEl.disabled = false;
  actionsEl.hidden = true;
  countdownEl.hidden = false;
  const generation = ++countdownGeneration;
  const deadline = performance.now() + WAIT_SECONDS * 1000;

  const tick = (): void => {
    if (!pageActive || !countdownActive || generation !== countdownGeneration) return;
    const remaining = remainingCountdownSeconds(deadline, performance.now());
    countdownTextEl.textContent = i18n.t("unblockingCountdown", {
      host,
      remaining,
      unit: i18n.t(countdownSecondUnitKey(i18n.locale, remaining)),
    });
    if (remaining <= 0) {
      clearCountdownTimer();
      cancelEl.disabled = true;
      void finishUnblock().catch(showUnblockFailed);
      return;
    }
  };

  tick();
  interval = window.setInterval(tick, 250);
}

function cancelCountdown(): void {
  if (!pageActive || cancelEl.disabled) return;
  clearCountdownTimer();
  countdownActive = false;
  unblockEl.disabled = false;
  cancelEl.disabled = false;
  countdownEl.hidden = true;
  actionsEl.hidden = false;
}

function showUnblockFailed(): void {
  if (!pageActive) return;
  clearCountdownTimer();
  errorEl.textContent = i18n.t("failedToUnblock");
  errorEl.hidden = false;
  countdownActive = false;
  unblockEl.disabled = false;
  cancelEl.disabled = false;
  actionsEl.hidden = false;
  countdownEl.hidden = true;
}

function showStartupFailed(error: unknown): void {
  clearCountdownTimer();
  countdownActive = false;
  unblockEl.disabled = true;
  actionsEl.hidden = true;
  countdownEl.hidden = true;
  errorEl.textContent = error instanceof Error ? error.message : String(error);
  errorEl.hidden = false;
}

type UnblockResult = "removed" | "unchanged" | "failed";

async function requestUnblock(): Promise<UnblockResult> {
  try {
    if (!await blockedHostIsActive() || !pageActive) return "unchanged";
    const ack = await sendMessage({ type: "unblock", host });
    return ack.changed === true ? "removed" : "unchanged";
  } catch {
    // The MV3 service worker can restart while the blocked page is open.
    return "failed";
  }
}

async function redirectUrlAfterUnblock(): Promise<string> {
  try {
    const { blockedUrl } = await sendMessage({ type: "blocked-original-url", host });
    const originalHost = blockedUrl ? hostFromUrl(blockedUrl) : null;
    // Never fall back to the shared historical URL from a different tab.
    if (blockedUrl && originalHost && (originalHost === host || originalHost.endsWith("." + host))) return blockedUrl;
    return `https://${host}/`;
  } catch {
    return `https://${host}/`;
  }
}

async function finishUnblock(): Promise<void> {
  countdownTextEl.textContent = i18n.t("unblockingNow", { host });
  const redirectUrl = await redirectUrlAfterUnblock();
  if (!pageActive) return;
  const result = await requestUnblock();
  if (!pageActive) return;
  if (result === "failed") {
    showUnblockFailed();
    return;
  }
  if (result === "removed") {
    await sendMessage({ type: "record-unblock", host }).catch(() => undefined);
  }
  if (pageActive) location.replace(redirectUrl);
}

async function init(): Promise<void> {
  // DNR redirects only main-frame navigations. The web-accessible page
  // can also be framed by arbitrary sites; never arm actions in that case.
  if (window.top !== window.self) {
    unblockEl.disabled = true;
    cancelEl.disabled = true;
    actionsEl.hidden = true;
    countdownEl.hidden = true;
    return;
  }
  i18n = await loadI18n();
  if (!pageActive) return;
  document.title = i18n.t("blockedPageTitle");
  unblockEl.textContent = i18n.t("unblockThisSite");
  cancelEl.textContent = i18n.t("cancelUnblocking");
  if (host && !await blockedHostIsActive()) {
    const redirectUrl = await redirectUrlAfterUnblock();
    if (pageActive) location.replace(redirectUrl);
    return;
  }
  if (!pageActive) return;
  unblockEl.disabled = !host;
  unblockEl.addEventListener("click", startCountdown);
  cancelEl.addEventListener("click", cancelCountdown);
  // A restored BFCache page must not retain a stopped, non-restartable countdown.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
  renderMessage();
}

window.addEventListener("pagehide", () => {
  pageActive = false;
  countdownActive = false;
  clearCountdownTimer();
});
void init().catch((error: unknown) => { if (pageActive) showStartupFailed(error); });
