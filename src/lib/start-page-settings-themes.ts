import {
  BUILT_IN_THEMES,
  cloneTheme,
  createThemeId,
  getBuiltInTheme,
} from "./start-page-defaults.js";
import {
  normalizeTheme,
  normalizeThemeBundle,
  themeBundle,
} from "./start-page-validation.js";
import type {
  StartPageSettings,
  StartPageTheme,
  ThemeBundle,
} from "./start-page-types.js";

export function createCustomThemeDraft(settings: StartPageSettings, title = "Custom theme", now = Date.now()): StartPageTheme {
  const base = resolveSelectedTheme(settings);
  const copy = cloneTheme(base);
  copy.id = createThemeId(title, new Set([...BUILT_IN_THEMES.map((theme) => theme.id), ...settings.theme.customThemes.map((theme) => theme.id)]));
  copy.title = title;
  copy.description = "Custom Start Tab theme";
  copy.builtIn = false;
  copy.createdAt = now;
  copy.updatedAt = now;
  return copy;
}

export function createCustomTheme(settings: StartPageSettings, title = "Custom theme", now = Date.now()): StartPageSettings {
  const next = structuredClone(settings);
  const copy = createCustomThemeDraft(next, title, now);
  next.theme.customThemes.push(copy);
  next.theme.selectedThemeId = copy.id;
  next.updatedAt = now;
  return next;
}

export function saveCustomTheme(settings: StartPageSettings, theme: StartPageTheme, now = Date.now()): StartPageSettings {
  const next = structuredClone(settings);
  const normalized = normalizeTheme({ ...theme, builtIn: false, updatedAt: now }, theme.id, false, theme.createdAt);
  if (!normalized) throw new Error("Invalid custom theme");
  if (getBuiltInTheme(normalized.id)) throw new Error("Built-in theme IDs are reserved");
  const index = next.theme.customThemes.findIndex((candidate) => candidate.id === normalized.id);
  if (index >= 0) next.theme.customThemes[index] = normalized;
  else next.theme.customThemes.push(normalized);
  next.theme.selectedThemeId = normalized.id;
  next.updatedAt = now;
  return next;
}

export function duplicateTheme(settings: StartPageSettings, themeId: string, now = Date.now()): StartPageSettings {
  const source = getBuiltInTheme(themeId) ?? settings.theme.customThemes.find((theme) => theme.id === themeId);
  if (!source) throw new Error(`Unknown theme: ${themeId}`);
  const next = structuredClone(settings);
  const copy = cloneTheme(source);
  copy.id = createThemeId(`${source.title}-copy`, new Set([...BUILT_IN_THEMES.map((theme) => theme.id), ...next.theme.customThemes.map((theme) => theme.id)]));
  copy.title = `${source.title} copy`;
  copy.builtIn = false;
  copy.createdAt = now;
  copy.updatedAt = now;
  next.theme.customThemes.push(copy);
  next.theme.selectedThemeId = copy.id;
  next.updatedAt = now;
  return next;
}

export function deleteCustomTheme(settings: StartPageSettings, themeId: string, now = Date.now()): StartPageSettings {
  if (getBuiltInTheme(themeId)) throw new Error("Built-in themes cannot be deleted");
  const next = structuredClone(settings);
  const lengthBefore = next.theme.customThemes.length;
  next.theme.customThemes = next.theme.customThemes.filter((theme) => theme.id !== themeId);
  if (next.theme.customThemes.length === lengthBefore) throw new Error(`Unknown custom theme: ${themeId}`);
  if (next.theme.selectedThemeId === themeId) next.theme.selectedThemeId = BUILT_IN_THEMES[0].id;
  next.updatedAt = now;
  return next;
}

export function selectTheme(settings: StartPageSettings, themeId: string, now = Date.now()): StartPageSettings {
  if (!getBuiltInTheme(themeId) && !settings.theme.customThemes.some((theme) => theme.id === themeId)) throw new Error(`Unknown theme: ${themeId}`);
  const next = structuredClone(settings);
  next.theme.selectedThemeId = themeId;
  next.updatedAt = now;
  return next;
}

export function resolveSelectedTheme(settings: StartPageSettings): StartPageTheme {
  return cloneTheme(getBuiltInTheme(settings.theme.selectedThemeId) ?? settings.theme.customThemes.find((theme) => theme.id === settings.theme.selectedThemeId) ?? BUILT_IN_THEMES[0]);
}

export function exportTheme(settings: StartPageSettings, themeId: string): ThemeBundle {
  const theme = getBuiltInTheme(themeId) ?? settings.theme.customThemes.find((candidate) => candidate.id === themeId);
  if (!theme) throw new Error(`Unknown theme: ${themeId}`);
  return themeBundle(theme);
}

export function importTheme(settings: StartPageSettings, value: unknown, now = Date.now()): StartPageSettings {
  const bundle = normalizeThemeBundle(value);
  if (!bundle) throw new Error("Invalid or unsupported theme file");
  const next = structuredClone(settings);
  const copy = cloneTheme(bundle.theme);
  const used = new Set([...BUILT_IN_THEMES.map((theme) => theme.id), ...next.theme.customThemes.map((theme) => theme.id)]);
  copy.id = createThemeId(copy.id, used);
  copy.builtIn = false;
  copy.createdAt = now;
  copy.updatedAt = now;
  next.theme.customThemes.push(copy);
  next.theme.selectedThemeId = copy.id;
  next.updatedAt = now;
  return next;
}
