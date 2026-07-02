/**
 * Popup UI. Shows the active tab's host and lets the user block it or remove it
 * from the blocklist. Mutations are routed through the service worker.
 */

import { getBlockedSites, hostFromUrl } from "../lib/blocklist.js";
import { sendMessage } from "../lib/messages.js";

const titleEl = document.getElementById("title") as HTMLHeadingElement;
const siteEl = document.getElementById("site") as HTMLParagraphElement;
const primaryEl = document.getElementById("primary") as HTMLButtonElement;
const noteEl = document.getElementById("note") as HTMLParagraphElement;
const clearEl = document.getElementById("clear") as HTMLButtonElement;

function t(key: string, substitutions?: string | string[]): string {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

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

async function render(): Promise<void> {
  hide(noteEl);
  hide(primaryEl);

  const tab = await getActiveTab();
  const host = tab?.url ? hostFromUrl(tab.url) : null;

  if (!tab || !host) {
    show(noteEl, t("unsupportedPage"));
    return;
  }

  siteEl.textContent = "";
  siteEl.append(`${t("currentSiteLabel")} `);
  const strong = document.createElement("strong");
  strong.textContent = host;
  siteEl.append(strong);
  siteEl.hidden = false;

  const blocked = (await getBlockedSites()).includes(host);

  if (blocked) {
    show(primaryEl, t("removeFromBlocklist"));
    primaryEl.onclick = () => void unblock(host, tab.id);
  } else {
    show(primaryEl, t("blockThisSite"));
    primaryEl.onclick = () => void block(host, tab.id);
  }
}

async function block(host: string, tabId: number | undefined): Promise<void> {
  primaryEl.disabled = true;
  const ack = await sendMessage({ type: "block", host });
  if (!ack.ok) {
    show(noteEl, t("somethingWentWrong"));
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
    show(noteEl, t("somethingWentWrong"));
    primaryEl.disabled = false;
    return;
  }
  if (tabId !== undefined) await chrome.tabs.reload(tabId);
  window.close();
}

clearEl.addEventListener("click", async () => {
  const ack = await sendMessage({ type: "clear" });
  if (ack.ok) await render();
});

document.title = t("popupTitle");
titleEl.textContent = t("popupTitle");
clearEl.textContent = t("clearBlocklist");
void render();
