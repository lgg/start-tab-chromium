/**
 * Popup UI. Shows the active tab's host and lets the user block it or remove it
 * from the blocklist. Mutations are routed through the service worker.
 */

import { blockedSiteForUrl, hostFromUrl } from "../lib/blocklist.js";
import {
  getLocalePreference,
  loadI18n,
  setLocalePreference,
  type I18n,
  type LocalePreference,
} from "../lib/i18n.js";
import { sendMessage, type Message } from "../lib/messages.js";
import { samePopupTarget, type PopupTarget } from "./popup-target.js";

const titleEl = document.getElementById("title") as HTMLHeadingElement;
const siteEl = document.getElementById("site") as HTMLParagraphElement;
const primaryEl = document.getElementById("primary") as HTMLButtonElement;
const noteEl = document.getElementById("note") as HTMLParagraphElement;
const clearEl = document.getElementById("clear") as HTMLButtonElement;
const languageLabelEl = document.getElementById("languageLabel") as HTMLSpanElement;
const languageEl = document.getElementById("language") as HTMLSelectElement;
const languageAutoEl = document.getElementById("languageAuto") as HTMLOptionElement;
const languageEnglishEl = document.getElementById("languageEnglish") as HTMLOptionElement;
const languageRussianEl = document.getElementById("languageRussian") as HTMLOptionElement;

let i18n: I18n;
let localePreference: LocalePreference = "auto";
let actionPending = true;
let renderGeneration = 0;

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getActiveTarget(): Promise<PopupTarget | null> {
  const tab = await getActiveTab();
  const url = tab?.url;
  const host = url ? hostFromUrl(url) : null;
  if (typeof tab?.id !== "number" || !url || !host) return null;
  return { tabId: tab.id, url, host, blockedHost: await blockedSiteForUrl(url) };
}

function show(el: HTMLElement, text?: string): void {
  if (text !== undefined) el.textContent = text;
  el.hidden = false;
}

function hide(el: HTMLElement): void {
  el.hidden = true;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" && error ? error : i18n?.t("somethingWentWrong") ?? "Something went wrong";
}

function showError(error?: unknown): void {
  show(noteEl, errorText(error));
}

function setActionPending(pending: boolean): void {
  actionPending = pending;
  primaryEl.disabled = pending;
  clearEl.disabled = pending;
  languageEl.disabled = pending;
  document.body.setAttribute("aria-busy", String(pending));
}

async function reloadTabIfPossible(tabId: number): Promise<void> {
  try {
    await chrome.tabs.reload(tabId);
  } catch {
    // Some browser/internal pages cannot be reloaded by an extension after the mutation succeeds.
  }
}

async function sendAction(message: Message): Promise<boolean> {
  try {
    const ack = await sendMessage(message);
    if (ack.ok) return true;
    showError(ack.error);
  } catch {
    // The service worker can restart while the popup is open.
    showError();
  }
  return false;
}

function applyStaticText(): void {
  document.title = i18n.t("popupTitle");
  titleEl.textContent = i18n.t("popupTitle");
  clearEl.textContent = i18n.t("clearBlocklist");
  languageLabelEl.textContent = i18n.t("languageLabel");
  languageAutoEl.textContent = i18n.t("languageAuto");
  languageEnglishEl.textContent = i18n.t("languageEnglish");
  languageRussianEl.textContent = i18n.t("languageRussian");
}

async function render(): Promise<void> {
  const generation = ++renderGeneration;
  hide(noteEl);
  hide(primaryEl);
  hide(siteEl);

  const target = await getActiveTarget();
  if (generation !== renderGeneration) return;
  if (!target) {
    show(noteEl, i18n.t("unsupportedPage"));
    return;
  }

  siteEl.textContent = "";
  siteEl.append(`${i18n.t("currentSiteLabel")} `);
  const strong = document.createElement("strong");
  strong.textContent = target.host;
  siteEl.append(strong);
  siteEl.hidden = false;

  show(primaryEl, i18n.t(target.blockedHost ? "removeFromBlocklist" : "blockThisSite"));
  primaryEl.disabled = actionPending;
  primaryEl.onclick = () => void mutateDisplayedTarget(target).catch(showError);
}

async function mutateDisplayedTarget(expected: PopupTarget): Promise<void> {
  if (actionPending) return;
  setActionPending(true);
  try {
    const current = await getActiveTarget();
    if (!samePopupTarget(expected, current)) {
      await render();
      show(noteEl, i18n.t("currentSiteChanged"));
      return;
    }
    const message: Message = current.blockedHost
      ? { type: "unblock", host: current.blockedHost }
      : { type: "block", host: current.host };
    if (!(await sendAction(message))) return;
    await reloadTabIfPossible(current.tabId);
    window.close();
  } finally {
    setActionPending(false);
  }
}

async function clearBlocklist(): Promise<void> {
  if (actionPending) return;
  setActionPending(true);
  try {
    if (await sendAction({ type: "clear" })) await render();
  } catch (error) {
    showError(error);
  } finally {
    setActionPending(false);
  }
}

async function changeLanguage(): Promise<void> {
  if (actionPending) return;
  const requested = languageEl.value as LocalePreference;
  setActionPending(true);
  try {
    await setLocalePreference(requested);
    localePreference = requested;
    i18n = await loadI18n();
    applyStaticText();
    await render();
  } catch (error) {
    languageEl.value = localePreference;
    showError(error);
  } finally {
    setActionPending(false);
  }
}

clearEl.addEventListener("click", () => {
  if (actionPending || !window.confirm(i18n.t("clearBlocklistConfirm"))) return;
  void clearBlocklist();
});

languageEl.addEventListener("change", () => {
  void changeLanguage();
});

async function init(): Promise<void> {
  setActionPending(true);
  i18n = await loadI18n();
  localePreference = await getLocalePreference();
  languageEl.value = localePreference;
  applyStaticText();
  await render();
  setActionPending(false);
}

void init().catch((error: unknown) => {
  setActionPending(false);
  showError(error);
});
