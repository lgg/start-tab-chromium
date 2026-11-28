import { hostFromUrl } from "../lib/blocklist.js";
import { currentTabNavigationUrl } from "../lib/tab-navigation-change.js";

export interface PopupTarget {
  tabId: number;
  url: string;
  host: string;
  blockedHost: string | null;
}

/** Ensure a popup action still describes the active tab and its current block state. */
export function samePopupTarget(
  expected: PopupTarget,
  current: PopupTarget | null,
): current is PopupTarget {
  return current !== null
    && current.tabId === expected.tabId
    && current.host === expected.host
    && current.blockedHost === expected.blockedHost;
}

interface PopupTab {
  id?: number;
  url?: string;
  pendingUrl?: string;
}

function tabTarget(tab: PopupTab | undefined): Omit<PopupTarget, "blockedHost"> | null {
  if (!tab || typeof tab.id !== "number") return null;
  const url = currentTabNavigationUrl(tab);
  const host = url ? hostFromUrl(url) : null;
  return url && host ? { tabId: tab.id, url, host } : null;
}

/** The blocklist lookup can wait for another context's transaction. Do not
 * publish a target whose tab or host changed during that wait. A pending URL
 * supersedes the previous committed destination. */
export async function readStablePopupTarget(
  readTab: () => Promise<PopupTab | undefined>,
  blockedSiteForUrl: (url: string) => Promise<string | null>,
): Promise<PopupTarget | null> {
  const initial = tabTarget(await readTab());
  if (!initial) return null;
  const blockedHost = await blockedSiteForUrl(initial.url);
  const current = tabTarget(await readTab());
  if (!current || current.tabId !== initial.tabId || current.host !== initial.host) return null;
  return { ...current, blockedHost };
}

/** Blocking is host-scoped, but reloading is document-scoped. A new
 * destination on the same host is still a different navigation and must
 * not be interrupted by a delayed acknowledgement. */
export function mayReloadPopupTarget(target: PopupTarget, tab: PopupTab | undefined): boolean {
  if (!tab || tab.id !== target.tabId || !tab.url) return false;
  if (tab.pendingUrl && tab.pendingUrl !== tab.url) return false;
  return tab.url === target.url && hostFromUrl(tab.url) === target.host;
}
