(() => {
  const STORAGE_KEY = "startPageSettings";
  const MAX_PRESETS = 80;
  const MAX_IMAGE_SIZE = 1920;
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
  };

  const defaultPresets = [
    {
      id: "aurora-default",
      title: "Aurora",
      type: "effect",
      liked: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      backgroundColor: "#08111f",
      backgroundImage: "",
      backgroundEffect: "aurora",
    },
    {
      id: "black",
      title: "Black",
      type: "color",
      liked: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      backgroundColor: "#000000",
      backgroundImage: "",
      backgroundEffect: "none",
    },
    {
      id: "animated-gradient",
      title: "Animated gradient",
      type: "effect",
      liked: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      backgroundColor: "#0f172a",
      backgroundImage: "",
      backgroundEffect: "gradient",
    },
    {
      id: "mesh",
      title: "Mesh",
      type: "effect",
      liked: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      backgroundColor: "#08111f",
      backgroundImage: "",
      backgroundEffect: "mesh",
    },
    {
      id: "spotlight",
      title: "Spotlight",
      type: "effect",
      liked: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      backgroundColor: "#08111f",
      backgroundImage: "",
      backgroundEffect: "spotlight",
    },
    {
      id: "noise",
      title: "Noise",
      type: "effect",
      liked: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      backgroundColor: "#101827",
      backgroundImage: "",
      backgroundEffect: "noise",
    },
  ];

  function t(key) {
    return chrome.i18n?.getMessage(key) || strings[key] || key;
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

  function sanitizeColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : fallback;
  }

  function presetFrom(value, fallback = defaultPresets[0]) {
    const record = isRecord(value) ? value : {};
    return {
      id: stringValue(record.id, fallback.id),
      title: stringValue(record.title, fallback.title),
      type: oneOf(record.type, ["color", "gradient", "effect", "image"], fallback.type),
      liked: boolValue(record.liked, fallback.liked),
      createdAt: stringValue(record.createdAt, fallback.createdAt),
      backgroundColor: sanitizeColor(record.backgroundColor, fallback.backgroundColor),
      backgroundImage: stringValue(record.backgroundImage, fallback.backgroundImage),
      backgroundEffect: oneOf(record.backgroundEffect, ["none", "gradient", "aurora", "mesh", "spotlight", "noise"], fallback.backgroundEffect),
      gradientColors: Array.isArray(record.gradientColors)
        ? record.gradientColors.map((item) => sanitizeColor(item, "#000000")).slice(0, 5)
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

  function normalize(settings) {
    const appearance = isRecord(settings.appearance) ? settings.appearance : {};
    const byId = new Map(defaultPresets.map((preset) => [preset.id, { ...preset }]));
    if (Array.isArray(appearance.backgroundPresets)) {
      for (const item of appearance.backgroundPresets) {
        const preset = presetFrom(item);
        if (preset.id) byId.set(preset.id, preset);
      }
    }

    let presets = [...byId.values()].slice(0, MAX_PRESETS);
    const current = {
      backgroundColor: stringValue(appearance.backgroundColor, "#08111f"),
      backgroundImage: stringValue(appearance.backgroundImage, ""),
      backgroundEffect: oneOf(appearance.backgroundEffect, ["none", "gradient", "aurora", "mesh", "spotlight", "noise"], "aurora"),
    };
    const activeBackgroundPresetId = stringValue(appearance.activeBackgroundPresetId, "");
    const activeExists = presets.some((preset) => preset.id === activeBackgroundPresetId);
    const matchingCurrent = presets.find((preset) => sameBackground(preset, current));

    if (!activeExists && !matchingCurrent) {
      const currentPreset = {
        id: "current-background",
        title: "Current background",
        type: current.backgroundImage ? "image" : current.backgroundEffect === "none" ? "color" : "effect",
        liked: false,
        createdAt: new Date().toISOString(),
        ...current,
      };
      presets = [currentPreset, ...presets].slice(0, MAX_PRESETS);
      return { appearance, presets, activeId: currentPreset.id };
    }

    return {
      appearance,
      presets,
      activeId: activeExists ? activeBackgroundPresetId : matchingCurrent?.id || "aurora-default",
    };
  }

  function sameBackground(left, right) {
    return left.backgroundColor === right.backgroundColor
      && left.backgroundImage === right.backgroundImage
      && left.backgroundEffect === right.backgroundEffect;
  }

  function updateFormControls(preset) {
    const backgroundColor = document.getElementById("backgroundColor");
    const backgroundImage = document.getElementById("backgroundImage");
    const backgroundEffect = document.getElementById("backgroundEffect");
    if (backgroundColor instanceof HTMLInputElement) backgroundColor.value = preset.backgroundColor;
    if (backgroundImage instanceof HTMLInputElement) {
      backgroundImage.type = "text";
      backgroundImage.value = preset.backgroundImage;
    }
    if (backgroundEffect instanceof HTMLSelectElement) backgroundEffect.value = preset.backgroundEffect;
  }

  async function persistAppearance(preset, presets) {
    const settings = await readSettings();
    const appearance = isRecord(settings.appearance) ? settings.appearance : {};
    const next = {
      ...settings,
      appearance: {
        ...appearance,
        backgroundColor: preset.backgroundColor,
        backgroundImage: preset.backgroundImage,
        backgroundEffect: preset.backgroundEffect,
        activeBackgroundPresetId: preset.id,
        backgroundPresets: presets,
      },
    };
    await writeSettings(next);
    updateFormControls(preset);
  }

  async function selectPreset(id) {
    const settings = await readSettings();
    const model = normalize(settings);
    const preset = model.presets.find((item) => item.id === id);
    if (!preset) return;
    await persistAppearance(preset, model.presets);
    await renderManager();
  }

  async function toggleLike(id) {
    const settings = await readSettings();
    const model = normalize(settings);
    const presets = model.presets.map((preset) => preset.id === id ? { ...preset, liked: !preset.liked } : preset);
    const active = presets.find((preset) => preset.id === model.activeId) || presets[0];
    await persistAppearance(active, presets);
    await renderManager();
  }

  async function removePreset(id) {
    if (BUILT_IN_IDS.has(id)) return;
    const settings = await readSettings();
    const model = normalize(settings);
    const presets = model.presets.filter((preset) => preset.id !== id);
    const active = id === model.activeId ? presets[0] : presets.find((preset) => preset.id === model.activeId) || presets[0];
    if (!active) return;
    await persistAppearance(active, presets);
    await renderManager();
  }

  function tile(preset, activeId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = preset.id === activeId ? "background-tile background-tile--active" : "background-tile";
    button.dataset.presetId = preset.id;

    const preview = document.createElement("span");
    preview.className = `background-tile__preview background-tile__preview--${preset.backgroundEffect}`;
    preview.style.backgroundColor = preset.backgroundColor;
    if (preset.backgroundImage) preview.style.backgroundImage = `url("${preset.backgroundImage}")`;

    const title = document.createElement("span");
    title.className = "background-tile__title";
    title.textContent = preset.title;

    const meta = document.createElement("span");
    meta.className = "background-tile__meta";
    meta.textContent = preset.id === activeId ? t("backgroundPresetActive") : preset.type;

    const actions = document.createElement("span");
    actions.className = "background-tile__actions";

    const like = document.createElement("span");
    like.className = preset.liked ? "background-tile__action background-tile__action--liked" : "background-tile__action";
    like.dataset.action = "like";
    like.textContent = preset.liked ? t("backgroundPresetUnlike") : t("backgroundPresetLike");
    actions.append(like);

    if (!BUILT_IN_IDS.has(preset.id)) {
      const remove = document.createElement("span");
      remove.className = "background-tile__action";
      remove.dataset.action = "remove";
      remove.textContent = t("backgroundPresetRemove");
      actions.append(remove);
    }

    button.append(preview, title, meta, actions);
    button.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const action = target?.dataset.action;
      if (action === "like") {
        event.stopPropagation();
        void toggleLike(preset.id);
        return;
      }
      if (action === "remove") {
        event.stopPropagation();
        void removePreset(preset.id);
        return;
      }
      void selectPreset(preset.id);
    });
    return button;
  }

  function tileGroup(title, presets, activeId) {
    const group = document.createElement("div");
    group.className = "background-preset-group";
    const heading = document.createElement("h3");
    heading.textContent = title;
    const grid = document.createElement("div");
    grid.className = "background-preset-grid";
    for (const preset of presets) grid.append(tile(preset, activeId));
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
    for (const [value, optionLabel] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = optionLabel;
      select.append(option);
    }
    label.append(span, select);
    return label;
  }

  async function addPreset(form) {
    const type = form.querySelector("#presetType")?.value || "color";
    const title = form.querySelector("#presetTitle")?.value.trim() || t(`backgroundPresetType${type[0].toUpperCase()}${type.slice(1)}`);
    const colorA = sanitizeColor(form.querySelector("#presetColorA")?.value, "#08111f");
    const colorB = sanitizeColor(form.querySelector("#presetColorB")?.value, "#1e3a8a");
    const colorC = sanitizeColor(form.querySelector("#presetColorC")?.value, "#0f766e");
    const effect = form.querySelector("#presetEffect")?.value || "aurora";
    const imageUrl = form.querySelector("#presetImageUrl")?.value.trim() || "";
    const imageFile = form.querySelector("#presetImageFile")?.files?.[0];

    const preset = {
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
      preset.gradientColors = [colorA, colorB, colorC];
      preset.backgroundImage = gradientDataUri(preset.gradientColors);
    } else if (type === "effect") {
      preset.backgroundEffect = effect;
    } else if (type === "image") {
      preset.backgroundImage = imageFile ? await imageFileToDataUrl(imageFile) : imageUrl;
    }

    const settings = await readSettings();
    const model = normalize(settings);
    const presets = [preset, ...model.presets.filter((item) => item.id !== preset.id)].slice(0, MAX_PRESETS);
    await persistAppearance(preset, presets);
    await renderManager();
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
    const backgroundEffect = document.getElementById("backgroundEffect");
    const backgroundImage = document.getElementById("backgroundImage");
    if (backgroundImage instanceof HTMLInputElement) backgroundImage.type = "text";
    if (!(backgroundEffect instanceof HTMLElement)) return;

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
    const active = model.presets.find((preset) => preset.id === model.activeId) || model.presets[0];
    if (active) await persistAppearance(active, model.presets);

    manager.innerHTML = "";
    const heading = document.createElement("h3");
    heading.textContent = t("backgroundPresetManager");
    const description = document.createElement("p");
    description.textContent = t("backgroundPresetDescription");
    manager.append(heading, description);

    const favorites = model.presets.filter((preset) => preset.liked);
    if (favorites.length > 0) manager.append(tileGroup(t("backgroundPresetFavorites"), favorites, model.activeId));
    manager.append(tileGroup(t("backgroundPresetAll"), model.presets, model.activeId), createForm());
  }

  function preservePresetsAfterCoreSave() {
    void (async () => {
      const before = normalize(await readSettings());
      window.setTimeout(() => void restorePresets(before), 700);
      window.setTimeout(() => void restorePresets(before), 1800);
    })();
  }

  async function restorePresets(before) {
    const settings = await readSettings();
    const active = before.presets.find((preset) => preset.id === before.activeId) || before.presets[0];
    if (!active) return;
    const appearance = isRecord(settings.appearance) ? settings.appearance : {};
    await writeSettings({
      ...settings,
      appearance: {
        ...appearance,
        activeBackgroundPresetId: before.activeId,
        backgroundPresets: before.presets,
      },
    });
  }

  document.addEventListener("submit", (event) => {
    if (event.target instanceof HTMLFormElement && event.target.id === "form") preservePresetsAfterCoreSave();
  }, true);

  const observer = new MutationObserver(() => void renderManager());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("DOMContentLoaded", () => void renderManager());
  window.setTimeout(() => void renderManager(), 500);
})();
