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
