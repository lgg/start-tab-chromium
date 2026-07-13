export { normalizeBlockConfig } from "./start-page-block-validation.js";
export {
  hasBlockUserData,
  isFutureStartPageSchema,
  normalizeStartPageSettings,
  normalizeStartPageSettingsWithReport,
  validateStartPageSettings,
} from "./start-page-settings-validation.js";
export {
  migrateLegacyTheme,
  normalizeCustomThemes,
  normalizeTheme,
  normalizeThemeBundle,
  themeBundle,
} from "./start-page-theme-validation.js";
export {
  isBlockType,
  isRecord,
  safeWebUrl,
  safeWebUrlTemplate,
} from "./start-page-validation-primitives.js";
