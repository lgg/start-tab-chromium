import {
  DEFAULT_SETTINGS,
  cloneTheme,
  createThemeId,
  getBuiltInTheme,
  getTheme,
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
  ValidationIssue,
} from "./start-page-types.js";

interface ThemeSettingsPersistence {
  get(): Promise<StartPageSettings>;
  set(value: StartPageSettings): Promise<ValidationIssue[]>;
}

let persistence: ThemeSettingsPersistence | null = null;

/** Configure persistence without creating a circular module dependency. */
export function configureThemeSettingsPersistence(value: ThemeSettingsPersistence): void {
  persistence = value;
}

function themePersistence(): ThemeSettingsPersistence {
  if (!persistence) throw new Error("Theme settings persistence is not configured");
  return persistence;
}

export function createCustomThemeDraft(
  settings: StartPageSettings,
  name: string,
  sourceThemeId = settings.themes.selectedThemeId,
): StartPageTheme {
  const source = getTheme(settings, sourceThemeId);
  const now = Date.now();
  return {
    ...cloneTheme(source),
    id: createThemeId(),
    name: name.trim() || source.name,
    builtIn: false,
    createdAt: now,
    updatedAt: now,
  };
}

export async function saveNewCustomTheme(theme: StartPageTheme): Promise<StartPageTheme> {
  const current = await themePersistence().get();
  const now = Date.now();
  const fallback = cloneTheme(getTheme(current));
  fallback.id = theme.id;
  fallback.builtIn = false;
  const normalized = normalizeTheme({ ...theme, builtIn: false, updatedAt: now }, fallback);
  normalized.id = getBuiltInTheme(normalized.id) || current.themes.customThemes.some((item) => item.id === normalized.id)
    ? createThemeId()
    : normalized.id;
  normalized.builtIn = false;
  normalized.createdAt = now;
  normalized.updatedAt = now;
  await themePersistence().set({
    ...current,
    themes: { selectedThemeId: normalized.id, customThemes: [...current.themes.customThemes, normalized] },
  });
  return normalized;
}

export async function createCustomTheme(name: string, sourceThemeId?: string): Promise<StartPageTheme> {
  const current = await themePersistence().get();
  return createCustomThemeDraft(current, name, sourceThemeId);
}

export async function updateCustomTheme(theme: StartPageTheme): Promise<StartPageTheme> {
  const current = await themePersistence().get();
  if (getBuiltInTheme(theme.id)) throw new Error("Built-in themes cannot be edited");
  const existing = current.themes.customThemes.find((item) => item.id === theme.id);
  if (!existing) return saveNewCustomTheme(theme);
  const normalized = normalizeTheme({
    ...theme,
    builtIn: false,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  }, existing);
  normalized.builtIn = false;
  await themePersistence().set({
    ...current,
    themes: {
      ...current.themes,
      customThemes: current.themes.customThemes.map((item) => item.id === theme.id ? normalized : item),
    },
  });
  return normalized;
}

export async function duplicateTheme(themeId: string, name?: string): Promise<StartPageTheme> {
  const current = await themePersistence().get();
  const source = getTheme(current, themeId);
  const now = Date.now();
  const duplicate: StartPageTheme = {
    ...cloneTheme(source),
    id: createThemeId(),
    name: name?.trim() || source.name,
    builtIn: false,
    createdAt: now,
    updatedAt: now,
  };
  await themePersistence().set({
    ...current,
    themes: { selectedThemeId: duplicate.id, customThemes: [...current.themes.customThemes, duplicate] },
  });
  return duplicate;
}

export async function deleteCustomTheme(themeId: string): Promise<void> {
  const current = await themePersistence().get();
  if (getBuiltInTheme(themeId)) throw new Error("Built-in themes cannot be deleted");
  if (!current.themes.customThemes.some((theme) => theme.id === themeId)) return;
  const customThemes = current.themes.customThemes.filter((theme) => theme.id !== themeId);
  const selectedThemeId = current.themes.selectedThemeId === themeId
    ? DEFAULT_SETTINGS.themes.selectedThemeId
    : current.themes.selectedThemeId;
  await themePersistence().set({ ...current, themes: { selectedThemeId, customThemes } });
}

export async function selectTheme(themeId: string): Promise<void> {
  const current = await themePersistence().get();
  if (!getBuiltInTheme(themeId) && !current.themes.customThemes.some((theme) => theme.id === themeId)) {
    throw new Error(`Theme not found: ${themeId}`);
  }
  await themePersistence().set({ ...current, themes: { ...current.themes, selectedThemeId: themeId } });
}

export async function importCustomTheme(value: unknown): Promise<{ theme: StartPageTheme; issues: ValidationIssue[] }> {
  const result = normalizeThemeBundle(value);
  if (result.issues.some((issue) => issue.messageKey === "validationInvalidThemeFile")) {
    throw new Error("Invalid Start Tab theme file");
  }
  const current = await themePersistence().get();
  const now = Date.now();
  const theme: StartPageTheme = {
    ...result.value.theme,
    id: createThemeId(),
    builtIn: false,
    createdAt: now,
    updatedAt: now,
  };
  await themePersistence().set({
    ...current,
    themes: { selectedThemeId: theme.id, customThemes: [...current.themes.customThemes, theme] },
  });
  return { theme, issues: result.issues };
}

export function exportCustomTheme(theme: StartPageTheme): ThemeBundle {
  return themeBundle(theme);
}
