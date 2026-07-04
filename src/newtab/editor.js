(() => {
  const SETTINGS_KEY = "startPageSettings";
  const EDITING_CLASS = "layout-editing";
  const DEFAULT_COLUMNS = 12;
  const MIN_FULL_ZONE_COLUMN_WIDTH = 112;
  const PAGE_PADDING = 64;
  const DEFAULT_BLOCKS = [
    { id: "dateTime", type: "dateTime", title: "Date & Time", enabled: true, column: 1, row: 1, width: 4, height: 2 },
    { id: "search", type: "search", title: "Search", enabled: true, column: 5, row: 1, width: 5, height: 2 },
    { id: "ip", type: "ip", title: "IP", enabled: true, column: 10, row: 1, width: 3, height: 2 },
    { id: "links", type: "links", title: "Links", enabled: true, column: 1, row: 3, width: 6, height: 4 },
    { id: "timer", type: "timer", title: "Timer", enabled: true, column: 7, row: 3, width: 2, height: 2 },
    { id: "stopwatch", type: "stopwatch", title: "Stopwatch", enabled: true, column: 9, row: 3, width: 2, height: 2 },
    { id: "pomodoro", type: "pomodoro", title: "Pomodoro", enabled: true, column: 11, row: 3, width: 2, height: 2 },
    { id: "note", type: "note", title: "Scratchpad", enabled: true, column: 7, row: 5, width: 3, height: 3 },
    { id: "localTasks", type: "localTasks", title: "Local Tasks", enabled: true, column: 10, row: 5, width: 3, height: 3 },
    { id: "startPinned", type: "startPinned", title: "Start Tab Pinned", enabled: true, column: 1, row: 7, width: 3, height: 2 },
    { id: "commands", type: "commands", title: "Commands", enabled: true, column: 4, row: 7, width: 3, height: 2 },
    { id: "recent", type: "recent", title: "Recent History", enabled: true, column: 7, row: 7, width: 3, height: 2 },
    { id: "stats", type: "stats", title: "Focus Stats", enabled: true, column: 10, row: 7, width: 3, height: 2 },
    { id: "browserPinned", type: "browserPinned", title: "Browser Pinned", enabled: false, column: 1, row: 9, width: 3, height: 2 },
    { id: "googleCalendar", type: "googleCalendar", title: "Google Calendar", enabled: false, column: 4, row: 9, width: 3, height: 2 },
    { id: "weather", type: "weather", title: "Weather", enabled: false, column: 7, row: 9, width: 3, height: 2 },
  ];

  let settings = null;
  let editing = false;
  let dragState = null;

  function t(key, fallback) {
    return chrome.i18n.getMessage(key) || fallback || key;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }

  function ignoreEditorError() {
    // Layout editor is progressive UI; storage/runtime failures should not break Start Tab.
  }

  function runEditorAction(action) {
    try {
      void Promise.resolve(action()).catch(ignoreEditorError);
    } catch {
      ignoreEditorError();
    }
  }

  function blockType(block, fallback) {
    return typeof block.type === "string" && block.type ? block.type : fallback.type;
  }

  function uniqueBlockId(id, type, seenIds) {
    const base = typeof id === "string" && id.trim() ? id.trim() : type;
    if (!seenIds.has(base)) return base;

    let suffix = 2;
    let candidate = `${base}-${suffix}`;
    while (seenIds.has(candidate)) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }

  function normalizeLayoutBlocks(blocks) {
    const seenIds = new Set();
    return blocks.map((block, index) => {
      const fallback = DEFAULT_BLOCKS[index] || DEFAULT_BLOCKS[0];
      const source = isRecord(block) ? block : fallback;
      const type = blockType(source, fallback);
      const normalized = {
        ...source,
        id: uniqueBlockId(source.id, type, seenIds),
        type,
      };
      seenIds.add(normalized.id);
      return normalized;
    });
  }

  function normalizeSettings(value) {
    const layout = value?.layout && typeof value.layout === "object" ? value.layout : {};
    const blocks = Array.isArray(layout.blocks) && layout.blocks.length > 0 ? layout.blocks : DEFAULT_BLOCKS;
    return {
      ...(value && typeof value === "object" ? value : {}),
      layout: {
        columns: Number.isFinite(layout.columns) ? Math.max(1, Math.round(layout.columns)) : DEFAULT_COLUMNS,
        profile: typeof layout.profile === "string" ? layout.profile : "custom",
        mode: layout.mode === "free" ? "free" : "grid",
        zone: layout.zone === "full" ? "full" : "contained",
        showBlockTitles: layout.showBlockTitles !== false,
        blocks: normalizeLayoutBlocks(blocks),
      },
    };
  }

  async function readSettings() {
    const items = await chrome.storage.local.get(SETTINGS_KEY);
    settings = normalizeSettings(items[SETTINGS_KEY]);
    return settings;
  }

  async function saveSettings(next) {
    settings = normalizeSettings(next);
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  }

  async function patchLayout(patch) {
    const current = normalizeSettings((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]);
    await saveSettings({
      ...current,
      layout: {
        ...current.layout,
        ...patch,
      },
    });
    applyLayout();
    renderToolbar();
  }

  function grid() {
    return document.getElementById("grid");
  }

  function viewportWidth() {
    return Math.max(320, document.documentElement.clientWidth - PAGE_PADDING);
  }

  function viewportHeight() {
    return Math.max(320, document.documentElement.clientHeight - PAGE_PADDING);
  }

  function enabledBlocks() {
    return settings.layout.blocks.filter((block) => block.enabled);
  }

  function blockById(id) {
    return settings.layout.blocks.find((block) => block.id === id) || null;
  }

  function cardForBlock(id) {
    return document.querySelector(`.card[data-block-id="${CSS.escape(id)}"]`);
  }

  function clearEditorArtifacts(card) {
    card.querySelectorAll(".layout-resize-handle, .layout-block-settings").forEach((element) => element.remove());
  }

  function assignCards() {
    const cards = Array.from(document.querySelectorAll(".card"));
    const blocks = enabledBlocks();
    cards.forEach((card, index) => {
      const block = blocks[index];
      if (!block) return;
      card.dataset.blockId = block.id;
      clearEditorArtifacts(card);
      const settingsButton = document.createElement("button");
      settingsButton.className = "layout-block-settings";
      settingsButton.type = "button";
      settingsButton.textContent = "⚙";
      settingsButton.title = t("blockSettings", "Block settings");
      settingsButton.setAttribute("aria-label", settingsButton.title);
      settingsButton.addEventListener("click", (event) => {
        event.stopPropagation();
        runEditorAction(() => openBlockSettings(block));
      });
      const handle = document.createElement("span");
      handle.className = "layout-resize-handle";
      handle.title = t("resizeBlock", "Resize block");
      card.append(settingsButton, handle);
    });
  }

  async function openBlockSettings(block) {
    await chrome.storage.local.set({
      startTabSettingsFocus: {
        blockId: block.id,
        blockType: block.type,
        createdAt: new Date().toISOString(),
      },
    });
    chrome.runtime.openOptionsPage();
  }

  function resetCardInlineStyles(card) {
    card.style.position = "";
    card.style.left = "";
    card.style.top = "";
    card.style.width = "";
    card.style.height = "";
    card.style.gridColumn = "";
    card.style.gridRow = "";
  }

  function gridMetrics() {
    const container = grid();
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const styles = getComputedStyle(container);
    const columns = settings.layout.columns || DEFAULT_COLUMNS;
    const columnGap = parseFloat(styles.columnGap || "0") || 0;
    const rowGap = parseFloat(styles.rowGap || "0") || 0;
    const rowHeight = parseFloat(styles.gridAutoRows || "86") || 86;
    const columnWidth = (rect.width - columnGap * Math.max(0, columns - 1)) / columns;
    return { rect, columns, columnGap, rowGap, rowHeight, columnWidth };
  }

  function applyGridCard(card, block) {
    resetCardInlineStyles(card);
    card.style.gridColumn = `${block.column} / span ${block.width}`;
    card.style.gridRow = `${block.row} / span ${block.height}`;
  }

  function freeRectFromGrid(block, metrics) {
    const left = (block.column - 1) * (metrics.columnWidth + metrics.columnGap);
    const top = (block.row - 1) * (metrics.rowHeight + metrics.rowGap);
    const width = block.width * metrics.columnWidth + Math.max(0, block.width - 1) * metrics.columnGap;
    const height = block.height * metrics.rowHeight + Math.max(0, block.height - 1) * metrics.rowGap;
    return { x: left, y: top, width, height };
  }

  function applyFreeCard(card, block, metrics) {
    const free = block.free && typeof block.free === "object" ? block.free : freeRectFromGrid(block, metrics);
    card.style.position = "absolute";
    card.style.left = `${Math.max(0, Number(free.x) || 0)}px`;
    card.style.top = `${Math.max(0, Number(free.y) || 0)}px`;
    card.style.width = `${Math.max(160, Number(free.width) || 260)}px`;
    card.style.height = `${Math.max(120, Number(free.height) || 180)}px`;
    card.style.gridColumn = "";
    card.style.gridRow = "";
  }

  function applyLayout() {
    if (!settings) return;
    const container = grid();
    if (!container) return;
    assignCards();
    document.body.classList.toggle("hide-block-titles", settings.layout.showBlockTitles === false);
    document.body.classList.toggle("layout-mode-free", settings.layout.mode === "free");
    document.body.classList.toggle("layout-mode-grid", settings.layout.mode !== "free");
    document.body.classList.toggle("layout-zone-full", settings.layout.zone === "full");
    document.body.classList.toggle("layout-zone-contained", settings.layout.zone !== "full");
    document.body.classList.toggle(EDITING_CLASS, editing);
    container.style.setProperty("--grid-columns", String(settings.layout.columns || DEFAULT_COLUMNS));

    const metrics = gridMetrics();
    for (const block of enabledBlocks()) {
      const card = cardForBlock(block.id);
      if (!card || !metrics) continue;
      if (settings.layout.mode === "free") applyFreeCard(card, block, metrics);
      else applyGridCard(card, block);
    }

    if (settings.layout.mode === "free") {
      syncFreeCanvasSize();
    } else {
      syncGridCanvasSize();
    }
  }

  function gridBounds() {
    return enabledBlocks().reduce((bounds, block) => ({
      columns: Math.max(bounds.columns, block.column + block.width - 1),
      rows: Math.max(bounds.rows, block.row + block.height - 1),
    }), { columns: settings.layout.columns || DEFAULT_COLUMNS, rows: 1 });
  }

  function syncGridCanvasSize() {
    const container = grid();
    if (!container) return;
    const metrics = gridMetrics();
    if (!metrics) return;
    const bounds = gridBounds();
    const minHeight = Math.max(
      viewportHeight(),
      bounds.rows * metrics.rowHeight + Math.max(0, bounds.rows - 1) * metrics.rowGap + 32,
    );
    container.style.minHeight = `${minHeight}px`;

    if (settings.layout.zone === "full") {
      const overflowColumns = Math.max(0, bounds.columns - DEFAULT_COLUMNS);
      const minWidth = viewportWidth() + overflowColumns * (MIN_FULL_ZONE_COLUMN_WIDTH + metrics.columnGap);
      container.style.minWidth = `${minWidth}px`;
    } else {
      container.style.minWidth = "";
    }
  }

  function syncFreeCanvasSize() {
    const container = grid();
    if (!container) return;
    const cards = Array.from(container.querySelectorAll(".card"));
    const max = cards.reduce((bounds, card) => {
      const left = parseFloat(card.style.left || "0") || 0;
      const top = parseFloat(card.style.top || "0") || 0;
      const width = parseFloat(card.style.width || "0") || card.getBoundingClientRect().width;
      const height = parseFloat(card.style.height || "0") || card.getBoundingClientRect().height;
      return {
        right: Math.max(bounds.right, left + width + 32),
        bottom: Math.max(bounds.bottom, top + height + 32),
      };
    }, { right: viewportWidth(), bottom: viewportHeight() });

    container.style.minHeight = `${max.bottom}px`;
    container.style.minWidth = settings.layout.zone === "full" ? `${max.right}px` : "";
  }

  function iconButton(id, label, text) {
    let button = document.getElementById(id);
    if (!button) {
      button = document.createElement("button");
      button.id = id;
      button.className = "layout-edit-button";
      button.type = "button";
      document.body.append(button);
    }
    button.textContent = text;
    button.title = label;
    button.setAttribute("aria-label", label);
    return button;
  }

  function installEditButton() {
    const button = iconButton("layoutEditButton", t("editLayout", "Edit layout"), "✎");
    button.addEventListener("click", () => {
      editing = !editing;
      applyLayout();
      renderToolbar();
    });
  }

  function toolbarButton(label, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "layout-toolbar__button";
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function toolbarSelect(labelText, value, options, onChange) {
    const wrapper = document.createElement("label");
    wrapper.className = "layout-toolbar__field";
    wrapper.append(document.createTextNode(labelText));
    const select = document.createElement("select");
    for (const [optionValue, optionLabel] of options) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionLabel;
      select.append(option);
    }
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    wrapper.append(select);
    return wrapper;
  }

  function renderToolbar() {
    document.getElementById("layoutToolbar")?.remove();
    if (!editing || !settings) return;

    const toolbar = document.createElement("aside");
    toolbar.id = "layoutToolbar";
    toolbar.className = "layout-toolbar";

    const title = document.createElement("h2");
    title.textContent = t("layoutEditor", "Layout editor");

    const modeLabel = toolbarSelect(
      t("layoutMode", "Layout mode"),
      settings.layout.mode,
      [
        ["grid", t("layoutModeGrid", "Grid")],
        ["free", t("layoutModeFree", "Free")],
      ],
      (mode) => runEditorAction(() => patchLayout({ mode })),
    );

    const zoneLabel = toolbarSelect(
      t("layoutZone", "Layout zone"),
      settings.layout.zone,
      [
        ["contained", t("layoutZoneContained", "Contained")],
        ["full", t("layoutZoneFull", "Full viewport")],
      ],
      (zone) => runEditorAction(() => patchLayout({ zone })),
    );

    const titleToggle = document.createElement("label");
    titleToggle.className = "layout-toolbar__check";
    const titleCheckbox = document.createElement("input");
    titleCheckbox.type = "checkbox";
    titleCheckbox.checked = settings.layout.showBlockTitles !== false;
    titleCheckbox.addEventListener("change", () => runEditorAction(() => patchLayout({ showBlockTitles: titleCheckbox.checked })));
    titleToggle.append(titleCheckbox, document.createTextNode(t("showBlockTitles", "Show block titles")));

    const blocks = document.createElement("div");
    blocks.className = "layout-toolbar__blocks";
    for (const block of settings.layout.blocks) {
      const label = document.createElement("label");
      label.className = "layout-toolbar__check";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = block.enabled;
      checkbox.addEventListener("change", () => runEditorAction(() => toggleBlock(block.id, checkbox.checked)));
      label.append(checkbox, document.createTextNode(block.title));
      blocks.append(label);
    }

    toolbar.append(
      title,
      modeLabel,
      zoneLabel,
      titleToggle,
      blocks,
      toolbarButton(t("doneEditing", "Done"), () => {
        editing = false;
        applyLayout();
        renderToolbar();
      }),
    );
    document.body.append(toolbar);
  }

  async function toggleBlock(id, enabled) {
    const current = normalizeSettings((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]);
    const blocks = current.layout.blocks.map((block) => block.id === id ? { ...block, enabled } : block);
    await saveSettings({ ...current, layout: { ...current.layout, blocks } });
    location.reload();
  }

  function blockPatch(id, patch, layoutPatch = {}) {
    const blocks = settings.layout.blocks.map((block) => block.id === id ? { ...block, ...patch } : block);
    return { ...settings, layout: { ...settings.layout, ...layoutPatch, profile: "custom", blocks } };
  }

  async function saveBlock(id, patch) {
    const { columns, ...blockPatchValue } = patch;
    const layoutPatch = Number.isFinite(columns) ? { columns: Math.max(1, Math.round(columns)) } : {};
    await saveSettings(blockPatch(id, blockPatchValue, layoutPatch));
    applyLayout();
  }

  function pointerBlock(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return null;
    if (target.closest("button, input, select, textarea, a")) return null;
    const card = target.closest(".card");
    if (!(card instanceof HTMLElement)) return null;
    const id = card.dataset.blockId;
    const block = id ? blockById(id) : null;
    return block ? { card, block } : null;
  }

  function startPointer(event) {
    if (!editing || !settings) return;
    const target = event.target;
    const resizing = target instanceof HTMLElement && target.classList.contains("layout-resize-handle");
    const match = pointerBlock(event);
    if (!match) return;
    event.preventDefault();
    match.card.setPointerCapture(event.pointerId);
    const rect = match.card.getBoundingClientRect();
    dragState = {
      id: match.block.id,
      pointerId: event.pointerId,
      resizing,
      startX: event.clientX,
      startY: event.clientY,
      cardRect: rect,
      block: clone(match.block),
    };
    match.card.classList.add("card--editing-active");
  }

  function movePointer(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const card = cardForBlock(dragState.id);
    if (!card) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;

    if (settings.layout.mode === "free") {
      if (dragState.resizing) {
        card.style.width = `${Math.max(160, dragState.cardRect.width + dx)}px`;
        card.style.height = `${Math.max(120, dragState.cardRect.height + dy)}px`;
      } else {
        card.style.left = `${Math.max(0, parseFloat(card.style.left || "0") + dx)}px`;
        card.style.top = `${Math.max(0, parseFloat(card.style.top || "0") + dy)}px`;
        dragState.startX = event.clientX;
        dragState.startY = event.clientY;
      }
      syncFreeCanvasSize();
      return;
    }

    card.style.transform = dragState.resizing ? "" : `translate(${dx}px, ${dy}px)`;
  }

  function expandableColumns(requiredColumns, metrics) {
    if (settings.layout.zone !== "full") return metrics.columns;
    return Math.max(metrics.columns, requiredColumns);
  }

  function gridPatchFromPointer(event) {
    const metrics = gridMetrics();
    if (!metrics || !dragState) return null;
    const block = dragState.block;
    const left = dragState.cardRect.left - metrics.rect.left + (dragState.resizing ? 0 : event.clientX - dragState.startX);
    const top = dragState.cardRect.top - metrics.rect.top + (dragState.resizing ? 0 : event.clientY - dragState.startY);
    const rawColumn = Math.round(left / (metrics.columnWidth + metrics.columnGap)) + 1;
    const column = Math.max(1, settings.layout.zone === "full" ? rawColumn : Math.min(metrics.columns, rawColumn));
    const row = Math.max(1, Math.round(top / (metrics.rowHeight + metrics.rowGap)) + 1);

    if (!dragState.resizing) {
      const nextColumns = expandableColumns(column + block.width - 1, metrics);
      return {
        column: Math.min(column, Math.max(1, nextColumns - block.width + 1)),
        row,
        ...(nextColumns !== metrics.columns ? { columns: nextColumns } : {}),
      };
    }

    const widthPx = Math.max(metrics.columnWidth, dragState.cardRect.width + event.clientX - dragState.startX);
    const heightPx = Math.max(metrics.rowHeight, dragState.cardRect.height + event.clientY - dragState.startY);
    const rawWidth = Math.max(1, Math.round(widthPx / (metrics.columnWidth + metrics.columnGap)));
    const nextColumns = expandableColumns(block.column + rawWidth - 1, metrics);
    const width = settings.layout.zone === "full"
      ? rawWidth
      : Math.max(1, Math.min(metrics.columns - block.column + 1, rawWidth));
    const height = Math.max(1, Math.round(heightPx / (metrics.rowHeight + metrics.rowGap)));
    return {
      width,
      height,
      ...(nextColumns !== metrics.columns ? { columns: nextColumns } : {}),
    };
  }

  function freePatchFromCard(card) {
    return {
      free: {
        x: Math.max(0, Math.round(parseFloat(card.style.left || "0") || 0)),
        y: Math.max(0, Math.round(parseFloat(card.style.top || "0") || 0)),
        width: Math.max(160, Math.round(parseFloat(card.style.width || "0") || card.getBoundingClientRect().width)),
        height: Math.max(120, Math.round(parseFloat(card.style.height || "0") || card.getBoundingClientRect().height)),
      },
    };
  }

  function endPointer(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const card = cardForBlock(dragState.id);
    if (!card) return;
    card.classList.remove("card--editing-active");
    card.style.transform = "";
    const patch = settings.layout.mode === "free" ? freePatchFromCard(card) : gridPatchFromPointer(event);
    const id = dragState.id;
    dragState = null;
    if (patch) runEditorAction(() => saveBlock(id, patch));
  }

  function installPointerHandlers() {
    document.addEventListener("pointerdown", startPointer);
    document.addEventListener("pointermove", movePointer);
    document.addEventListener("pointerup", endPointer);
    document.addEventListener("pointercancel", endPointer);
  }

  function installRenderObserver() {
    const container = grid();
    if (!container) return;
    const observer = new MutationObserver(() => applyLayout());
    observer.observe(container, { childList: true });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
    settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    applyLayout();
    renderToolbar();
  });

  runEditorAction(async () => {
    await readSettings();
    installEditButton();
    installPointerHandlers();
    installRenderObserver();
    window.setTimeout(applyLayout, 0);
    window.setTimeout(applyLayout, 250);
    window.addEventListener("resize", applyLayout);
  });
})();
