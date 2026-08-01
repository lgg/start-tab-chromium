/** Return only an explicit URL transition from chrome.tabs.onUpdated. */
export function changedTabNavigationUrl(changeInfo: { url?: unknown }): string | null {
  return typeof changeInfo.url === "string" && changeInfo.url.length > 0
    ? changeInfo.url
    : null;
}
