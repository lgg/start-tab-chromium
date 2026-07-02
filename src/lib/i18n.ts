export const SUPPORTED_LOCALES = ["en", "ru"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type LocalePreference = SupportedLocale | "auto";

const DEFAULT_LOCALE: SupportedLocale = "en";
const LOCALE_OVERRIDE_KEY = "localeOverride";

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

async function readLocaleOverride(): Promise<SupportedLocale | null> {
  const items = await chrome.storage.local.get(LOCALE_OVERRIDE_KEY);
  const value = items[LOCALE_OVERRIDE_KEY];
  return typeof value === "string" ? normalizeLocale(value) : null;
}

export async function getLocalePreference(): Promise<LocalePreference> {
  return (await readLocaleOverride()) ?? "auto";
}

export async function setLocalePreference(preference: LocalePreference): Promise<void> {
  if (preference === "auto") {
    await chrome.storage.local.remove(LOCALE_OVERRIDE_KEY);
    return;
  }
  await chrome.storage.local.set({ [LOCALE_OVERRIDE_KEY]: preference });
}

function browserLanguages(): string[] {
  const languages = Array.isArray(navigator.languages) ? navigator.languages : [];
  return languages.length > 0 ? [...languages] : [navigator.language].filter(Boolean);
}

async function detectLocale(): Promise<SupportedLocale> {
  const override = await readLocaleOverride();
  if (override) return override;

  for (const language of browserLanguages()) {
    const supported = normalizeLocale(language);
    if (supported) return supported;
  }

  return DEFAULT_LOCALE;
}

async function loadCatalog(locale: SupportedLocale): Promise<LocaleCatalog> {
  const response = await fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`));
  if (!response.ok) throw new Error(`Unable to load locale catalog: ${locale}`);
  return (await response.json()) as LocaleCatalog;
}

function renderTemplate(template: string, replacements: Record<string, string | number>): string {
  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.split(`{${key}}`).join(String(value));
  }
  return result;
}

export async function loadI18n(): Promise<I18n> {
  const locale = await detectLocale();
  const defaultCatalog = await loadCatalog(DEFAULT_LOCALE);
  const catalog = locale === DEFAULT_LOCALE
    ? defaultCatalog
    : { ...defaultCatalog, ...(await loadCatalog(locale)) };

  document.documentElement.lang = locale;

  const t = (key: string, replacements: Record<string, string | number> = {}): string => {
    const template = catalog[key]?.message ?? key;
    return renderTemplate(template, replacements);
  };

  return {
    locale,
    t,
    list: (key: string) => t(key).split("|").filter(Boolean),
  };
}
