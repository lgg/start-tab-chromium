(() => {
  const SETTINGS_KEY = "startPageSettings";
  const OVERLAY_ID = "startTabGateOverlay";
  const STYLE_ID = "startTabGateStyle";
  const DIAGNOSTICS_KEY = "startTabLastNativeNewTabContext";
  const SPLIT_VIEW_MARKERS = [
    "split-view",
    "split_view",
    "splitview",
    "split",
    "side-by-side",
    "sidebyside",
    "side_panel",
    "side-panel",
    "tab-picker",
    "tab_picker",
    "tabpicker",
    "select-tab",
    "select_tab",
    "selecttab",
    "picker",
    "pane",
  ];
  const FALLBACK_MESSAGES = {
    startTabDisabledTitle: "Start Tab is disabled",
    startTabDisabledText: "The extension is still active for blocking, backups, and other settings. Re-enable Start Tab content in extension settings.",
    openSettings: "Open settings",
    splitViewTitle: "Choose a tab for Split View",
    splitViewText: "Start Tab detected a browser split-view tab picker context. Select an open tab below, or open settings if this was detected incorrectly.",
    noTabsAvailable: "No open tabs are available in this window.",
  };

  function isEnabled(settings) {
    return settings?.startTab?.enabled !== false;
  }

  function t(key) {
    return chrome.i18n.getMessage(key) || FALLBACK_MESSAGES[key] || key;
  }

  function hasSplitViewMarker(value) {
    const normalized = String(value || "").toLowerCase();
    return SPLIT_VIEW_MARKERS.some((marker) => normalized.includes(marker));
  }

  function userAgentBrands() {
    const brands = navigator.userAgentData?.brands || [];
    return brands.map((brand) => brand.brand).join(" ");
  }

  function isCometLikeBrowser() {
    const haystack = `${navigator.userAgent} ${userAgentBrands()}`.toLowerCase();
    return haystack.includes("comet") || haystack.includes("perplexity");
  }

  async function currentTab() {
    try {
      return await chrome.tabs.getCurrent();
    } catch {
      return null;
    }
  }

  async function isLikelySplitViewContext() {
    const tab = await currentTab();
    const explicitMarker = [location.href, document.referrer, window.name].some(hasSplitViewMarker);
    const openerNewTab = typeof tab?.openerTabId === "number" && location.pathname.endsWith("/newtab.html");

    await chrome.storage.local.set({
      [DIAGNOSTICS_KEY]: {
        checkedAt: new Date().toISOString(),
        href: location.href,
        referrer: document.referrer,
        windowName: window.name,
        openerTabId: tab?.openerTabId ?? null,
        tabId: tab?.id ?? null,
        userAgent: navigator.userAgent,
        userAgentBrands: userAgentBrands(),
        explicitMarker,
        openerNewTab,
        cometLike: isCometLikeBrowser(),
      },
    });

    return explicitMarker || openerNewTab;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .start-tab-gate-overlay {
        position: fixed;
        inset: 0;
        z-index: 30;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgb(2 6 23 / 0.88);
        color: var(--text-color, #f8fafc);
        font-family: var(--font-family, system-ui, sans-serif);
        backdrop-filter: blur(16px);
      }
      .start-tab-gate-panel {
        width: min(680px, 100%);
        max-height: min(720px, calc(100vh - 48px));
        overflow: auto;
        border: 1px solid rgb(255 255 255 / 0.14);
        border-radius: 12px;
        background: rgb(15 23 42 / 0.94);
        box-shadow: 0 24px 80px rgb(0 0 0 / 0.35);
        padding: 24px;
      }
      .start-tab-gate-panel h1 {
        margin: 0 0 8px;
        font-size: 1.3rem;
      }
      .start-tab-gate-panel p {
        margin: 0 0 18px;
        color: rgb(248 250 252 / 0.68);
      }
      .start-tab-gate-actions,
      .start-tab-gate-tabs {
        display: grid;
        gap: 10px;
      }
      .start-tab-gate-actions {
        grid-template-columns: repeat(auto-fit, minmax(140px, max-content));
        margin-top: 16px;
      }
      .start-tab-gate-tabs button,
      .start-tab-gate-actions button {
        border: 1px solid rgb(255 255 255 / 0.14);
        border-radius: 8px;
        background: rgb(2 6 23 / 0.72);
        color: inherit;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        padding: 10px 12px;
        text-align: left;
      }
      .start-tab-gate-actions button {
        background: #93c5fd;
        color: #07111f;
        text-align: center;
      }
      .start-tab-gate-tabs button:hover,
      .start-tab-gate-actions button:hover {
        filter: brightness(1.12);
      }
      .start-tab-gate-tab-title {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .start-tab-gate-tab-url {
        display: block;
        overflow: hidden;
        color: rgb(248 250 252 / 0.58);
        font-size: 0.82rem;
        font-weight: 500;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `;
    document.head.append(style);
  }

  function removeOverlay() {
    document.getElementById(OVERLAY_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
  }

  function panel(titleText, bodyText) {
    ensureStyle();
    document.getElementById(OVERLAY_ID)?.remove();

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "start-tab-gate-overlay";

    const content = document.createElement("section");
    content.className = "start-tab-gate-panel";

    const title = document.createElement("h1");
    title.textContent = titleText;

    const text = document.createElement("p");
    text.textContent = bodyText;

    content.append(title, text);
    overlay.append(content);
    document.body.append(overlay);
    return content;
  }

  function renderDisabledOverlay() {
    const content = panel(t("startTabDisabledTitle"), t("startTabDisabledText"));
    const actions = document.createElement("div");
    actions.className = "start-tab-gate-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = t("openSettings");
    button.addEventListener("click", () => void chrome.runtime.openOptionsPage());
    actions.append(button);
    content.append(actions);
  }

  function isSelectableTab(tab, currentId) {
    if (tab.id === currentId || !tab.url) return false;
    if (tab.url.startsWith("chrome-extension://")) return false;
    if (tab.url.startsWith("chrome://")) return false;
    return true;
  }

  async function renderSplitViewOverlay() {
    const current = await currentTab();
    const content = panel(t("splitViewTitle"), t("splitViewText"));
    const list = document.createElement("div");
    list.className = "start-tab-gate-tabs";

    const tabs = await chrome.tabs.query({ currentWindow: true });
    const selectable = tabs.filter((tab) => isSelectableTab(tab, current?.id));

    if (selectable.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = t("noTabsAvailable");
      list.append(empty);
    }

    for (const tab of selectable) {
      const button = document.createElement("button");
      button.type = "button";
      const title = document.createElement("span");
      title.className = "start-tab-gate-tab-title";
      title.textContent = tab.title || tab.url || "Untitled";
      const url = document.createElement("span");
      url.className = "start-tab-gate-tab-url";
      url.textContent = tab.url || "";
      button.append(title, url);
      button.addEventListener("click", () => {
        if (current?.id !== undefined && tab.url) void chrome.tabs.update(current.id, { url: tab.url });
      });
      list.append(button);
    }

    const actions = document.createElement("div");
    actions.className = "start-tab-gate-actions";
    const settings = document.createElement("button");
    settings.type = "button";
    settings.textContent = t("openSettings");
    settings.addEventListener("click", () => void chrome.runtime.openOptionsPage());
    actions.append(settings);
    content.append(list, actions);
  }

  async function applyGate() {
    if (await isLikelySplitViewContext()) {
      await renderSplitViewOverlay();
      return;
    }

    const items = await chrome.storage.local.get(SETTINGS_KEY);
    if (isEnabled(items[SETTINGS_KEY])) {
      removeOverlay();
      return;
    }
    renderDisabledOverlay();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
    if (isEnabled(changes[SETTINGS_KEY].newValue)) {
      removeOverlay();
      return;
    }
    renderDisabledOverlay();
  });

  void applyGate();
})();
