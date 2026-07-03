(() => {
  const SETTINGS_KEY = "startPageSettings";
  const OVERLAY_ID = "startTabDisabledOverlay";
  const STYLE_ID = "startTabDisabledStyle";

  function isEnabled(settings) {
    return settings?.startTab?.enabled !== false;
  }

  function t(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  function removeOverlay() {
    document.getElementById(OVERLAY_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
  }

  function renderOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .start-tab-disabled-overlay {
        position: fixed;
        inset: 0;
        z-index: 20;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgb(2 6 23 / 0.84);
        color: var(--text-color, #f8fafc);
        font-family: var(--font-family, system-ui, sans-serif);
        backdrop-filter: blur(16px);
      }
      .start-tab-disabled-panel {
        width: min(520px, 100%);
        border: 1px solid rgb(255 255 255 / 0.14);
        border-radius: 12px;
        background: rgb(15 23 42 / 0.92);
        box-shadow: 0 24px 80px rgb(0 0 0 / 0.35);
        padding: 24px;
      }
      .start-tab-disabled-panel h1 {
        margin: 0 0 8px;
        font-size: 1.3rem;
      }
      .start-tab-disabled-panel p {
        margin: 0 0 18px;
        color: rgb(248 250 252 / 0.68);
      }
      .start-tab-disabled-panel button {
        border: 0;
        border-radius: 8px;
        background: #93c5fd;
        color: #07111f;
        cursor: pointer;
        font: inherit;
        font-weight: 800;
        padding: 10px 14px;
      }
    `;

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "start-tab-disabled-overlay";

    const panel = document.createElement("section");
    panel.className = "start-tab-disabled-panel";

    const title = document.createElement("h1");
    title.textContent = t("startTabDisabledTitle");

    const text = document.createElement("p");
    text.textContent = t("startTabDisabledText");

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = t("openSettings");
    button.addEventListener("click", () => void chrome.runtime.openOptionsPage());

    panel.append(title, text, button);
    overlay.append(panel);
    document.head.append(style);
    document.body.append(overlay);
  }

  async function applyGate() {
    const items = await chrome.storage.local.get(SETTINGS_KEY);
    if (isEnabled(items[SETTINGS_KEY])) {
      removeOverlay();
      return;
    }
    renderOverlay();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
    if (isEnabled(changes[SETTINGS_KEY].newValue)) {
      removeOverlay();
      return;
    }
    renderOverlay();
  });

  void applyGate();
})();
