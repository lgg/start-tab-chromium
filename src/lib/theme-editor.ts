import type { I18n } from "./i18n.js";
import { FormPanelCache, parseNumberField } from "./form-panel-cache.js";
import { focusExistingSettingsDialog, nextSettingsDialogTitleId, protectSettingsDialogDraft } from "./settings-dialog-guard.js";
import {
cloneTheme,
normalizeTheme,
type AnimatedEffectId,
type StartPageTheme,
type ValidationIssue,
} from "./start-page-settings.js";
import type { BackgroundTile } from "./start-page-types.js";
import { normalizeEffectConfig, NOISE_EFFECT_LIMITS } from "./start-page-theme-validation.js";
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
const node = document.createElement(tag);
node.className = className;
node.textContent = text;
return node;
}
function button(text: string, className = "button", type: "button" | "submit" = "button"): HTMLButtonElement {
const node = element("button", className, text);
node.type = type;
return node;
}
function textInput(value: string, type: "text" | "url" | "color" = "text"): HTMLInputElement {
const input = element("input", "input");
// Native color controls sanitize CSS colors they cannot represent, often
// replacing an imported rgb()/rgba()/named color with black on save.
input.type = type === "color" && !/^#[0-9a-f]{6}$/i.test(value) ? "text" : type;
input.value = value;
input.autocomplete = "off";
return input;
}
function numberInput(value: number, min: number, max: number): HTMLInputElement {
const input = element("input", "input");
input.type = "number";
input.value = String(value);
input.min = String(min);
input.max = String(max);
input.step = "any";
return input;
}
function checkbox(value: boolean): HTMLInputElement {
const input = element("input", "checkbox");
input.type = "checkbox";
input.checked = value;
return input;
}
function select<T extends string>(value: T, values: Array<[T, string]>): HTMLSelectElement {
const node = element("select", "select");
for (const [optionValue, label] of values) {
const option = element("option", "", label);
option.value = optionValue;
option.selected = optionValue === value;
node.append(option);
}
return node;
}
function field(label: string, control: HTMLElement, wide = false): HTMLElement {
const wrapper = element("label", wide ? "settings-field settings-field--wide" : "settings-field");
wrapper.append(element("span", "settings-field__label", label), control);
return wrapper;
}
function readNumber(input: HTMLInputElement, fallback: number): number {
return parseNumberField(input.value, fallback);
}
function issueText(i18n: I18n, issues: ValidationIssue[]): string {
return issues.map((issue) => `${issue.path}: ${i18n.t(issue.messageKey, issue.replacements)}`).join("\n");
}
/** Split only top-level separators: CSS color functions can contain commas,
 * including nested var()/color-mix() expressions and quoted strings. */
