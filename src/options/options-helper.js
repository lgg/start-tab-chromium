(() => {
  const SETTINGS_KEY = "startPageSettings";
  let pendingLayoutPatch = {};

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

  async function patchLayout(patch) {
    pendingLayoutPatch = { ...pendingLayoutPatch, ...patch };
    const settings = await rawSettings();
    const layout = isRecord(settings.layout) ? settings.layout : {};
    await chrome.storage.local.set({
      [SETTINGS_KEY]: {
        ...settings,
        layout: {
          ...layout,
          ...pendingLayoutPatch,
        },
      },
    });
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

  async function addLayoutExtraFields(layoutSection) {
    const grid = layoutSection.querySelector(".grid");
    if (!grid || grid.querySelector("#layoutMode")) return;
    const settings = await rawSettings();
    const layout = isRecord(settings.layout) ? settings.layout : {};

    const modeLabel = document.createElement("label");
    modeLabel.className = "field field--wide start-tab-extra-field";
    const modeText = document.createElement("span");
    modeText.textContent = t("layoutMode", "Layout mode");
    const mode = document.createElement("select");
    mode.id = "layoutMode";
    mode.innerHTML = `<option value="grid">${t("layoutModeGrid", "Grid")}</option><option value="free">${t("layoutModeFree", "Free")}</option>`;
    mode.value = layout.mode === "free" ? "free" : "grid";
    mode.addEventListener("change", () => void patchLayout({ mode: mode.value }));
    modeLabel.append(modeText, mode);

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
    const titles = document.getElementById("showBlockTitles");
    if (mode instanceof HTMLSelectElement) pendingLayoutPatch.mode = mode.value;
    if (titles instanceof HTMLInputElement) pendingLayoutPatch.showBlockTitles = titles.checked;
    if (Object.keys(pendingLayoutPatch).length > 0) void patchLayout(pendingLayoutPatch);
  }

  function enhance() {
    removeSubtitle();
    enhanceBackupControls();
    enhanceStartTabSections();
  }

  document.addEventListener("submit", () => {
    window.setTimeout(reapplyPendingLayoutPatch, 250);
    window.setTimeout(reapplyPendingLayoutPatch, 900);
  });

  const observer = new MutationObserver(enhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  enhance();
})();
