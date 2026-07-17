import { BUILT_IN_THEMES, cloneTheme } from "./start-page-defaults.js";
import { MAX_CUSTOM_THEMES } from "./platform-limits.js";
import { THEME_SCHEMA_VERSION, type AnimatedEffectConfig, type BackgroundTile, type StartPageTheme, type ThemeBundle, type ValidationIssue, type ValidationResult } from "./start-page-types.js";
import { booleanValue, finiteNumber, isRecord, oneOf, safeCssToken, safeGradient, safeWebUrl, stringValue, timestampValue, trimmedString } from "./start-page-validation-primitives.js";

const EFFECT_IDS = ["animated-gradient", "aurora", "mesh", "spotlight", "noise", "matrix", "cyberpunk"] as const;

function normalizeEffectConfig(value: unknown, fallback: AnimatedEffectConfig): AnimatedEffectConfig {
  const source = isRecord(value) ? value : {};
  const effect = oneOf(source.effect, EFFECT_IDS, fallback.effect);
  const speed = (fallbackValue: number, max = 4): number => finiteNumber(source.speed, fallbackValue, 0.05, max);
  const intensity = (fallbackValue: number, max = 1): number => finiteNumber(source.intensity, fallbackValue, 0, max);
  switch (effect) {
    case "animated-gradient": {
      const fallbackColors = fallback.effect === effect ? fallback.colors : ["#111827", "#312e81", "#0f766e", "#111827"];
      const colors = Array.isArray(source.colors) ? source.colors.filter((item): item is string => typeof item === "string").slice(0, 8).map((item) => safeCssToken(item, "#111827", 64)) : fallbackColors;
      return { effect, speed: speed(fallback.effect === effect ? fallback.speed : 1), intensity: intensity(fallback.effect === effect ? fallback.intensity : 0.8), angle: finiteNumber(source.angle, fallback.effect === effect ? fallback.angle : 135, 0, 360), colors: colors.length >= 2 ? colors : fallbackColors };
    }
    case "aurora": return { effect, speed: speed(fallback.effect === effect ? fallback.speed : 1), intensity: intensity(fallback.effect === effect ? fallback.intensity : 0.65), blur: finiteNumber(source.blur, fallback.effect === effect ? fallback.blur : 72, 0, 160) };
    case "mesh": return { effect, speed: speed(fallback.effect === effect ? fallback.speed : 0.7), intensity: intensity(fallback.effect === effect ? fallback.intensity : 0.75), scale: finiteNumber(source.scale, fallback.effect === effect ? fallback.scale : 1, 0.25, 4) };
    case "spotlight": return { effect, speed: speed(fallback.effect === effect ? fallback.speed : 0.65), intensity: intensity(fallback.effect === effect ? fallback.intensity : 0.72), size: finiteNumber(source.size, fallback.effect === effect ? fallback.size : 62, 10, 180) };
    case "noise": return { effect, intensity: intensity(fallback.effect === effect ? fallback.intensity : 0.22, 0.65), animated: booleanValue(source.animated, fallback.effect === effect ? fallback.animated : false), speed: speed(fallback.effect === effect ? fallback.speed : 0.5, 2) };
    case "matrix": return { effect, speed: speed(fallback.effect === effect ? fallback.speed : 1), intensity: intensity(fallback.effect === effect ? fallback.intensity : 0.7), density: finiteNumber(source.density, fallback.effect === effect ? fallback.density : 0.55, 0.1, 1) };
    case "cyberpunk": return { effect, speed: speed(fallback.effect === effect ? fallback.speed : 1.1), intensity: intensity(fallback.effect === effect ? fallback.intensity : 0.72), scanlines: booleanValue(source.scanlines, fallback.effect === effect ? fallback.scanlines : true) };
  }
}

function defaultEffectConfig(): AnimatedEffectConfig {
  const first = BUILT_IN_THEMES[0]?.background;
  return first?.kind === "effect" ? structuredClone(first.config) : { effect: "aurora", speed: 1, intensity: 0.65, blur: 72 };
}

