/**
 * Popup UI. Shows the active tab's host and lets the user block it or remove it
 * from the blocklist. Mutations are routed through the service worker.
 */

import { blockedSiteForUrl, getBlockedSites } from "../lib/blocklist.js";
import {
  loadI18n,
  setLocalePreference,
  type I18n,
  type LocalePreference,
} from "../lib/i18n.js";
import { sendMessage, type Message } from "../lib/messages.js";
import { settlePopupAction } from "./action-recovery.js";
import { mayReloadPopupTarget, readStablePopupTarget, samePopupTarget, type PopupTarget } from "./popup-target.js";

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
let initialized = false;
let localeNeedsRefresh = false;
let blocklistNeedsRefresh = false;
let renderGeneration = 0;

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getActiveTarget(): Promise<PopupTarget | null> {
  return readStablePopupTarget(getActiveTab, blockedSiteForUrl);
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
  actionPending = pending || !initialized;
  primaryEl.disabled = actionPending || blocklistNeedsRefresh;
  clearEl.disabled = actionPending || blocklistNeedsRefresh;
  languageEl.disabled = actionPending || localeNeedsRefresh;
  document.body.setAttribute("aria-busy", String(pending));
}

async function reloadTabIfPossible(target: PopupTarget): Promise<void> {
  try {
    const tab = await chrome.tabs.get(target.tabId);
    if (!mayReloadPopupTarget(target, tab)) return;
    await chrome.tabs.reload(target.tabId);
  } catch {
    // Some browser/internal pages cannot be reloaded by an extension after the mutation succeeds.
  }
}

async function sendAction(message: Message): Promise<boolean> {
  try {
    await sendMessage(message);
    return true;
  } catch (error) {
    // A failed acknowledgement can mean another context changed the
    // blocklist after our initial read, or that the reply was lost after
    // committing. Refresh before allowing another mutation, while keeping
    // the original worker failure visible.
    try {
      await render();
      showError(error);
    } catch (refreshError) {
      blocklistNeedsRefresh = true;
      hide(primaryEl);
      show(noteEl, [
        i18n.t("popupBlocklistRefreshRequired"),
        errorText(error),
        errorText(refreshError),
      ].join(" · "));
    }
    return false;
  }
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
  primaryEl.disabled = actionPending || blocklistNeedsRefresh;
  primaryEl.onclick = () => void mutateDisplayedTarget(target).catch(showError);
}

async function mutateDisplayedTarget(expected: PopupTarget): Promise<void> {
  if (actionPending || blocklistNeedsRefresh) return;
  setActionPending(true);
  try {
    const current = await getActiveTarget();
    if (!samePopupTarget(expected, current)) {
      await render();
      show(noteEl, i18n.t("currentSiteChanged"));
      return;
    }
    const message: Message = current.blockedHost
      ? { type: "unblock", host: current.blockedHost, popupTargetHost: current.host }
      : { type: "block", host: current.host, popupTargetHost: current.host };
    if (!(await sendAction(message))) return;
    await reloadTabIfPossible(current);
    window.close();
  } finally {
    setActionPending(false);
  }
}

async function clearBlocklist(): Promise<void> {
  if (actionPending || blocklistNeedsRefresh) return;
  setActionPending(true);
  try {
    const expectedSites = await getBlockedSites();
    if (!window.confirm(i18n.t("clearBlocklistConfirm"))) return;
    const result = await settlePopupAction(
      () => sendMessage({ type: "clear", expectedSites }),
      render,
    );
    if ("refreshError" in result) {
      blocklistNeedsRefresh = true;
      hide(primaryEl);
      show(noteEl, [
        i18n.t(result.committed ? "popupBlocklistSavedRefreshFailed" : "popupBlocklistRefreshRequired"),
        ...(!result.committed ? [errorText(result.error)] : []),
        errorText(result.refreshError),
      ].join(" · "));
    } else if (!result.committed) {
      showError(result.error);
    }
  } catch (error) {
    showError(error);
  } finally {
    setActionPending(false);
  }
}

async function refreshPopupLanguage(): Promise<void> {
  const loaded = await loadI18n();
  i18n = loaded;
  localePreference = loaded.preference;
  languageEl.value = localePreference;
  applyStaticText();
}

async function changeLanguage(): Promise<void> {
  if (actionPending || localeNeedsRefresh) return;
  const requested = languageEl.value as LocalePreference;
  setActionPending(true);
  let saved = false;
  try {
    await setLocalePreference(requested, localePreference);
    saved = true;
    localePreference = requested;
    await refreshPopupLanguage();
    await render();
  } catch (error) {
    if (!saved) {
      // A concurrent Options/Popup edit may have won the CAS. Re-read the
      // committed language and keep the rejected action visible.
      try {
        await refreshPopupLanguage();
        await render();
        showError(error);
      } catch (refreshError) {
        localeNeedsRefresh = true;
        languageEl.value = localePreference;
        showError(i18n.t("popupLanguageRefreshRequired") + " · " + errorText(error) + " · " + errorText(refreshError));
      }
    } else {
      // A catalog/view read failure cannot undo a committed locale write.
      localeNeedsRefresh = true;
      languageEl.value = localePreference;
      showError(i18n.t("popupLanguageSavedRefreshFailed") + " · " + errorText(error));
    }
  } finally {
    setActionPending(false);
  }
}

clearEl.addEventListener("click", () => {
  if (actionPending) return;
  void clearBlocklist();
});

languageEl.addEventListener("change", () => {
  void changeLanguage();
});

async function init(): Promise<void> {
  setActionPending(true);
  await refreshPopupLanguage();
  await render();
  initialized = true;
  setActionPending(false);
}

void init().catch((error: unknown) => {
  setActionPending(false);
  showError(error);
});
