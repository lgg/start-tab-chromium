/** Return only an explicit URL transition from chrome.tabs.onUpdated. */
export function changedTabNavigationUrl(changeInfo: { url?: unknown }): string | null {
  return typeof changeInfo.url === "string" && changeInfo.url.length > 0
    ? changeInfo.url
    : null;
}

/** The pending destination is more authoritative than the old committed URL. */
export function currentTabNavigationUrl(tab: { url?: string; pendingUrl?: string }): string | undefined {
  return tab.pendingUrl || tab.url;
}

export interface NewTabRedirectDependencies {
  isEligible: (url: string) => boolean;
  getTab: (tabId: number) => Promise<{ url?: string; pendingUrl?: string }>;
  shouldBypass: (tabId: number) => Promise<boolean>;
  isEnabled: () => Promise<boolean>;
  redirect: (tabId: number) => Promise<void>;
}

/** An asynchronous fallback must not overwrite a user's newer navigation.
 * Track only outstanding attempts; each explicit URL transition supersedes
 * the older attempt for that tab, even if the new URL is not eligible. */
export class NewTabRedirectGuard {
  private readonly pending = new Map<number, symbol>();
  constructor(private readonly deps: NewTabRedirectDependencies) {}

  cancel(tabId: number): void {
    this.pending.delete(tabId);
  }

  async observe(tabId: number | undefined, url: string | undefined): Promise<void> {
    if (tabId === undefined || !url) return;
    this.cancel(tabId);
    if (!this.deps.isEligible(url)) return;
    const token = Symbol();
    this.pending.set(tabId, token);
    const isCurrent = (): boolean => this.pending.get(tabId) === token;
    const matchesLiveTab = async (): Promise<boolean> => {
      if (!isCurrent()) return false;
      try {
        const tab = await this.deps.getTab(tabId);
        return isCurrent() && currentTabNavigationUrl(tab) === url;
      } catch {
        // The tab may have closed or the browser may hide its URL.
        return false;
      }
    };
    try {
      if (!await matchesLiveTab()) return;
      if (await this.deps.shouldBypass(tabId) || !isCurrent()) return;
      if (!await this.deps.isEnabled() || !isCurrent()) return;
      if (!await matchesLiveTab() || !isCurrent()) return;
      await this.deps.redirect(tabId);
    } finally {
      // An older finally block must never delete the newer attempt.
      if (isCurrent()) this.cancel(tabId);
    }
  }
}