function splitCssColors(value: string): string[] {
  const colors: string[] = [];
  let start = 0, depth = 0, quote = "", escaped = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      colors.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  colors.push(value.slice(start).trim());
  return colors.filter(Boolean);
}
function defaultEffectTile(theme: StartPageTheme): Extract<BackgroundTile, { kind: "effect" }> {
if (theme.background.kind === "effect") return structuredClone(theme.background);
return {
kind: "effect",
baseColor: "#08111f",
config: { effect: "aurora", speed: 1, intensity: 0.65, blur: 72 },
};
}
function backgroundEditor(
theme: StartPageTheme,
i18n: I18n,
): { root: HTMLElement; read: () => BackgroundTile } {
const root = element("div", "theme-background-editor settings-field--wide");
const kind = select(theme.background.kind, [
["solid", i18n.t("backgroundKindSolid")],
["gradient", i18n.t("backgroundKindGradient")],
["image", i18n.t("backgroundKindImage")],
["effect", i18n.t("backgroundKindEffect")],
]);
const dynamic = element("div", "settings-grid theme-background-editor__dynamic");
root.append(field(i18n.t("backgroundTile"), kind, true), dynamic);
let readDynamic: () => BackgroundTile;
const backgroundPanels = new FormPanelCache<BackgroundTile>();
const backgroundKinds = new Set<string>(["solid", "gradient", "image", "effect"]);
let lastKind = theme.background.kind;
const createBackgroundPanel = (): (() => BackgroundTile) => {
switch (kind.value) {
case "solid": {
const fallback = theme.background.kind === "solid" ? theme.background.color : "#08111f";
const color = textInput(fallback, "color");
dynamic.append(field(i18n.t("backgroundColor"), color, true));
return () => ({ kind: "solid", color: color.value });
}
case "gradient": {
const fallback = theme.background.kind === "gradient" ? theme.background.css : "linear-gradient(145deg, #08111f, #312e81)";
const css = textInput(fallback);
dynamic.append(field(i18n.t("backgroundGradientCss"), css, true));
return () => ({ kind: "gradient", css: css.value });
}
case "image": {
const existing = theme.background.kind === "image" ? theme.background : { url: "", fit: "cover" as const, position: "center" };
const url = textInput(existing.url, "url");
const fit = select(existing.fit, [["cover", i18n.t("imageFitCover")], ["contain", i18n.t("imageFitContain")]]);
const position = textInput(existing.position);
dynamic.append(field(i18n.t("backgroundImageUrl"), url, true), field(i18n.t("backgroundImageFit"), fit), field(i18n.t("backgroundImagePosition"), position));
return () => ({ kind: "image", url: url.value, fit: fit.value as "cover" | "contain", position: position.value });
}
default: {
const existing = defaultEffectTile(theme);
const baseColor = textInput(existing.baseColor, "color");
const effectChoices: Array<[AnimatedEffectId, string]> = [
["animated-gradient", i18n.t("effectGradient")],
["aurora", i18n.t("effectAurora")],
["mesh", i18n.t("effectMesh")],
["spotlight", i18n.t("effectSpotlight")],
["noise", i18n.t("effectNoise")],
["matrix", i18n.t("effectMatrix")],
["cyberpunk", i18n.t("effectCyberpunk")],
];
const effect = select<AnimatedEffectId>(existing.config.effect, effectChoices);
const effectIds = new Set<string>(effectChoices.map(([id]) => id));
const effectFields = element("div", "settings-grid settings-field--wide");
dynamic.append(field(i18n.t("backgroundBaseColor"), baseColor), field(i18n.t("backgroundEffect"), effect), effectFields);
type EffectConfig = Extract<BackgroundTile, { kind: "effect" }>["config"];
let readEffect: () => EffectConfig;
const effectPanels = new FormPanelCache<EffectConfig>();
let lastEffect: AnimatedEffectId = existing.config.effect;
const createEffectPanel = (selected: AnimatedEffectId): (() => EffectConfig) => {
// Use the same defaults as persistence, not another effect\'s values.
const current = normalizeEffectConfig({ effect: selected }, existing.config);
const speed = numberInput(current.speed, 0.05, selected === "noise" ? NOISE_EFFECT_LIMITS.speed : 4);
const intensity = numberInput(current.intensity, 0, selected === "noise" ? NOISE_EFFECT_LIMITS.intensity : 1);
switch (selected) {
case "animated-gradient": {
const angle = numberInput(current?.effect === "animated-gradient" ? current.angle : 135, 0, 360);
const colors = textInput(current?.effect === "animated-gradient" ? current.colors.join(", ") : "#111827, #312e81, #0f766e, #111827");
effectFields.append(field(i18n.t("effectSpeed"), speed), field(i18n.t("effectIntensity"), intensity), field(i18n.t("effectAngle"), angle), field(i18n.t("effectColors"), colors, true));
return () => ({ effect: "animated-gradient", speed: readNumber(speed, 1), intensity: readNumber(intensity, 0.8), angle: readNumber(angle, 135), colors: splitCssColors(colors.value) });
}
case "aurora": {
const blur = numberInput(current?.effect === "aurora" ? current.blur : 72, 0, 160);
effectFields.append(field(i18n.t("effectSpeed"), speed), field(i18n.t("effectIntensity"), intensity), field(i18n.t("effectBlur"), blur));
return () => ({ effect: "aurora", speed: readNumber(speed, 1), intensity: readNumber(intensity, 0.65), blur: readNumber(blur, 72) });
}
case "mesh": {
const scale = numberInput(current?.effect === "mesh" ? current.scale : 1, 0.25, 4);
effectFields.append(field(i18n.t("effectSpeed"), speed), field(i18n.t("effectIntensity"), intensity), field(i18n.t("effectScale"), scale));
return () => ({ effect: "mesh", speed: readNumber(speed, 0.7), intensity: readNumber(intensity, 0.75), scale: readNumber(scale, 1) });
}
case "spotlight": {
const size = numberInput(current?.effect === "spotlight" ? current.size : 62, 10, 180);
effectFields.append(field(i18n.t("effectSpeed"), speed), field(i18n.t("effectIntensity"), intensity), field(i18n.t("effectSize"), size));
return () => ({ effect: "spotlight", speed: readNumber(speed, 0.65), intensity: readNumber(intensity, 0.72), size: readNumber(size, 62) });
}
case "noise": {
const animated = checkbox(current?.effect === "noise" ? current.animated : false);
effectFields.append(field(i18n.t("effectIntensity"), intensity), field(i18n.t("effectAnimated"), animated), field(i18n.t("effectSpeed"), speed));
return () => ({ effect: "noise", intensity: readNumber(intensity, 0.22), animated: animated.checked, speed: readNumber(speed, 0.5) });
}
case "matrix": {
const density = numberInput(current?.effect === "matrix" ? current.density : 0.55, 0.1, 1);
effectFields.append(field(i18n.t("effectSpeed"), speed), field(i18n.t("effectIntensity"), intensity), field(i18n.t("effectDensity"), density));
return () => ({ effect: "matrix", speed: readNumber(speed, 1), intensity: readNumber(intensity, 0.7), density: readNumber(density, 0.55) });
}
case "cyberpunk": {
const scanlines = checkbox(current?.effect === "cyberpunk" ? current.scanlines : true);
effectFields.append(field(i18n.t("effectSpeed"), speed), field(i18n.t("effectIntensity"), intensity), field(i18n.t("effectScanlines"), scanlines));
return () => ({ effect: "cyberpunk", speed: readNumber(speed, 1.1), intensity: readNumber(intensity, 0.72), scanlines: scanlines.checked });
}
}
};
const drawEffect = (): void => {
  // An empty or unknown selection must not destroy the previous draft
  // or throw from a browser change listener.
  if (!effectIds.has(effect.value)) effect.value = lastEffect;
  else lastEffect = effect.value as AnimatedEffectId;
  readEffect = effectPanels.show(lastEffect, effectFields, () => createEffectPanel(lastEffect));
};
effect.addEventListener("change", drawEffect);
drawEffect();
return () => ({ kind: "effect", baseColor: baseColor.value, config: readEffect() });
}
}
};
const draw = (): void => {
if (!backgroundKinds.has(kind.value)) kind.value = lastKind;
else lastKind = kind.value as BackgroundTile["kind"];
readDynamic = backgroundPanels.show(lastKind, dynamic, createBackgroundPanel);
};
kind.addEventListener("change", draw);
draw();
return { root, read: () => readDynamic() };
}
export async function editTheme(theme: StartPageTheme, i18n: I18n, persist?: (candidate: StartPageTheme) => Promise<void>): Promise<StartPageTheme | null> {
if (focusExistingSettingsDialog()) return null;
return new Promise<StartPageTheme | null>((resolve) => {
const working = cloneTheme(theme);
const dialog = element("dialog", "settings-dialog");
dialog.tabIndex = -1;
const titleId = nextSettingsDialogTitleId("theme-editor-title");
dialog.setAttribute("aria-labelledby", titleId);
const form = element("form", "settings-dialog__form");
form.method = "dialog";
const header = element("header", "settings-dialog__header");
const heading = element("div", "settings-dialog__heading");
const title = element("h2", "settings-dialog__title", i18n.t("themeEditorTitle", { name: working.name }));
title.id = titleId;
heading.append(title, element("p", "settings-dialog__subtitle", i18n.t("themeEditorSubtitle")));
const close = button("×", "icon-button settings-dialog__close");
close.setAttribute("aria-label", i18n.t("close"));
header.append(heading, close);
const body = element("div", "settings-dialog__body");
const grid = element("div", "settings-grid");
const name = textInput(working.name);
const background = backgroundEditor(working, i18n);
const tokens = working.tokens;
const textPrimary = textInput(tokens.textPrimary, "color");
const textSecondary = textInput(tokens.textSecondary, "color");
const cardSurface = textInput(tokens.cardSurface, "color");
const cardBorder = textInput(tokens.cardBorder);
const cardOpacity = numberInput(tokens.cardOpacity, 0, 1);
const shadow = textInput(tokens.shadow);
const accent = textInput(tokens.accent, "color");
const hover = textInput(tokens.hover);
const active = textInput(tokens.active);
const fontFamily = textInput(tokens.fontFamily);
const baseFontSize = numberInput(tokens.baseFontSize, 10, 32);
// Built-in themes use 1.08 and imported themes may use other fractional
// values. Match the normalizer instead of rejecting a valid existing value.
const headingScale = numberInput(tokens.headingScale, 0.8, 2);
const radius = numberInput(tokens.borderRadius, 0, 48);
const spacing = numberInput(tokens.spacing, 4, 40);
grid.append(
field(i18n.t("themeName"), name, true),
background.root,
field(i18n.t("themeTextPrimary"), textPrimary),
field(i18n.t("themeTextSecondary"), textSecondary),
field(i18n.t("themeCardSurface"), cardSurface),
field(i18n.t("themeCardBorder"), cardBorder),
field(i18n.t("themeCardOpacity"), cardOpacity),
field(i18n.t("themeShadow"), shadow),
field(i18n.t("themeAccent"), accent),
field(i18n.t("themeHover"), hover),
field(i18n.t("themeActive"), active),
field(i18n.t("fontFamily"), fontFamily, true),
field(i18n.t("baseFontSize"), baseFontSize),
field(i18n.t("themeHeadingScale"), headingScale),
field(i18n.t("themeBorderRadius"), radius),
field(i18n.t("themeSpacing"), spacing),
);
const error = element("p", "form-error");
error.hidden = true;
body.append(grid, error);
const footer = element("footer", "settings-dialog__footer");
const cancel = button(i18n.t("cancel"), "button button--secondary");
const save = button(i18n.t("save"), "button button--primary", "submit");
footer.append(cancel, save);
form.append(header, body, footer);
dialog.append(form);
document.body.append(dialog);
let dirty = false;
let saving = false;
protectSettingsDialogDraft(dialog, () => dirty || saving);
let result: StartPageTheme | null = null;
form.addEventListener("input", () => { dirty = true; });
form.addEventListener("change", () => { dirty = true; });
const confirmDiscard = (): boolean => !saving && (!dirty || window.confirm(i18n.t("discardChangesConfirm")));
const closeDialog = (): void => {
if (!confirmDiscard()) return;
dialog.close("cancel");
};
close.addEventListener("click", closeDialog);
cancel.addEventListener("click", closeDialog);
dialog.addEventListener("cancel", (event) => {
if (!confirmDiscard()) event.preventDefault();
});
form.addEventListener("submit", async (event) => {
event.preventDefault();
if (saving || !form.reportValidity()) return;
const candidate: StartPageTheme = {
...working,
name: name.value.trim(),
builtIn: false,
background: background.read(),
tokens: {
textPrimary: textPrimary.value,
textSecondary: textSecondary.value,
cardSurface: cardSurface.value,
cardBorder: cardBorder.value,
cardOpacity: readNumber(cardOpacity, tokens.cardOpacity),
shadow: shadow.value,
accent: accent.value,
hover: hover.value,
active: active.value,
fontFamily: fontFamily.value,
baseFontSize: readNumber(baseFontSize, tokens.baseFontSize),
headingScale: readNumber(headingScale, tokens.headingScale),
borderRadius: readNumber(radius, tokens.borderRadius),
spacing: readNumber(spacing, tokens.spacing),
},
updatedAt: Date.now(),
};
const issues: ValidationIssue[] = [];
const normalized = normalizeTheme(candidate, working, "theme", issues);
if (!normalized.name.trim()) issues.push({ path: "theme.name", messageKey: "validationRequired" });
if (issues.length > 0) {
error.textContent = issueText(i18n, issues);
error.hidden = false;
result = null;
return;
}
if (persist) {
  saving = true;
  form.inert = true;
  form.setAttribute("aria-busy", "true");
  save.disabled = true;
  cancel.disabled = true;
  close.disabled = true;
  error.hidden = true;
  try {
    await persist(normalized);
  } catch (failure) {
    dirty = true;
    error.textContent = failure instanceof Error ? failure.message : String(failure);
    error.hidden = false;
    return;
  } finally {
    saving = false;
    form.inert = false;
    form.removeAttribute("aria-busy");
    save.disabled = false;
    cancel.disabled = false;
    close.disabled = false;
  }
}
result = normalized;
dirty = false;
dialog.close("save");
});
dialog.addEventListener("close", () => {
dialog.remove();
resolve(result);
}, { once: true });
dialog.showModal();
name.focus();
name.select();
});
}
