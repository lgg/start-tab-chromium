import { commitStorageMutationWithRevision } from "./data-revision.js";
import { withStorageLock } from "./storage-lock.js";

export const SUPPORTED_LOCALES = ["en", "ru"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type LocalePreference = SupportedLocale | "auto";

const DEFAULT_LOCALE: SupportedLocale = "en";
export const LOCALE_OVERRIDE_KEY = "localeOverride";

export interface LocaleChange {
  expected: LocalePreference;
  preference: LocalePreference;
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === "auto" || value === "en" || value === "ru";
}

type LocaleCatalog = Record<string, { message: string }>;

export interface I18n {
  locale: SupportedLocale;
  t: (key: string, replacements?: Record<string, string | number>) => string;
  list: (key: string) => string[];
}

function normalizeLocale(locale: string): SupportedLocale | null {
  const language = locale.toLowerCase().replace("_", "-").split("-")[0];
  return SUPPORTED_LOCALES.find((supported) => supported === language) ?? null;
}

export function localePreferenceFromStored(value: unknown): LocalePreference {
  return (typeof value === "string" ? normalizeLocale(value) : null) ?? "auto";
}

export async function getLocalePreference(): Promise<LocalePreference> {
  const items = await chrome.storage.local.get(LOCALE_OVERRIDE_KEY);
  return localePreferenceFromStored(items[LOCALE_OVERRIDE_KEY]);
}

export function assertLocalePreference(current: unknown, expected: LocalePreference): void {
  if (localePreferenceFromStored(current) !== expected) {
    throw new Error("Start Tab language changed in another extension context; reload before saving");
  }
}

/** Call only inside a data-write transaction that snapshots the locale key. */
export async function writeLocalePreferenceInExistingTransaction(preference: LocalePreference): Promise<void> {
  if (!isLocalePreference(preference)) throw new Error("Unsupported locale preference");
  if (preference === "auto") await chrome.storage.local.remove(LOCALE_OVERRIDE_KEY);
  else await chrome.storage.local.set({ [LOCALE_OVERRIDE_KEY]: preference });
}

export async function setLocalePreference(preference: LocalePreference, expected?: LocalePreference): Promise<void> {
  await withStorageLock("data-write", async () => {
    if (expected !== undefined) {
      const current = await chrome.storage.local.get(LOCALE_OVERRIDE_KEY);
      assertLocalePreference(current[LOCALE_OVERRIDE_KEY], expected);
    }
    await commitStorageMutationWithRevision([LOCALE_OVERRIDE_KEY], () => writeLocalePreferenceInExistingTransaction(preference));
  });
}

function browserLanguages(): string[] {
  const languages = Array.isArray(navigator.languages) ? navigator.languages : [];
  return languages.length > 0 ? [...languages] : [navigator.language].filter(Boolean);
}

function detectLocale(preference: LocalePreference): SupportedLocale {
  if (preference !== "auto") return preference;
  for (const language of browserLanguages()) {
    const supported = normalizeLocale(language);
    if (supported) return supported;
  }
  return DEFAULT_LOCALE;
}

async function fetchCatalog(path: string, required: boolean): Promise<LocaleCatalog> {
  try {
    const response = await fetch(chrome.runtime.getURL(path));
    if (!response.ok) throw new Error(`Unable to load locale catalog: ${path}`);
    const catalog: unknown = await response.json();
    if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
      throw new Error(`Invalid locale catalog: ${path}`);
    }
    // Invalid entries must not shadow a valid lower-priority translation
    // or reach renderTemplate as a non-string.
    const entries = Object.entries(catalog).filter(([, entry]) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
      && typeof entry.message === "string" && entry.message.trim().length > 0);
    return Object.fromEntries(entries) as LocaleCatalog;
  } catch (error) {
    // Optional catalog failures (including network/JSON errors) must not
    // disable the entire extension page or discard a valid base locale.
    if (required) throw error;
    return {};
  }
}

async function loadCatalog(locale: SupportedLocale): Promise<LocaleCatalog> {
  const base = await fetchCatalog(`_locales/${locale}/messages.json`, true);
  const roadmap = await fetchCatalog(`_locales/${locale}/roadmap-messages.json`, false);
  const round7 = await fetchCatalog(`_locales/${locale}/round7-messages.json`, false);
  return { ...base, ...roadmap, ...round7 };
}

async function mergeCatalogs(locale: SupportedLocale, defaultCatalog: LocaleCatalog): Promise<{ locale: SupportedLocale; catalog: LocaleCatalog }> {
  if (locale === DEFAULT_LOCALE) return { locale, catalog: defaultCatalog };
  try {
    return { locale, catalog: { ...defaultCatalog, ...(await loadCatalog(locale)) } };
  } catch {
    return { locale: DEFAULT_LOCALE, catalog: defaultCatalog };
  }
}

export function renderTemplate(template: string, replacements: Record<string, string | number>): string {
  // Replace placeholders in the source template only. Inserted user text
  // must remain literal even when it contains another placeholder.
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, key: string) =>
    Object.hasOwn(replacements, key) ? String(replacements[key]) : placeholder);
}

export async function loadI18n(): Promise<I18n & { preference: LocalePreference }> {
  return loadI18nForPreference(await withStorageLock("data-write", getLocalePreference));
}

/** Use the preference captured with a committed view snapshot rather than
 * independently reading storage and mixing two different generations. */
export async function loadI18nForPreference(preference: LocalePreference): Promise<I18n & { preference: LocalePreference }> {
  const preferredLocale = detectLocale(preference);
  const defaultCatalog = await loadCatalog(DEFAULT_LOCALE);
  const { locale, catalog } = await mergeCatalogs(preferredLocale, defaultCatalog);
  document.documentElement.lang = locale;
  const t = (key: string, replacements: Record<string, string | number> = {}): string => {
    const template = Object.hasOwn(catalog, key) ? catalog[key]?.message ?? key : key;
    return renderTemplate(template, replacements);
  };
  return { locale, preference, t, list: (key: string) => t(key).split("|").filter(Boolean) };
}
