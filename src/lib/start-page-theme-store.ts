import {
  DEFAULT_SETTINGS,
  cloneTheme,
  createThemeId,
  getBuiltInTheme,
  getTheme,
} from "./start-page-defaults.js";
import { getStartPageSettings, setStartPageSettings } from "./start-page-settings-store.js";
import { normalizeTheme, normalizeThemeBundle, themeBundle } from "./start-page-validation-v2.js";
import type { StartPageTheme, ThemeBundle, ValidationIssue } from "./start-page-types.js";

export async function createCustomTheme(name: string, sourceThemeId?: string): Promise<StartPageTheme> {
  const current = await getStartPageSettings();
  const source = sourceThemeId ? getTheme(current, sourceThemeId) : getTheme(current);
  const now = Date.now();
  const theme: StartPageTheme = {
    ...cloneTheme(source),
    id: createThemeId(),
    name: name.trim() || "Custom theme",
    builtIn: false,
    createdAt: now,
    updatedAt: now,
  };
  await setStartPageSettings({
    ...current,
    themes: { selectedThemeId: theme.id, customThemes: [...current.themes.customThemes, theme] },
  });
  return theme;
}

export async function updateCustomTheme(theme: StartPageTheme): Promise<StartPageTheme> {
  const current = await getStartPageSettings();
  if (getBuiltInTheme(theme.id)) throw new Error("Built-in themes cannot be edited");
  const existing = current.themes.customThemes.find((item) => item.id === theme.id);
  if (!existing) throw new Error(`Custom theme not found: ${theme.id}`);
  const normalized = normalizeTheme({ ...theme, builtIn: false, createdAt: existing.createdAt, updatedAt: Date.now() }, existing);
  normalized.builtIn = false;
  await setStartPageSettings({
    ...current,
    themes: {
      ...current.themes,
      customThemes: current.themes.customThemes.map((item) => item.id === theme.id ? normalized : item),
    },
  });
  return normalized;
}

export async function duplicateTheme(themeId: string): Promise<StartPageTheme> {
  const current = await getStartPageSettings();
  const source = getTheme(current, themeId);
  const now = Date.now();
  const duplicate: StartPageTheme = {
    ...cloneTheme(source),
    id: createThemeId(),
    name: `${source.name} copy`,
    builtIn: false,
    createdAt: now,
    updatedAt: now,
  };
  await setStartPageSettings({
    ...current,
    themes: { selectedThemeId: duplicate.id, customThemes: [...current.themes.customThemes, duplicate] },
  });
  return duplicate;
}

export async function deleteCustomTheme(themeId: string): Promise<void> {
  const current = await getStartPageSettings();
  if (getBuiltInTheme(themeId)) throw new Error("Built-in themes cannot be deleted");
  if (!current.themes.customThemes.some((theme) => theme.id === themeId)) return;
  const customThemes = current.themes.customThemes.filter((theme) => theme.id !== themeId);
  const selectedThemeId = current.themes.selectedThemeId === themeId
    ? DEFAULT_SETTINGS.themes.selectedThemeId
    : current.themes.selectedThemeId;
  await setStartPageSettings({ ...current, themes: { selectedThemeId, customThemes } });
}

export async function selectTheme(themeId: string): Promise<void> {
  const current = await getStartPageSettings();
  if (!getBuiltInTheme(themeId) && !current.themes.customThemes.some((theme) => theme.id === themeId)) {
    throw new Error(`Theme not found: ${themeId}`);
  }
  await setStartPageSettings({ ...current, themes: { ...current.themes, selectedThemeId: themeId } });
}

export async function importCustomTheme(value: unknown): Promise<{ theme: StartPageTheme; issues: ValidationIssue[] }> {
  const result = normalizeThemeBundle(value);
  if (result.issues.some((issue) => issue.messageKey === "validationInvalidThemeFile")) {
    throw new Error("Invalid Start Tab theme file");
  }
  const current = await getStartPageSettings();
  const now = Date.now();
  const theme: StartPageTheme = {
    ...result.value.theme,
    id: createThemeId(),
    builtIn: false,
    createdAt: now,
    updatedAt: now,
  };
  await setStartPageSettings({
    ...current,
    themes: { selectedThemeId: theme.id, customThemes: [...current.themes.customThemes, theme] },
  });
  return { theme, issues: result.issues };
}

export function exportCustomTheme(theme: StartPageTheme): ThemeBundle {
  return themeBundle(theme);
}
