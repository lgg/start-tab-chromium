import type { StartPageTheme } from "../lib/start-page-settings.js";

function cssUrl(value: string): string {
  return `url("${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}")`;
}

function clearEffectState(root: HTMLElement, background: HTMLElement): void {
  for (const property of [
    "--effect-speed",
    "--effect-intensity",
    "--effect-blur",
    "--effect-scale",
    "--effect-size",
    "--effect-angle",
    "--effect-density",
    "--effect-colors",
  ]) root.style.removeProperty(property);
  delete background.dataset.effect;
  delete background.dataset.effectAnimated;
  delete background.dataset.scanlines;
}

export function applyTheme(theme: StartPageTheme, background: HTMLElement): void {
  const root = document.documentElement;
  const tokens = theme.tokens;
  root.style.setProperty("--text-primary", tokens.textPrimary);
  root.style.setProperty("--text-secondary", tokens.textSecondary);
  root.style.setProperty("--card-surface", tokens.cardSurface);
  root.style.setProperty("--card-border", tokens.cardBorder);
  root.style.setProperty("--card-opacity", String(tokens.cardOpacity));
  root.style.setProperty("--card-shadow", tokens.shadow);
  root.style.setProperty("--accent", tokens.accent);
  root.style.setProperty("--hover", tokens.hover);
  root.style.setProperty("--active", tokens.active);
  root.style.setProperty("--font-family", tokens.fontFamily);
  root.style.setProperty("--base-font-size", `${tokens.baseFontSize}px`);
  root.style.setProperty("--heading-scale", String(tokens.headingScale));
  root.style.setProperty("--radius", `${tokens.borderRadius}px`);
  root.style.setProperty("--spacing", `${tokens.spacing}px`);
  clearEffectState(root, background);
  background.style.backgroundImage = "";
  background.style.backgroundColor = "";
  background.style.backgroundSize = "";
  background.style.backgroundPosition = "";

  switch (theme.background.kind) {
    case "solid":
      background.style.backgroundColor = theme.background.color;
      break;
    case "gradient":
      background.style.backgroundImage = theme.background.css;
      break;
    case "image":
      background.style.backgroundImage = cssUrl(theme.background.url);
      background.style.backgroundSize = theme.background.fit;
      background.style.backgroundPosition = theme.background.position;
      break;
    case "effect": {
      const config = theme.background.config;
      background.style.backgroundColor = theme.background.baseColor;
      background.dataset.effect = config.effect;
      root.style.setProperty("--effect-intensity", String(config.intensity));
      if ("speed" in config) root.style.setProperty("--effect-speed", `${Math.max(0.05, config.speed)}s`);
      switch (config.effect) {
        case "animated-gradient":
          root.style.setProperty("--effect-angle", `${config.angle}deg`);
          root.style.setProperty("--effect-colors", config.colors.join(", "));
          break;
        case "aurora":
          root.style.setProperty("--effect-blur", `${config.blur}px`);
          break;
        case "mesh":
          root.style.setProperty("--effect-scale", String(config.scale));
          break;
        case "spotlight":
          root.style.setProperty("--effect-size", `${config.size}%`);
          break;
        case "noise":
          background.dataset.effectAnimated = String(config.animated);
          break;
        case "matrix":
          root.style.setProperty("--effect-density", String(config.density));
          break;
        case "cyberpunk":
          background.dataset.scanlines = String(config.scanlines);
          break;
      }
      break;
    }
  }
}
