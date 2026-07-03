(() => {
  const SETTINGS_KEY = "startPageSettings";
  const ENHANCE_DELAY_MS = 80;
  const IP_PROVIDERS = [
    ["https://ipapi.co/json/", "ipapi.co"],
    ["https://ipwho.is/", "ipwho.is"],
    ["https://get.geojs.io/v1/ip/geo.json", "GeoJS"],
    ["https://api.ip.sb/geoip", "IP.SB"],
    ["https://ipinfo.io/json", "IPinfo"],
    ["https://api.db-ip.com/v2/free/self", "DB-IP Free"],
    ["https://freeipapi.com/api/json", "FreeIPAPI"],
    ["https://ipwhois.app/json/", "IPWhois.app"],
    ["https://api.country.is/", "country.is"],
    ["https://www.cloudflare.com/cdn-cgi/trace", "Cloudflare Trace"],
  ];

  let pendingLayoutPatch = {};
  let pendingIpEndpoint = "";
  let enhanceTimer = 0;
  let enhanceRunning = false;

  function t(key, fallback) {
    return chrome.i18n.getMessage(key) || fallback || key;
  }

  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }

  async function rawSettings() {
    const items = await chrome.storage.local.get(SETTINGS_KEY);
    return isRecord(items[SETTINGS_KEY]) ? items[SETTINGS_KEY] : {};
  }

  async function patchSettings(patch) {
    const settings = await rawSettings();
    await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, ...patch } });
  }

  async function patchLayout(patch) {
    pendingLayoutPatch = { ...pendingLayoutPatch, ...patch };
    const settings = await rawSettings();
    const layout = isRecord(settings.layout) ? settings.layout : {};
    await patchSettings({ layout: { ...layout, ...pendingLayoutPatch } });
  }

  async function patchIpEndpoint(endpoint) {
    pendingIpEndpoint = endpoint;
    const settings = await rawSettings();
    const ip = isRecord(settings.ip) ? settings.ip : {};
    await patchSettings({ ip: { ...ip, endpoint } });
    const endpointInput = document.getElementById("ipEndpoint");
    if (endpointInput instanceof HTMLInputElement) endpointInput.value = endpoint;
  }

  function removeSubtitle() {
    const subtitle = document.getElementById("subtitle");
    if (!subtitle) return;
    subtitle.hidden = true;
    subtitle.textContent = "";
  }

  function group(title, children) {
    const wrapper = document.createElement("section");
    wrapper.className = "backup-group";
    const heading = document.createElement("h3");
    heading.textContent = title;
    wrapper.append(heading, ...children.filter(Boolean));
    return wrapper;
  }

  function enhanceBackupControls() {
    const file = document.getElementById("backupFile");
    if (!(file instanceof HTMLInputElement)) return;
    const actions = file.closest(".actions");
    if (!actions || actions.classList.contains("backup-groups")) return;
    const items = Array.from(actions.children);
    actions.className = "backup-groups field--wide";
    actions.replaceChildren(
      group(t("backupExportGroup", "Export"), [items[0]]),
      group(t("backupImportGroup", "Import"), [items[1], items[2]]),
      group(t("backupSyncGroup", "Sync"), items.slice(3)),
    );
  }

  function groupHeader(key, fallback) {
    const header = document.createElement("div");
    header.className = "options-group-title";
    const title = document.createElement("h3");
    title.textContent = t(key, fallback);
    header.append(title);
    return header;
  }

  function startTabPanel() {
    return document.getElementById("panel-startTab");
  }

  function sectionWithControl(id) {
    return document.getElementById(id)?.closest(".section") || null;
  }

  function insertBeforeOnce(panel, key, node, target) {
    if (!target || panel.querySelector(`[data-options-group="${key}"]`)) return;
    node.dataset.optionsGroup = key;
    panel.insertBefore(node, target);
  }

  function layoutSelect(id, labelKey, labelFallback, options, value, onChange) {
    const wrapper = document.createElement("label");
    wrapper.className = "field field--wide start-tab-extra-field";
    const label = document.createElement("span");
    label.textContent = t(labelKey, labelFallback);
    const select = document.createElement("select");
    select.id = id;
    for (const [optionValue, optionKey, optionFallback] of options) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = t(optionKey, optionFallback);
      select.append(option);
    }
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    wrapper.append(label, select);
    return wrapper;
  }

  function fixWeatherCoordinateInputs() {
    const latitude = document.getElementById("weatherLatitude");
    if (latitude instanceof HTMLInputElement) {
      latitude.step = "any";
      latitude.min = "-90";
      latitude.max = "90";
      latitude.inputMode = "decimal";
    }

    const longitude = document.getElementById("weatherLongitude");
    if (longitude instanceof HTMLInputElement) {
      longitude.step = "any";
      longitude.min = "-180";
      longitude.max = "180";
      longitude.inputMode = "decimal";
    }
  }

  async function addIpProviderField() {
    const endpointInput = document.getElementById("ipEndpoint");
    if (!(endpointInput instanceof HTMLInputElement)) return;
    const grid = endpointInput.closest(".grid");
    if (!grid || grid.querySelector("#ipProvider") || grid.dataset.ipProviderEnhancing === "true") return;
    grid.dataset.ipProviderEnhancing = "true";

    try {
      const settings = await rawSettings();
      const ip = isRecord(settings.ip) ? settings.ip : {};
      const currentEndpoint = typeof ip.endpoint === "string" && ip.endpoint ? ip.endpoint : endpointInput.value;
      pendingIpEndpoint = pendingIpEndpoint || currentEndpoint;

      const wrapper = document.createElement("label");
      wrapper.className = "field field--wide start-tab-extra-field";
      const label = document.createElement("span");
      label.textContent = t("ipProvider", "IP provider");
      const select = document.createElement("select");
      select.id = "ipProvider";

      for (const [endpoint, title] of IP_PROVIDERS) {
        const option = document.createElement("option");
        option.value = endpoint;
        option.textContent = title;
        select.append(option);
      }

      const custom = document.createElement("option");
      custom.value = "custom";
      custom.textContent = t("customEndpoint", "Custom endpoint");
      select.append(custom);
      select.value = IP_PROVIDERS.some(([endpoint]) => endpoint === currentEndpoint) ? currentEndpoint : "custom";
      select.addEventListener("change", () => {
        if (select.value !== "custom") void patchIpEndpoint(select.value);
        endpointInput.disabled = select.value !== "custom";
      });

      endpointInput.disabled = select.value !== "custom";
      endpointInput.addEventListener("input", () => {
        if (select.value === "custom") pendingIpEndpoint = endpointInput.value;
      });

      wrapper.append(label, select);
      endpointInput.closest(".field")?.insertAdjacentElement("beforebegin", wrapper);
    } finally {
      delete grid.dataset.ipProviderEnhancing;
    }
  }

  async function addLayoutExtraFields(layoutSection) {
    const grid = layoutSection.querySelector(".grid");
    if (!grid || grid.dataset.layoutExtras === "true" || grid.querySelector("#layoutMode")) return;
    grid.dataset.layoutExtras = "true";
    const settings = await rawSettings();
    const layout = isRecord(settings.layout) ? settings.layout : {};

    const modeLabel = layoutSelect(
      "layoutMode",
      "layoutMode",
      "Layout mode",
      [
        ["grid", "layoutModeGrid", "Grid"],
        ["free", "layoutModeFree", "Free"],
      ],
      layout.mode === "free" ? "free" : "grid",
      (mode) => void patchLayout({ mode }),
    );

    const zoneLabel = layoutSelect(
      "layoutZone",
      "layoutZone",
      "Layout zone",
      [
        ["contained", "layoutZoneContained", "Contained"],
        ["full", "layoutZoneFull", "Full viewport"],
      ],
      layout.zone === "full" ? "full" : "contained",
      (zone) => void patchLayout({ zone }),
    );

    const titlesLabel = document.createElement("label");
    titlesLabel.className = "field field--wide start-tab-extra-field";
    const titlesText = document.createElement("span");
    titlesText.textContent = t("showBlockTitles", "Show block titles");
    const checkboxWrap = document.createElement("span");
    checkboxWrap.className = "checkbox";
    const titles = document.createElement("input");
    titles.id = "showBlockTitles";
    titles.type = "checkbox";
    titles.checked = layout.showBlockTitles !== false;
    titles.addEventListener("change", () => void patchLayout({ showBlockTitles: titles.checked }));
    checkboxWrap.append(titles, document.createTextNode(t("enabled", "Enabled")));
    titlesLabel.append(titlesText, checkboxWrap);

    grid.prepend(titlesLabel);
    grid.prepend(zoneLabel);
    grid.prepend(modeLabel);
  }

  function enhanceStartTabSections() {
    const panel = startTabPanel();
    if (!panel) return;
    const startSection = sectionWithControl("startTabEnabled");
    const layoutSection = sectionWithControl("layoutColumns");
    const dateSection = sectionWithControl("dateTimeMode");
    insertBeforeOnce(panel, "general", groupHeader("startTabGroupGeneral", "Start Tab general"), startSection);
    insertBeforeOnce(panel, "layout", groupHeader("startTabGroupLayout", "Layout and blocks"), layoutSection);
    insertBeforeOnce(panel, "blocks", groupHeader("startTabGroupBlocks", "Block settings"), dateSection);
    if (layoutSection) void addLayoutExtraFields(layoutSection);
  }

  function reapplyPendingLayoutPatch() {
    const mode = document.getElementById("layoutMode");
    const zone = document.getElementById("layoutZone");
    const titles = document.getElementById("showBlockTitles");
    if (mode instanceof HTMLSelectElement) pendingLayoutPatch.mode = mode.value;
    if (zone instanceof HTMLSelectElement) pendingLayoutPatch.zone = zone.value;
    if (titles instanceof HTMLInputElement) pendingLayoutPatch.showBlockTitles = titles.checked;
    if (Object.keys(pendingLayoutPatch).length > 0) void patchLayout(pendingLayoutPatch);
  }

  function reapplyPendingIpEndpoint() {
    const provider = document.getElementById("ipProvider");
    const endpointInput = document.getElementById("ipEndpoint");
    if (provider instanceof HTMLSelectElement && provider.value !== "custom") pendingIpEndpoint = provider.value;
    if (provider instanceof HTMLSelectElement && provider.value === "custom" && endpointInput instanceof HTMLInputElement) {
      pendingIpEndpoint = endpointInput.value;
    }
    if (pendingIpEndpoint) void patchIpEndpoint(pendingIpEndpoint);
  }

  function enhance() {
    removeSubtitle();
    enhanceBackupControls();
    enhanceStartTabSections();
    fixWeatherCoordinateInputs();
    void addIpProviderField();
  }

  function scheduleEnhance() {
    window.clearTimeout(enhanceTimer);
    enhanceTimer = window.setTimeout(() => {
      if (enhanceRunning) return;
      enhanceRunning = true;
      try {
        enhance();
      } finally {
        enhanceRunning = false;
      }
    }, ENHANCE_DELAY_MS);
  }

  document.addEventListener("submit", () => {
    window.setTimeout(reapplyPendingLayoutPatch, 250);
    window.setTimeout(reapplyPendingLayoutPatch, 900);
    window.setTimeout(reapplyPendingIpEndpoint, 250);
    window.setTimeout(reapplyPendingIpEndpoint, 900);
  });

  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleEnhance();
})();
