import type { I18n } from "./i18n.js";
import {
cloneTheme,
normalizeTheme,
type AnimatedEffectId,
type StartPageTheme,
type ValidationIssue,
} from "./start-page-settings.js";
import type { BackgroundTile } from "./start-page-types.js";
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
input.type = type;
input.value = value;
input.autocomplete = "off";
return input;
}
function numberInput(value: number, min: number, max: number, step: number | "any" = 1): HTMLInputElement {
const input = element("input", "input");
input.type = "number";
input.value = String(value);
input.min = String(min);
input.max = String(max);
input.step = step === "any" ? "any" : String(step);
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
const parsed = Number(input.value);
return Number.isFinite(parsed) ? parsed : fallback;
}
function issueText(i18n: I18n, issues: ValidationIssue[]): string {
return issues.map((issue) => `${issue.path}: ${i18n.t(issue.messageKey, issue.replacements)}`).join("\n");
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
const draw = (): void => {
dynamic.replaceChildren();
switch (kind.value) {
case "solid": {
const fallback = theme.background.kind === "solid" ? theme.background.color : "#08111f";
const color = textInput(fallback, "color");
dynamic.append(field(i18n.t("backgroundColor"), color, true));
readDynamic = () => ({ kind: "solid", color: color.value });
break;
}
case "gradient": {
const fallback = theme.background.kind === "gradient" ? theme.background.css : "linear-gradient(145deg, #08111f, #312e81)";
const css = textInput(fallback);
dynamic.append(field(i18n.t("backgroundGradientCss"), css, true));
readDynamic = () => ({ kind: "gradient", css: css.value });
break;
}
case "image": {
const existing = theme.background.kind === "image" ? theme.background : { url: "", fit: "cover" as const, position: "center" };
const url = textInput(existing.url, "url");
const fit = select(existing.fit, [["cover", i18n.t("imageFitCover")], ["contain", i18n.t("imageFitContain")]]);
const position = textInput(existing.position);
dynamic.append(field(i18n.t("backgroundImageUrl"), url, true), field(i18n.t("backgroundImageFit"), fit), field(i18n.t("backgroundImagePosition"), position));
readDynamic = () => ({ kind: "image", url: url.value, fit: fit.value as "cover" | "contain", position: position.value });
break;
}
default: {
const existing = defaultEffectTile(theme);
const baseColor = textInput(existing.baseColor, "color");
const effect = select<AnimatedEffectId>(existing.config.effect, [
["animated-gradient", i18n.t("effectGradient")],
["aurora", i18n.t("effectAurora")],
["mesh", i18n.t("effectMesh")],
["spotlight", i18n.t("effectSpotlight")],
["noise", i18n.t("effectNoise")],
["matrix", i18n.t("effectMatrix")],
["cyberpunk", i18n.t("effectCyberpunk")],
]);
const effectFields = element("div", "settings-grid settings-field--wide");
dynamic.append(field(i18n.t("backgroundBaseColor"), baseColor), field(i18n.t("backgroundEffect"), effect), effectFields);
let readEffect: () => Extract<BackgroundTile, { kind: "effect" }>["config"];
const drawEffect = (): void => {
effectFields.replaceChildren();
const current = existing.config.effect === effect.value ? existing.config : null;
const speed = numberInput("speed" in existing.config ? existing.config.speed : 1, 0.05, 4, 0.05);
const intensity = numberInput(existing.config.intensity, 0, 1, 0.01);
switch (effect.value) {
case "animated-gradient": {
const angle = numberInput(current?.effect === "animated-gradient" ? current.angle : 135, 0, 360, 1);
const colors = textInput(current?.effect === "animated-gradient" ? current.colors.join(", ") : "#111827, #312e81, #0f766e, #111827");
effectFields.append(field(i18n.t("effectSpeed"), speed), field(i18n.t("effectIntensity"), intensity), field(i18n.t("effectAngle"), angle), field(i18n.t("effectColors"), colors, true));
readEffect = () => ({ effect: "animated-gradient", speed: readNumber(speed, 1), intensity: readNumber(intensity, 0.8), angle: readNumber(angle, 135), colors: colors.value.split(",").map((item) => item.trim()).filter(Boolean) });
break;
}
case "aurora": {
const blur = numberInput(current?.effect === "aurora" ? current.blur : 72, 0, 160, 1);
effectFields.append(field(i18n.t("effectSpeed"), speed), field(i18n.t("effectIntensity"), intensity), field(i18n.t("effectBlur"), blur));
readEffect = () => ({ effect: "aurora", speed: readNumber(speed, 1), intensity: readNumber(intensity, 0.65), blur: readNumber(blur, 72) });
break;
}
case "mesh": {
const scale = numberInput(current?.effect === "mesh" ? current.scale : 1, 0.25, 4, 0.05);
effectFields.append(field(i18n.t("effectSpeed"), speed), field(i18n.t("effectIntensity"), intensity), field(i18n.t("effectScale"), scale));
readEffect = () => ({ effect: "mesh", speed: readNumber(speed, 0.7), intensity: readNumber(intensity, 0.75), scale: readNumber(scale, 1) });
break;
}
case "spotlight": {
const size = numberInput(current?.effect === "spotlight" ? current.size : 62, 10, 180, 1);
effectFields.append(field(i18n.t("effectSpeed"), speed), field(i18n.t("effectIntensity"), intensity), field(i18n.t("effectSize"), size));
readEffect = () => ({ effect: "spotlight", speed: readNumber(speed, 0.65), intensity: readNumber(intensity, 0.72), size: readNumber(size, 62) });
break;
}
case "noise": {
const animated = checkbox(current?.effect === "noise" ? current.animated : false);
effectFields.append(field(i18n.t("effectIntensity"), intensity), field(i18n.t("effectAnimated"), animated), field(i18n.t("effectSpeed"), speed));
readEffect = () => ({ effect: "noise", intensity: readNumber(intensity, 0.22), animated: animated.checked, speed: readNumber(speed, 0.5) });
break;
}
case "matrix": {
const density = numberInput(current?.effect === "matrix" ? current.density : 0.55, 0.1, 1, 0.01);
effectFields.append(field(i18n.t("effectSpeed"), speed), field(i18n.t("effectIntensity"), intensity), field(i18n.t("effectDensity"), density));
readEffect = () => ({ effect: "matrix", speed: readNumber(speed, 1), intensity: readNumber(intensity, 0.7), density: readNumber(density, 0.55) });
break;
}
case "cyberpunk": {
const scanlines = checkbox(current?.effect === "cyberpunk" ? current.scanlines : true);
effectFields.append(field(i18n.t("effectSpeed"), speed), field(i18n.t("effectIntensity"), intensity), field(i18n.t("effectScanlines"), scanlines));
readEffect = () => ({ effect: "cyberpunk", speed: readNumber(speed, 1.1), intensity: readNumber(intensity, 0.72), scanlines: scanlines.checked });
break;
}
}
};
effect.addEventListener("change", drawEffect);
drawEffect();
readDynamic = () => ({ kind: "effect", baseColor: baseColor.value, config: readEffect() });
break;
}
}
};
kind.addEventListener("change", draw);
draw();
return { root, read: () => readDynamic() };
}
export async function editTheme(theme: StartPageTheme, i18n: I18n): Promise<StartPageTheme | null> {
return new Promise<StartPageTheme | null>((resolve) => {
const working = cloneTheme(theme);
const dialog = element("dialog", "settings-dialog");
dialog.setAttribute("aria-labelledby", "theme-editor-title");
const form = element("form", "settings-dialog__form");
form.method = "dialog";
const header = element("header", "settings-dialog__header");
const heading = element("div", "settings-dialog__heading");
const title = element("h2", "settings-dialog__title", i18n.t("themeEditorTitle", { name: working.name }));
title.id = "theme-editor-title";
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
const cardOpacity = numberInput(tokens.cardOpacity, 0, 1, 0.01);
const shadow = textInput(tokens.shadow);
const accent = textInput(tokens.accent, "color");
const hover = textInput(tokens.hover);
const active = textInput(tokens.active);
const fontFamily = textInput(tokens.fontFamily);
const baseFontSize = numberInput(tokens.baseFontSize, 10, 32, 1);
const headingScale = numberInput(tokens.headingScale, 0.8, 2, 0.05);
const radius = numberInput(tokens.borderRadius, 0, 48, 1);
const spacing = numberInput(tokens.spacing, 4, 40, 1);
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
let result: StartPageTheme | null = null;
form.addEventListener("input", () => { dirty = true; });
form.addEventListener("change", () => { dirty = true; });
const confirmDiscard = (): boolean => !dirty || window.confirm(i18n.t("discardChangesConfirm"));
const closeDialog = (): void => {
if (!confirmDiscard()) return;
dialog.close("cancel");
};
close.addEventListener("click", closeDialog);
cancel.addEventListener("click", closeDialog);
dialog.addEventListener("cancel", (event) => {
if (!confirmDiscard()) event.preventDefault();
});
form.addEventListener("submit", (event) => {
event.preventDefault();
if (!form.reportValidity()) return;
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
result = normalizeTheme(candidate, working, "theme", issues);
if (!result.name.trim()) issues.push({ path: "theme.name", messageKey: "validationRequired" });
if (issues.length > 0) {
error.textContent = issueText(i18n, issues);
error.hidden = false;
result = null;
return;
}
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
