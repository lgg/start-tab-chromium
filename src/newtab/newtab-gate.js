(() => {
  const SETTINGS_KEY = "startPageSettings";
  const LOCALE_OVERRIDE_KEY = "localeOverride";
  const OVERLAY_ID = "startTabGateOverlay";
  const ONBOARDING_ID = "onboarding";
  const DIAGNOSTICS_KEY = "startTabLastNativeNewTabContext";
  const GATE_CHANGE_EVENT = "start-tab-gate-change";
  const DISMISS_ONBOARDING_EVENT = "start-tab-dismiss-onboarding";
  const catalogFiles = ["messages.json", "roadmap-messages.json", "round7-messages.json"];
  const splitMarkers = ["split-view", "split_view", "splitview", "side-by-side", "sidebyside", "side_panel", "side-panel", "tab-picker", "tab_picker", "tabpicker", "select-tab", "select_tab", "selecttab"];
  const ignore = () => undefined;
  let catalog = null;
  let previousFocus = null;
  let catalogLoadGeneration = 0;
  let applyGeneration = 0;
  let nativeActionPending = false;
  let pageActive = true;
  let pickerActionPending = false;
  const nativeStatusElements = new WeakMap();

  const run = (action) => {
    try { void Promise.resolve(action()).catch(ignore); } catch { ignore(); }
  };

  // Keep this early classic-script gate consistent with i18n.ts, including
  // regional legacy preferences and the ordered browser language list.
  function resolvedGateLocale(override) {
    const normalize = (value) => {
      const language = typeof value === "string" ? value.toLowerCase().replace("_", "-").split("-")[0] : "";
      return language === "en" || language === "ru" ? language : null;
    };
    const preference = normalize(override);
    if (preference) return preference;
    const languages = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages : [navigator.language];
    for (const language of languages) {
      const supported = normalize(language);
      if (supported) return supported;
    }
    return "en";
  }

  async function readCommitted(key) {
    const read = () => chrome.storage.local.get(key);
    return navigator.locks
      ? navigator.locks.request("start-tab:data-write", { mode: "exclusive" }, read)
      : read();
  }

  async function loadGateCatalog() {
    if (!pageActive) return false;
    const generation = ++catalogLoadGeneration;
    const items = await readCommitted(LOCALE_OVERRIDE_KEY).catch(() => ({}));
    const locale = resolvedGateLocale(items[LOCALE_OVERRIDE_KEY]);
    const load = async (language) => {
      const catalogs = await Promise.all(catalogFiles.map(async (file) => {
        try {
          const response = await fetch(chrome.runtime.getURL(`_locales/${language}/${file}`));
          if (!response.ok) return null;
          const value = await response.json();
          return value && typeof value === "object" && !Array.isArray(value) ? value : null;
        } catch {
          return null;
        }
      }));
      return { baseAvailable: catalogs[0] !== null, catalog: Object.assign({}, ...catalogs) };
    };
    const defaults = await load("en");
    const preferred = locale === "en" ? defaults : await load(locale);
    const nextCatalog = preferred.baseAvailable
      ? { ...defaults.catalog, ...preferred.catalog } : defaults.catalog;
    if (!pageActive || generation !== catalogLoadGeneration) return false;
    catalog = nextCatalog;
    return true;
  }

  const text = (key, fallback) => catalog?.[key]?.message || chrome.i18n.getMessage(key) || fallback;

  async function workerCommand(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "Worker command failed");
  }

  const openNative = () => workerCommand({ type: "open-native-new-tab" });

  function nativeStatus(button) {
    const existing = nativeStatusElements.get(button);
    if (existing?.isConnected) return existing;
    const status = document.createElement("p");
    status.hidden = true;
    status.setAttribute("role", "alert");
    status.setAttribute("aria-live", "assertive");
    status.style.cssText = "margin:8px 0;color:#fecaca;font-size:14px";
    button.after(status);
    nativeStatusElements.set(button, status);
    return status;
  }

  function syncNativeButton(button) {
    // aria-disabled keeps keyboard focus stable; runNative enforces the lease.
    if (nativeActionPending || pickerActionPending) {
      button.setAttribute("aria-busy", "true");
      button.setAttribute("aria-disabled", "true");
    } else {
      button.removeAttribute("aria-busy");
      button.removeAttribute("aria-disabled");
    }
  }

  function syncPickerChoice(choice) {
    const pending = nativeActionPending || pickerActionPending;
    choice.setAttribute("aria-disabled", String(pending));
    choice.setAttribute("aria-busy", String(pending));
  }

  // Both controls navigate away from the current page. A page-wide lease
  // must disable both sets, including controls in a replacement overlay.
  function syncNativeButtons() {
    for (const button of document.querySelectorAll("[data-native-new-tab]")) syncNativeButton(button);
    for (const choice of document.querySelectorAll("#" + OVERLAY_ID + " [data-split-choice]")) syncPickerChoice(choice);
  }

  async function runNative(button) {
    if (!pageActive || nativeActionPending || !button.isConnected) return;
    if (pickerActionPending) return;
    nativeActionPending = true;
    syncNativeButtons();
    try {
      for (const candidate of document.querySelectorAll("[data-native-new-tab]")) {
        const status = nativeStatusElements.get(candidate);
        if (status) { status.hidden = true; status.textContent = ""; }
      }
      await openNative();
    } catch {
      if (!pageActive) return;
      // The gate may have rebuilt its overlay while the worker was busy.
      const replacement = document.querySelector("#" + OVERLAY_ID + " [data-native-new-tab]");
      const target = replacement || (button.isConnected ? button : document.getElementById("nativeNewTab"));
      if (target?.isConnected) {
        const status = nativeStatus(target);
        status.textContent = text("nativeNewTabFailed", "Couldn't open the browser's native new tab. Try again.");
        status.hidden = false;
      }
    } finally {
      nativeActionPending = false;
      if (pageActive) syncNativeButtons();
    }
  }

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

  function showOverlay(title, description, tabs = [], retry = false) {
    const generation = applyGeneration;
    const isCurrent = (node) => pageActive && node.isConnected && generation === applyGeneration;
    removeOverlay();
    window.dispatchEvent(new Event(DISMISS_ONBOARDING_EVENT));
    document.getElementById(ONBOARDING_ID)?.remove();
    syncPageInert();
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
    const choices = [];
    const choiceStatus = document.createElement("p");
    choiceStatus.hidden = true;
    choiceStatus.setAttribute("role", "alert");
    choiceStatus.setAttribute("data-split-choice-status", "");
    const syncChoices = () => { for (const choice of choices) syncPickerChoice(choice); };
    for (const tab of tabs) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = tab.title; // webTab already supplies a nonempty title or URL.
      button.style.cssText = "display:block;width:100%;margin:8px 0;padding:10px;text-align:left";
      button.addEventListener("click", () => run(async () => {
        if (!isCurrent(button) || pickerActionPending || nativeActionPending) return;
        pickerActionPending = true;
        syncNativeButtons();
        choiceStatus.hidden = true;
        try {
          const current = await chrome.tabs.getCurrent();
          if (!isCurrent(button)) return;
          if (typeof current?.id !== "number") throw new Error("Split picker has no current tab");
          await chrome.tabs.update(current.id, { url: tab.url });
        } catch {
          if (pageActive) {
            // A storage/locale refresh may have replaced the picker while
            // tabs.update was pending. Report the failure in the live picker.
            const status = document.querySelector("#" + OVERLAY_ID + " [data-split-choice-status]");
            if (status) {
              status.textContent = text("gateChoiceFailed", "Could not open the selected tab. Try again.");
              status.hidden = false;
            }
          }
        } finally {
          pickerActionPending = false;
          if (pageActive) syncNativeButtons();
        }
      }));
      button.setAttribute("data-split-choice", "");
      choices.push(button);
      panel.append(button);
      firstAction ??= button;
    }
    if (choices.length) { panel.append(choiceStatus); syncChoices(); }
    if (retry) {
      const retryButton = document.createElement("button");
      retryButton.type = "button";
      retryButton.textContent = text("gateRetry", "Retry");
      retryButton.addEventListener("click", () => {
        if (isCurrent(retryButton)) run(apply);
      });
      panel.append(retryButton);
      firstAction ??= retryButton;
    }
    const native = document.createElement("button");
    native.type = "button";
    native.setAttribute("data-native-new-tab", "");
    syncNativeButton(native);
    native.textContent = text("openNativeNewTab", "Open browser new tab");
    native.addEventListener("click", () => { if (isCurrent(native)) run(() => runNative(native)); });
    const settings = document.createElement("button");
    settings.type = "button";
    settings.textContent = text("openSettings", "Open settings");
    settings.addEventListener("click", () => {
      if (isCurrent(settings)) run(() => chrome.runtime.openOptionsPage());
    });
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
    if (!pageActive) return false;
    const marked = [location.href, document.referrer, window.name].some(containsSplitMarker);
    let openerMarked = false;
    if (!marked && typeof current?.openerTabId === "number") {
      const opener = await chrome.tabs.get(current.openerTabId).catch(() => null);
      if (!pageActive) return false;
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
    if (!pageActive) return;
    const generation = ++applyGeneration;
    try {
      const split = await splitContext();
      if (!pageActive || generation !== applyGeneration) return;
      if (split) {
        const current = await chrome.tabs.getCurrent().catch(() => null);
        if (!pageActive || generation !== applyGeneration) return;
        let candidates;
        try {
          candidates = await chrome.tabs.query({ currentWindow: true });
        } catch {
          // A rejected query is not an empty window. Expose a recovery
          // action without allowing obsolete generations to replace the gate.
          if (pageActive && generation === applyGeneration) {
            showOverlay(text("splitViewTitle", "Choose a tab for Split View"),
              text("splitViewQueryFailed", "Could not list open tabs. Try again."), [], true);
          }
          return;
        }
        if (!pageActive || generation !== applyGeneration) return;
        const tabs = candidates.filter((tab) => tab.id !== current?.id).map(webTab).filter(Boolean);
        showOverlay(text("splitViewTitle", "Choose a tab for Split View"), text("splitViewText", "Select an open tab below."), tabs);
        return;
      }
      const items = await readCommitted(SETTINGS_KEY);
      if (!pageActive || generation !== applyGeneration) return;
      if (items[SETTINGS_KEY]?.startTab?.enabled !== false) removeOverlay();
      else showOverlay(text("startTabDisabledTitle", "Start Tab is disabled"), text("startTabDisabledText", "Re-enable Start Tab in extension settings."));
    } catch {
      // An unsuccessful refresh invalidates the previous picker. Do not
      // leave its inert overlay on screen with permanently stale controls.
      if (pageActive && generation === applyGeneration) {
        showOverlay(text("somethingWentWrong", "Something went wrong."), text("gateRefreshFailed", "Could not read Start Tab settings. Retry or open extension settings."), [], true);
      }
    } finally {
      if (pageActive && generation === applyGeneration) window.dispatchEvent(new Event(GATE_CHANGE_EVENT));
    }
  }

  function handleStorageChange(changes, area) {
    if (!pageActive || area !== "local") return;
    if (changes[LOCALE_OVERRIDE_KEY]) {
      void loadGateCatalog().then((current) => current ? apply() : undefined).catch(ignore);
    }
    if (changes[SETTINGS_KEY]) {
      // A combined settings/locale transaction must invalidate stale choices
      // immediately, rather than wait for a possibly slow locale catalog.
      void apply().catch(ignore);
    }
  }

  async function initGate() {
    if (!pageActive) return;
    const nativeButton = document.getElementById("nativeNewTab");
    if (nativeButton) {
      nativeButton.setAttribute("data-native-new-tab", "");
      syncNativeButton(nativeButton);
      nativeButton.addEventListener("click", () => run(() => runNative(nativeButton)));
    }
    chrome.storage.onChanged.addListener(handleStorageChange);
    if (await loadGateCatalog()) await apply();
  }

  window.addEventListener("pagehide", () => {
    pageActive = false;
    applyGeneration++;
    catalogLoadGeneration++;
    chrome.storage.onChanged.removeListener(handleStorageChange);
  }, { once: true });

  window.startTabGateReady = Promise.resolve().then(initGate).catch(ignore);
})();
