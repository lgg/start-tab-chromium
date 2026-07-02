/**
 * Popup UI. Shows the active tab's host and lets the user block it or remove it
 * from the blocklist. Mutations are routed through the service worker.
 */

import { getBlockedSites, hostFromUrl } from "../lib/blocklist.js";
import {
  getLocalePreference,
  loadI18n,
  setLocalePreference,
  type I18n,
  type LocalePreference,
} from "../lib/i18n.js";
import { sendMessage } from "../lib/messages.js";

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

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function show(el: HTMLElement, text?: string): void {
  if (text !== undefined) el.textContent = text;
  el.hidden = false;
}

function hide(el: HTMLElement): void {
  el.hidden = true;
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
  hide(noteEl);
  hide(primaryEl);
  hide(siteEl);
  primaryEl.disabled = false;

  const tab = await getActiveTab();
  const host = tab?.url ? hostFromUrl(tab.url) : null;

  if (!tab || !host) {
    show(noteEl, i18n.t("unsupportedPage"));
    return;
  }

  siteEl.textContent = "";
  siteEl.append(`${i18n.t("currentSiteLabel")} `);
  const strong = document.createElement("strong");
  strong.textContent = host;
  siteEl.append(strong);
  siteEl.hidden = false;

  const blocked = (await getBlockedSites()).includes(host);

  if (blocked) {
    show(primaryEl, i18n.t("removeFromBlocklist"));
    primaryEl.onclick = () => void unblock(host, tab.id);
  } else {
    show(primaryEl, i18n.t("blockThisSite"));
    primaryEl.onclick = () => void block(host, tab.id);
  }
}

async function block(host: string, tabId: number | undefined): Promise<void> {
  primaryEl.disabled = true;
  const ack = await sendMessage({ type: "block", host });
  if (!ack.ok) {
    show(noteEl, i18n.t("somethingWentWrong"));
    primaryEl.disabled = false;
    return;
  }
  if (tabId !== undefined) await chrome.tabs.reload(tabId);
  window.close();
}

async function unblock(host: string, tabId: number | undefined): Promise<void> {
  primaryEl.disabled = true;
  const ack = await sendMessage({ type: "unblock", host });
  if (!ack.ok) {
    show(noteEl, i18n.t("somethingWentWrong"));
    primaryEl.disabled = false;
    return;
  }
  if (tabId !== undefined) await chrome.tabs.reload(tabId);
  window.close();
}

clearEl.addEventListener("click", async () => {
  const ack = await sendMessage({ type: "clear" });
  if (ack.ok) {
    await render();
    return;
  }
  show(noteEl, i18n.t("somethingWentWrong"));
});

languageEl.addEventListener("change", async () => {
  await setLocalePreference(languageEl.value as LocalePreference);
  i18n = await loadI18n();
  applyStaticText();
  await render();
});

async function init(): Promise<void> {
  i18n = await loadI18n();
  languageEl.value = await getLocalePreference();
  applyStaticText();
  await render();
}

void init();