function normalizeBackground(value: unknown, fallback: BackgroundTile, path: string, issues: ValidationIssue[]): BackgroundTile {
  if (!isRecord(value)) return structuredClone(fallback);
  const kind = oneOf(value.kind, ["solid", "gradient", "image", "effect"] as const, fallback.kind);
  if (kind === "solid") return { kind, color: safeCssToken(value.color, fallback.kind === kind ? fallback.color : "#08111f", 100) };
  if (kind === "gradient") return { kind, css: safeGradient(value.css, fallback.kind === kind ? fallback.css : "linear-gradient(145deg, #08111f, #1e293b)") };
  if (kind === "image") {
    const url = safeWebUrl(stringValue(value.url, fallback.kind === kind ? fallback.url : ""));
    if (!url) issues.push({ path: `${path}.url`, messageKey: "validationInvalidUrl" });
    if (!url && fallback.kind !== kind) return structuredClone(fallback);
    return { kind, url: url ?? (fallback.kind === kind ? fallback.url : ""), fit: oneOf(value.fit, ["cover", "contain"] as const, fallback.kind === kind ? fallback.fit : "cover"), position: safeCssToken(value.position, fallback.kind === kind ? fallback.position : "center", 100) };
  }
  const fallbackConfig: AnimatedEffectConfig = fallback.kind === "effect" ? fallback.config : defaultEffectConfig();
  return { kind: "effect", baseColor: safeCssToken(value.baseColor, fallback.kind === "effect" ? fallback.baseColor : "#08111f", 100), config: normalizeEffectConfig(value.config, fallbackConfig) };
}

export function normalizeTheme(value: unknown, fallback: StartPageTheme, path = "theme", issues: ValidationIssue[] = []): StartPageTheme {
  if (!isRecord(value)) return cloneTheme(fallback);
  const tokens = isRecord(value.tokens) ? value.tokens : {};
  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    id: trimmedString(value.id, fallback.id, 160).replace(/[^a-zA-Z0-9_.:-]/g, "-") || fallback.id,
    name: trimmedString(value.name, fallback.name, 160) || fallback.name,
    builtIn: booleanValue(value.builtIn, fallback.builtIn),
    background: normalizeBackground(value.background, fallback.background, `${path}.background`, issues),
    tokens: {
      textPrimary: safeCssToken(tokens.textPrimary, fallback.tokens.textPrimary, 100), textSecondary: safeCssToken(tokens.textSecondary, fallback.tokens.textSecondary, 100), cardSurface: safeCssToken(tokens.cardSurface, fallback.tokens.cardSurface, 100), cardBorder: safeCssToken(tokens.cardBorder, fallback.tokens.cardBorder, 200), cardOpacity: finiteNumber(tokens.cardOpacity, fallback.tokens.cardOpacity, 0, 1), shadow: safeCssToken(tokens.shadow, fallback.tokens.shadow, 300), accent: safeCssToken(tokens.accent, fallback.tokens.accent, 100), hover: safeCssToken(tokens.hover, fallback.tokens.hover, 100), active: safeCssToken(tokens.active, fallback.tokens.active, 100), fontFamily: safeCssToken(tokens.fontFamily, fallback.tokens.fontFamily, 300), baseFontSize: finiteNumber(tokens.baseFontSize, fallback.tokens.baseFontSize, 10, 32), headingScale: finiteNumber(tokens.headingScale, fallback.tokens.headingScale, 0.8, 2), borderRadius: finiteNumber(tokens.borderRadius, fallback.tokens.borderRadius, 0, 48), spacing: finiteNumber(tokens.spacing, fallback.tokens.spacing, 4, 40),
    },
    createdAt: timestampValue(value.createdAt, fallback.createdAt),
    updatedAt: timestampValue(value.updatedAt, fallback.updatedAt),
  };
}

