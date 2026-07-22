(() => {
  const SETTINGS_KEY = "startPageSettings";
  const LOCALE_OVERRIDE_KEY = "localeOverride";
  const OVERLAY_ID = "startTabGateOverlay";
  const ONBOARDING_ID = "onboarding";
  const DIAGNOSTICS_KEY = "startTabLastNativeNewTabContext";
  const GATE_CHANGE_EVENT = "start-tab-gate-change";
  const splitMarkers = ["split-view", "split_view", "splitview", "tab-picker", "tab_picker", "select-tab", "select_tab"];
  const ignore = () => undefined;
  let catalog = null;
  let previousFocus = null;

  const run = (action) => {
    try { void Promise.resolve(action()).catch(ignore); } catch { ignore(); }
  };

  async function loadGateCatalog() {
    const items = await chrome.storage.local.get(LOCALE_OVERRIDE_KEY).catch(() => ({}));
    const locale = items[LOCALE_OVERRIDE_KEY];
    if (locale !== "en" && locale !== "ru") return;
    try {
      const response = await fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`));
      if (response.ok) catalog = await response.json();
    } catch {
      catalog = null;
    }
  }

  const text = (key, fallback) => catalog?.[key]?.message || chrome.i18n.getMessage(key) || fallback;

  async function workerCommand(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "Worker command failed");
  }

  const openNative = () => workerCommand({ type: "open-native-new-tab" });

  function webTab(tab) {
    const value = typeof tab?.url === "string" ? tab.url.trim() : "";
    if (!value) return null;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      const title = typeof tab.title === "string" ? tab.title.trim() : "";
      return { url: value, title: title || value };
    } catch {
      return null;
    }
  }

  function syncPageInert() {
    const page = document.getElementById("startPage");
    if (!page) return;
    page.toggleAttribute("inert", Boolean(document.getElementById(OVERLAY_ID) || document.getElementById(ONBOARDING_ID)));
  }

  function focusableElements(container) {
    return [...container.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((node) => !node.hidden && node.getAttribute("aria-hidden") !== "true");
  }

  function trapFocus(event, panel) {
    if (event.key !== "Tab") return;
    const focusable = focusableElements(panel);
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function removeOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      syncPageInert();
      return;
    }
    overlay.remove();
    syncPageInert();
    if (previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
  }

  function showOverlay(title, description, tabs = []) {
    removeOverlay();
    document.getElementById(ONBOARDING_ID)?.remove();
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = "position:fixed;inset:0;z-index:30;display:grid;place-items:center;padding:24px;background:#020617e8;color:#f8fafc;font:16px system-ui";
    const panel = document.createElement("section");
    panel.tabIndex = -1;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", `${OVERLAY_ID}-title`);
    panel.setAttribute("aria-describedby", `${OVERLAY_ID}-description`);
    panel.style.cssText = "width:min(680px,100%);max-height:calc(100vh - 48px);overflow:auto;border:1px solid #ffffff24;border-radius:12px;background:#0f172af5;padding:24px";
    panel.addEventListener("keydown", (event) => trapFocus(event, panel));
    const heading = document.createElement("h1");
    heading.id = `${OVERLAY_ID}-title`;
    heading.textContent = title;
    const body = document.createElement("p");
    body.id = `${OVERLAY_ID}-description`;
    body.textContent = description;
    panel.append(heading, body);
    let firstAction = null;
    for (const tab of tabs) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = tab.title || tab.url || "Untitled";
      button.style.cssText = "display:block;width:100%;margin:8px 0;padding:10px;text-align:left";
      button.addEventListener("click", () => run(async () => {
        const current = await chrome.tabs.getCurrent();
        if (current?.id !== undefined && tab.url) await chrome.tabs.update(current.id, { url: tab.url });
      }));
      panel.append(button);
      firstAction ??= button;
    }
    const native = document.createElement("button");
    native.type = "button";
    native.textContent = text("openNativeNewTab", "Open browser new tab");
    native.addEventListener("click", () => run(openNative));
    const settings = document.createElement("button");
    settings.type = "button";
    settings.textContent = text("openSettings", "Open settings");
    settings.addEventListener("click", () => run(() => chrome.runtime.openOptionsPage()));
    panel.append(native, settings);
    overlay.append(panel);
    document.body.append(overlay);
    syncPageInert();
    (firstAction || native).focus();
  }

  function containsSplitMarker(value) {
    const normalized = String(value || "").toLowerCase();
    return splitMarkers.some((marker) => normalized.includes(marker));
  }

  async function splitContext() {
    const current = await chrome.tabs.getCurrent().catch(() => null);
    const marked = [location.href, document.referrer, window.name].some(containsSplitMarker);
    let openerMarked = false;
    if (!marked && typeof current?.openerTabId === "number") {
      const opener = await chrome.tabs.get(current.openerTabId).catch(() => null);
      openerMarked = [opener?.url, opener?.pendingUrl, opener?.title].some(containsSplitMarker);
    }
    const split = marked || openerMarked;
    if (split) {
      await chrome.storage.local.set({
        [DIAGNOSTICS_KEY]: { checkedAt: new Date().toISOString(), href: location.href, referrer: document.referrer, windowName: window.name, openerTabId: current?.openerTabId ?? null, tabId: current?.id ?? null },
      }).catch(ignore);
    }
    return split;
  }

  async function apply() {
    try {
      if (await splitContext()) {
        const current = await chrome.tabs.getCurrent().catch(() => null);
        const tabs = (await chrome.tabs.query({ currentWindow: true }))
          .filter((tab) => tab.id !== current?.id)
          .map(webTab)
          .filter(Boolean);
        showOverlay(text("splitViewTitle", "Choose a tab for Split View"), text("splitViewText", "Select an open tab below."), tabs);
        return;
      }
      const items = await chrome.storage.local.get(SETTINGS_KEY);
      if (items[SETTINGS_KEY]?.startTab?.enabled !== false) removeOverlay();
      else showOverlay(text("startTabDisabledTitle", "Start Tab is disabled"), text("startTabDisabledText", "Re-enable Start Tab in extension settings."));
    } finally {
      window.dispatchEvent(new Event(GATE_CHANGE_EVENT));
    }
  }

  async function initGate() {
    await loadGateCatalog();
    const nativeButton = document.getElementById("nativeNewTab");
    if (nativeButton) nativeButton.addEventListener("click", () => run(openNative));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[SETTINGS_KEY]) void apply().catch(ignore);
    });
    await apply();
  }

  window.startTabGateReady = Promise.resolve().then(initGate).catch(ignore);
})();
