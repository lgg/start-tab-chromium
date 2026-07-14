(() => {
  const SETTINGS_KEY = "startPageSettings";
  const COMMAND_PREFIX = "startTabWorkerCommand:";
  const RESPONSE_PREFIX = "startTabWorkerResponse:";
  const OVERLAY_ID = "startTabGateOverlay";
  const splitMarkers = ["split-view", "split_view", "splitview", "tab-picker", "tab_picker", "select-tab", "select_tab"];
  const text = (key, fallback) => chrome.i18n.getMessage(key) || fallback;
  const ignore = () => undefined;
  const run = (action) => {
    try { void Promise.resolve(action()).catch(ignore); } catch { ignore(); }
  };

  async function workerCommand(message) {
    const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const commandKey = `${COMMAND_PREFIX}${id}`;
    const responseKey = `${RESPONSE_PREFIX}${id}`;
    await new Promise((resolve, reject) => {
      let done = false;
      const finish = (error) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        chrome.storage.onChanged.removeListener(listener);
        void chrome.storage.local.remove([commandKey, responseKey]);
        error ? reject(error) : resolve();
      };
      const listener = (changes, area) => {
        if (area !== "local" || !changes[responseKey]) return;
        const response = changes[responseKey].newValue;
        finish(response?.ok ? null : new Error(response?.error || "Worker command failed"));
      };
      const timeout = setTimeout(() => finish(new Error("Worker command timed out")), 10_000);
      chrome.storage.onChanged.addListener(listener);
      void chrome.storage.local.set({ [commandKey]: { id, message } }).catch(finish);
    });
  }

  const openNative = () => workerCommand({ type: "open-native-new-tab" });

  function removeOverlay() {
    document.getElementById(OVERLAY_ID)?.remove();
  }

  function showOverlay(title, description, tabs = []) {
    removeOverlay();
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = "position:fixed;inset:0;z-index:30;display:grid;place-items:center;padding:24px;background:#020617e8;color:#f8fafc;font:16px system-ui";
    const panel = document.createElement("section");
    panel.style.cssText = "width:min(680px,100%);max-height:calc(100vh - 48px);overflow:auto;border:1px solid #ffffff24;border-radius:12px;background:#0f172af5;padding:24px";
    const heading = document.createElement("h1");
    heading.textContent = title;
    const body = document.createElement("p");
    body.textContent = description;
    panel.append(heading, body);
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
  }

  async function splitContext() {
    const current = await chrome.tabs.getCurrent().catch(() => null);
    const marked = [location.href, document.referrer, window.name].some((value) => splitMarkers.some((marker) => String(value).toLowerCase().includes(marker)));
    return marked || (typeof current?.openerTabId === "number" && location.pathname.endsWith("/newtab.html"));
  }

  async function apply() {
    if (await splitContext()) {
      const current = await chrome.tabs.getCurrent().catch(() => null);
      const tabs = (await chrome.tabs.query({ currentWindow: true })).filter((tab) => tab.id !== current?.id && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("chrome-extension://"));
      showOverlay(text("splitViewTitle", "Choose a tab for Split View"), text("splitViewText", "Select an open tab below."), tabs);
      return;
    }
    const items = await chrome.storage.local.get(SETTINGS_KEY);
    if (items[SETTINGS_KEY]?.startTab?.enabled !== false) removeOverlay();
    else showOverlay(text("startTabDisabledTitle", "Start Tab is disabled"), text("startTabDisabledText", "Re-enable Start Tab in extension settings."));
  }

  const nativeButton = document.getElementById("nativeNewTab");
  if (nativeButton) nativeButton.addEventListener("click", () => run(openNative));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SETTINGS_KEY]) void apply().catch(ignore);
  });
  void apply().catch(ignore);
})();