export function normalizeCustomThemes(value: unknown, issues: ValidationIssue[]): StartPageTheme[] {
  if (!Array.isArray(value)) return [];
  const result: StartPageTheme[] = [];
  const seen = new Set(BUILT_IN_THEMES.map((theme) => theme.id));
  for (const [index, item] of value.slice(0, MAX_CUSTOM_THEMES).entries()) {
    const fallback = cloneTheme(BUILT_IN_THEMES[0]!);
    fallback.id = `custom-theme-${index + 1}`;
    fallback.name = `Custom theme ${index + 1}`;
    fallback.builtIn = false;
    const theme = normalizeTheme(item, fallback, `themes.customThemes[${index}]`, issues);
    theme.builtIn = false;
    let id = theme.id;
    let suffix = 2;
    while (seen.has(id)) id = `${theme.id}-${suffix++}`;
    theme.id = id;
    seen.add(id);
    result.push(theme);
  }
  return result;
}

export function migrateLegacyTheme(root: Record<string, unknown>, _issues: ValidationIssue[]): StartPageTheme | null {
  if (!isRecord(root.appearance)) return null;
  const appearance = root.appearance;
  const fallback = cloneTheme(BUILT_IN_THEMES[0]!);
  fallback.id = "migrated-legacy-theme";
  fallback.name = "Migrated theme";
  fallback.builtIn = false;
  const color = safeCssToken(appearance.backgroundColor, "#08111f", 100);
  const image = safeWebUrl(stringValue(appearance.backgroundImage, ""));
  const effect = stringValue(appearance.backgroundEffect, "none");
  if (image) fallback.background = { kind: "image", url: image, fit: "cover", position: "center" };
  else if (["gradient", "aurora", "mesh", "spotlight", "noise"].includes(effect)) {
    const config: AnimatedEffectConfig = effect === "gradient" ? { effect: "animated-gradient", speed: 1, intensity: 0.8, angle: 135, colors: ["#111827", "#312e81", "#0f766e", "#111827"] } : effect === "mesh" ? { effect: "mesh", speed: 0.7, intensity: 0.75, scale: 1 } : effect === "spotlight" ? { effect: "spotlight", speed: 0.65, intensity: 0.72, size: 62 } : effect === "noise" ? { effect: "noise", intensity: 0.22, animated: false, speed: 0.5 } : { effect: "aurora", speed: 1, intensity: 0.65, blur: 72 };
    fallback.background = { kind: "effect", baseColor: color, config };
  } else fallback.background = { kind: "solid", color };
  fallback.tokens.textPrimary = safeCssToken(appearance.textColor, fallback.tokens.textPrimary, 100);
  fallback.tokens.fontFamily = safeCssToken(appearance.fontFamily, fallback.tokens.fontFamily, 300);
  fallback.tokens.baseFontSize = finiteNumber(appearance.baseFontSize, fallback.tokens.baseFontSize, 10, 32);
  return fallback;
}

export function normalizeThemeBundle(value: unknown): ValidationResult<ThemeBundle> {
  const issues: ValidationIssue[] = [];
  const fallback = cloneTheme(BUILT_IN_THEMES[0]!);
  fallback.id = "imported-theme";
  fallback.name = "Imported theme";
  fallback.builtIn = false;
  const source = isRecord(value) && value.app === "Start Tab Theme" && value.version === 1 ? value : null;
  if (!source) issues.push({ path: "theme", messageKey: "validationInvalidThemeFile" });
  const theme = normalizeTheme(source?.theme, fallback, "theme", issues);
  theme.builtIn = false;
  return { value: { app: "Start Tab Theme", version: 1, exportedAt: typeof source?.exportedAt === "string" ? source.exportedAt : new Date(0).toISOString(), theme }, issues };
}

export function themeBundle(theme: StartPageTheme): ThemeBundle {
  return { app: "Start Tab Theme", version: 1, exportedAt: new Date().toISOString(), theme: { ...cloneTheme(theme), builtIn: false } };
}
