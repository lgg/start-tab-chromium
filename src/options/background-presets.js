(() => {
  const STORAGE_KEY = "startPageSettings";
  const MAX_PRESETS = 80;
  const MAX_IMAGE_SIZE = 1920;
  const EFFECTS = ["none", "gradient", "aurora", "mesh", "spotlight", "noise"];
  const TYPES = ["color", "gradient", "effect", "image"];
  const BUILT_IN_IDS = new Set(["aurora-default", "black", "animated-gradient", "mesh", "spotlight", "noise"]);

  const strings = {
    backgroundPresetManager: "Background presets",
    backgroundPresetDescription: "Choose a saved background tile, add colors, effects, gradients, or images, and mark favorites to keep them at the top.",
    backgroundPresetFavorites: "Favorites",
    backgroundPresetAll: "All backgrounds",
    backgroundPresetAdd: "Add background",
    backgroundPresetTitle: "Title",
    backgroundPresetType: "Type",
    backgroundPresetTypeColor: "Static color",
    backgroundPresetTypeGradient: "Custom gradient",
    backgroundPresetTypeEffect: "Built-in effect",
    backgroundPresetTypeImage: "Image",
    backgroundPresetPrimaryColor: "Primary color",
    backgroundPresetSecondColor: "Second color",
    backgroundPresetThirdColor: "Third color",
    backgroundPresetImageUrl: "Image URL",
    backgroundPresetImageFile: "Upload image",
    backgroundPresetEffect: "Effect",
    backgroundPresetSave: "Save background",
    backgroundPresetLike: "Like",
    backgroundPresetUnlike: "Unlike",
    backgroundPresetRemove: "Remove",
    backgroundPresetActive: "Active",
    backgroundPresetCurrent: "Current background",
    backgroundPresetImageMissing: "Choose an image file or paste an image URL first.",
  };

  const defaultPresets = [
    preset("aurora-default", "Aurora", "effect", "#08111f", "", "aurora", true),
    preset("black", "Black", "color", "#000000", "", "none"),
    preset("animated-gradient", "Animated gradient", "effect", "#0f172a", "", "gradient"),
    preset("mesh", "Mesh", "effect", "#08111f", "", "mesh"),
    preset("spotlight", "Spotlight", "effect", "#08111f", "", "spotlight"),
    preset("noise", "Noise", "effect", "#101827", "", "noise"),
  ];

  let observer;
  let renderTimer = 0;

  function preset(id, title, type, backgroundColor, backgroundImage, backgroundEffect, liked = false) {
    return {
      id,
      title,
      type,
      liked,
      createdAt: "2026-01-01T00:00:00.000Z",
      backgroundColor,
      backgroundImage,
      backgroundEffect,
    };
  }

  function t(key) {
    return chrome.i18n?.getMessage(key) || strings[key] || key;
  }

  function typeTitle(type) {
    const suffix = `${type[0]?.toUpperCase() || ""}${type.slice(1)}`;
    return t(`backgroundPresetType${suffix}`);
  }

  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }

  function stringValue(value, fallback) {
    return typeof value === "string" ? value : fallback;
  }

  function boolValue(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  function oneOf(value, allowed, fallback) {
    return typeof value === "string" && allowed.includes(value) ? value : fallback;
  }

  function colorValue(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : fallback;
  }

  function normalizePreset(value, fallback = defaultPresets[0]) {
    const record = isRecord(value) ? value : {};
    return {
      id: stringValue(record.id, fallback.id),
      title: stringValue(record.title, fallback.title),
      type: oneOf(record.type, TYPES, fallback.type),
      liked: boolValue(record.liked, fallback.liked),
      createdAt: stringValue(record.createdAt, fallback.createdAt),
      backgroundColor: colorValue(record.backgroundColor, fallback.backgroundColor),
      backgroundImage: stringValue(record.backgroundImage, fallback.backgroundImage),
      backgroundEffect: oneOf(record.backgroundEffect, EFFECTS, fallback.backgroundEffect),
      gradientColors: Array.isArray(record.gradientColors)
        ? record.gradientColors.map((item) => colorValue(item, "#000000")).slice(0, 5)
        : undefined,
    };
  }

  async function readSettings() {
    const items = await chrome.storage.local.get(STORAGE_KEY);
    return isRecord(items[STORAGE_KEY]) ? items[STORAGE_KEY] : {};
  }

  async function writeSettings(settings) {
    await chrome.storage.local.set({ [STORAGE_KEY]: settings });
  }

  function normalize(settings, fallbackPresets = []) {
    const appearance = isRecord(settings.appearance) ? settings.appearance : {};
    const byId = new Map(defaultPresets.map((item) => [item.id, { ...item }]));

    for (const source of [fallbackPresets, appearance.backgroundPresets]) {
      if (!Array.isArray(source)) continue;
      for (const item of source) {
        const normalized = normalizePreset(item);
        if (normalized.id) byId.set(normalized.id, normalized);
      }
    }

    let presets = [...byId.values()].slice(0, MAX_PRESETS);
    const current = {
      backgroundColor: stringValue(appearance.backgroundColor, "#08111f"),
      backgroundImage: stringValue(appearance.backgroundImage, ""),
      backgroundEffect: oneOf(appearance.backgroundEffect, EFFECTS, "aurora"),
    };
    const storedActiveId = stringValue(appearance.activeBackgroundPresetId, "");
    const storedActive = presets.find((item) => item.id === storedActiveId);
    const matchingCurrent = presets.find((item) => sameBackground(item, current));

    if (storedActive && sameBackground(storedActive, current)) {
      return { appearance, presets, activeId: storedActive.id };
    }

    if (matchingCurrent) {
      return { appearance, presets, activeId: matchingCurrent.id };
    }

    const currentPreset = {
      id: "current-background",
      title: t("backgroundPresetCurrent"),
      type: current.backgroundImage ? "image" : current.backgroundEffect === "none" ? "color" : "effect",
      liked: false,
      createdAt: new Date().toISOString(),
      ...current,
    };
    presets = [currentPreset, ...presets.filter((item) => item.id !== currentPreset.id)].slice(0, MAX_PRESETS);
    return { appearance, presets, activeId: currentPreset.id };
  }

  function sameBackground(left, right) {
    return left.backgroundColor === right.backgroundColor
      && left.backgroundImage === right.backgroundImage
      && left.backgroundEffect === right.backgroundEffect;
  }

  function activePreset(model) {
    return model.presets.find((item) => item.id === model.activeId) || model.presets[0];
  }

  function cssUrl(value) {
    return `url("${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}")`;
  }

  function updateFormControls(presetValue) {
    const backgroundColor = document.getElementById("backgroundColor");
    const backgroundImage = document.getElementById("backgroundImage");
    const backgroundEffect = document.getElementById("backgroundEffect");
    if (backgroundColor instanceof HTMLInputElement) backgroundColor.value = presetValue.backgroundColor;
    if (backgroundImage instanceof HTMLInputElement) {
      backgroundImage.type = "text";
      backgroundImage.value = presetValue.backgroundImage;
    }
    if (backgroundEffect instanceof HTMLSelectElement) backgroundEffect.value = presetValue.backgroundEffect;
  }

  async function persistAppearance(presetValue, presets) {
    const settings = await readSettings();
    const appearance = isRecord(settings.appearance) ? settings.appearance : {};
    await writeSettings({
      ...settings,
      appearance: {
        ...appearance,
        backgroundColor: presetValue.backgroundColor,
        backgroundImage: presetValue.backgroundImage,
        backgroundEffect: presetValue.backgroundEffect,
        activeBackgroundPresetId: presetValue.id,
        backgroundPresets: presets,
      },
    });
    updateFormControls(presetValue);
  }

  async function selectPreset(id) {
    const model = normalize(await readSettings());
    const selected = model.presets.find((item) => item.id === id);
    if (!selected) return;
    await persistAppearance(selected, model.presets);
    scheduleRender();
  }

  async function toggleLike(id) {
    const model = normalize(await readSettings());
    const presets = model.presets.map((item) => item.id === id ? { ...item, liked: !item.liked } : item);
    const active = presets.find((item) => item.id === model.activeId) || presets[0];
    if (!active) return;
    await persistAppearance(active, presets);
    scheduleRender();
  }

  async function removePreset(id) {
    if (BUILT_IN_IDS.has(id)) return;
    const model = normalize(await readSettings());
    const presets = model.presets.filter((item) => item.id !== id);
    const active = id === model.activeId ? presets[0] : presets.find((item) => item.id === model.activeId) || presets[0];
    if (!active) return;
    await persistAppearance(active, presets);
    scheduleRender();
  }

  function tile(presetValue, activeId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = presetValue.id === activeId ? "background-tile background-tile--active" : "background-tile";

    const preview = document.createElement("span");
    preview.className = `background-tile__preview background-tile__preview--${presetValue.backgroundEffect}`;
    preview.style.backgroundColor = presetValue.backgroundColor;
    if (presetValue.backgroundImage) preview.style.backgroundImage = cssUrl(presetValue.backgroundImage);

    const title = document.createElement("span");
    title.className = "background-tile__title";
    title.textContent = presetValue.title;

    const meta = document.createElement("span");
    meta.className = "background-tile__meta";
    meta.textContent = presetValue.id === activeId ? t("backgroundPresetActive") : presetValue.type;

    const actions = document.createElement("span");
    actions.className = "background-tile__actions";
    actions.append(action("like", presetValue.liked ? t("backgroundPresetUnlike") : t("backgroundPresetLike"), presetValue.liked));
    if (!BUILT_IN_IDS.has(presetValue.id)) actions.append(action("remove", t("backgroundPresetRemove")));

    button.append(preview, title, meta, actions);
    button.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const actionName = target?.dataset.action;
      if (actionName === "like") {
        event.stopPropagation();
        void toggleLike(presetValue.id);
        return;
      }
      if (actionName === "remove") {
        event.stopPropagation();
        void removePreset(presetValue.id);
        return;
      }
      void selectPreset(presetValue.id);
    });
    return button;
  }

  function action(name, label, active = false) {
    const element = document.createElement("span");
    element.className = active ? "background-tile__action background-tile__action--liked" : "background-tile__action";
    element.dataset.action = name;
    element.textContent = label;
    return element;
  }

  function tileGroup(title, presets, activeId) {
    const group = document.createElement("div");
    group.className = "background-preset-group";
    const heading = document.createElement("h3");
    heading.textContent = title;
    const grid = document.createElement("div");
    grid.className = "background-preset-grid";
    for (const item of presets) grid.append(tile(item, activeId));
    group.append(heading, grid);
    return group;
  }

  function createForm() {
    const wrapper = document.createElement("details");
    wrapper.className = "background-preset-add";
    const summary = document.createElement("summary");
    summary.textContent = `+ ${t("backgroundPresetAdd")}`;
    const form = document.createElement("div");
    form.className = "background-preset-form";
    form.append(
      labeledInput("presetTitle", t("backgroundPresetTitle"), "text", ""),
      labeledSelect("presetType", t("backgroundPresetType"), [
        ["color", t("backgroundPresetTypeColor")],
        ["gradient", t("backgroundPresetTypeGradient")],
        ["effect", t("backgroundPresetTypeEffect")],
        ["image", t("backgroundPresetTypeImage")],
      ]),
      labeledInput("presetColorA", t("backgroundPresetPrimaryColor"), "color", "#08111f"),
      labeledInput("presetColorB", t("backgroundPresetSecondColor"), "color", "#1e3a8a"),
      labeledInput("presetColorC", t("backgroundPresetThirdColor"), "color", "#0f766e"),
      labeledSelect("presetEffect", t("backgroundPresetEffect"), [
        ["aurora", chrome.i18n?.getMessage("effectAurora") || "Aurora"],
        ["gradient", chrome.i18n?.getMessage("effectGradient") || "Animated gradient"],
        ["mesh", chrome.i18n?.getMessage("effectMesh") || "Mesh"],
        ["spotlight", chrome.i18n?.getMessage("effectSpotlight") || "Spotlight"],
        ["noise", chrome.i18n?.getMessage("effectNoise") || "Noise"],
      ]),
      labeledInput("presetImageUrl", t("backgroundPresetImageUrl"), "text", ""),
      labeledInput("presetImageFile", t("backgroundPresetImageFile"), "file", ""),
    );
    const save = document.createElement("button");
    save.className = "button";
    save.type = "button";
    save.textContent = t("backgroundPresetSave");
    save.addEventListener("click", () => void addPreset(form));
    form.append(save);
    wrapper.append(summary, form);
    return wrapper;
  }

  function labeledInput(id, labelText, type, value) {
    const label = document.createElement("label");
    label.className = "field";
    const span = document.createElement("span");
    span.textContent = labelText;
    const input = document.createElement("input");
    input.id = id;
    input.type = type;
    if (type === "file") input.accept = "image/*";
    else input.value = value;
    label.append(span, input);
    return label;
  }

  function labeledSelect(id, labelText, options) {
    const label = document.createElement("label");
    label.className = "field";
    const span = document.createElement("span");
    span.textContent = labelText;
    const select = document.createElement("select");
    select.id = id;
    for (const [value, labelTextValue] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = labelTextValue;
      select.append(option);
    }
    label.append(span, select);
    return label;
  }

  async function addPreset(form) {
    const type = oneOf(form.querySelector("#presetType")?.value, TYPES, "color");
    const title = form.querySelector("#presetTitle")?.value.trim() || typeTitle(type);
    const colorA = colorValue(form.querySelector("#presetColorA")?.value, "#08111f");
    const colorB = colorValue(form.querySelector("#presetColorB")?.value, "#1e3a8a");
    const colorC = colorValue(form.querySelector("#presetColorC")?.value, "#0f766e");
    const effect = oneOf(form.querySelector("#presetEffect")?.value, EFFECTS, "aurora");
    const imageUrl = form.querySelector("#presetImageUrl")?.value.trim() || "";
    const imageFile = form.querySelector("#presetImageFile")?.files?.[0];

    const next = {
      id: `background-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title,
      type,
      liked: false,
      createdAt: new Date().toISOString(),
      backgroundColor: colorA,
      backgroundImage: "",
      backgroundEffect: "none",
    };

    if (type === "gradient") {
      next.gradientColors = [colorA, colorB, colorC];
      next.backgroundImage = gradientDataUri(next.gradientColors);
    } else if (type === "effect") {
      next.backgroundEffect = effect;
    } else if (type === "image") {
      if (!imageFile && !imageUrl) {
        setStatus(t("backgroundPresetImageMissing"));
        return;
      }
      next.backgroundImage = imageFile ? await imageFileToDataUrl(imageFile) : imageUrl;
    }

    const model = normalize(await readSettings());
    const presets = [next, ...model.presets.filter((item) => item.id !== next.id)].slice(0, MAX_PRESETS);
    await persistAppearance(next, presets);
    scheduleRender();
  }

  function setStatus(message) {
    const status = document.getElementById("status");
    if (status) status.textContent = message;
  }

  function gradientDataUri(colors) {
    const stops = colors.map((color, index) => {
      const offset = colors.length === 1 ? 0 : Math.round((index / (colors.length - 1)) * 100);
      return `<stop offset="${offset}%" stop-color="${color}"/>`;
    }).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient></defs><rect width="1600" height="1000" fill="url(#g)"/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Unable to read image file"));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Unable to load image file"));
      image.src = src;
    });
  }

  async function imageFileToDataUrl(file) {
    const dataUrl = await readFileAsDataUrl(file);
    if (file.type === "image/svg+xml" || file.type === "image/gif") return dataUrl;
    const image = await loadImage(dataUrl);
    const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.86);
  }

  async function renderManager() {
    window.clearTimeout(renderTimer);
    const backgroundEffect = document.getElementById("backgroundEffect");
    const backgroundImage = document.getElementById("backgroundImage");
    if (backgroundImage instanceof HTMLInputElement) backgroundImage.type = "text";
    if (!(backgroundEffect instanceof HTMLElement)) return;

    observer?.disconnect();
    try {
      let manager = document.getElementById("backgroundPresetManager");
      if (!manager) {
        manager = document.createElement("div");
        manager.id = "backgroundPresetManager";
        manager.className = "background-preset-manager field--wide";
        const anchor = backgroundEffect.closest(".field") || backgroundEffect;
        anchor.insertAdjacentElement("afterend", manager);
      }

      const settings = await readSettings();
      const model = normalize(settings);
      const active = activePreset(model);
      if (!active) return;
      updateFormControls(active);
      const storedPresets = Array.isArray(model.appearance.backgroundPresets) ? model.appearance.backgroundPresets : [];
      const storedActive = storedPresets.map((item) => normalizePreset(item)).find((item) => item.id === model.activeId);
      const shouldPersist = !Array.isArray(model.appearance.backgroundPresets)
        || model.appearance.activeBackgroundPresetId !== model.activeId
        || !storedActive
        || !sameBackground(storedActive, active);
      if (shouldPersist) await persistAppearance(active, model.presets);

      manager.textContent = "";
      const heading = document.createElement("h3");
      heading.textContent = t("backgroundPresetManager");
      const description = document.createElement("p");
      description.textContent = t("backgroundPresetDescription");
      manager.append(heading, description);

      const favorites = model.presets.filter((item) => item.liked);
      if (favorites.length > 0) manager.append(tileGroup(t("backgroundPresetFavorites"), favorites, model.activeId));
      manager.append(tileGroup(t("backgroundPresetAll"), model.presets, model.activeId), createForm());
    } finally {
      observe();
    }
  }

  function preservePresetsAfterCoreSave() {
    void (async () => {
      const before = normalize(await readSettings());
      window.setTimeout(() => void restorePresetsAfterCoreSave(before), 700);
      window.setTimeout(() => void restorePresetsAfterCoreSave(before), 1800);
    })();
  }

  async function restorePresetsAfterCoreSave(before) {
    const settings = await readSettings();
    const appearance = isRecord(settings.appearance) ? settings.appearance : {};
    const model = normalize(
      { ...settings, appearance: { ...appearance, backgroundPresets: appearance.backgroundPresets || before.presets } },
      before.presets,
    );
    const active = activePreset(model);
    if (!active) return;
    await persistAppearance(active, model.presets);
    scheduleRender();
  }

  function scheduleRender() {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => void renderManager(), 80);
  }

  function observe() {
    if (!observer) return;
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  document.addEventListener("submit", (event) => {
    if (event.target instanceof HTMLFormElement && event.target.id === "form") preservePresetsAfterCoreSave();
  }, true);

  observer = new MutationObserver(() => {
    if (document.getElementById("backgroundEffect")) scheduleRender();
  });
  observe();
  window.addEventListener("DOMContentLoaded", scheduleRender);
  scheduleRender();
})();
