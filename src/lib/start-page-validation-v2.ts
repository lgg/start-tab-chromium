import {
  normalizeStartPageSettings as normalizeSettings,
  normalizeStartPageSettingsWithReport as normalizeSettingsWithReport,
  validateStartPageSettings as validateSettings,
} from "./start-page-validation.js";
import type { StartPageSettings, ValidationResult } from "./start-page-types.js";
import { isRecord } from "./start-page-validation-primitives.js";

function withLegacyConfigDiscriminators(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.layout) || !Array.isArray(value.layout.blocks)) return value;
  return {
    ...value,
    layout: {
      ...value.layout,
      blocks: value.layout.blocks.map((candidate) => {
        if (!isRecord(candidate) || typeof candidate.type !== "string" || !isRecord(candidate.config) || typeof candidate.config.type === "string") {
          return candidate;
        }
        return { ...candidate, config: { ...candidate.config, type: candidate.type } };
      }),
    },
  };
}

export function normalizeStartPageSettings(value: unknown): StartPageSettings {
  return normalizeSettings(withLegacyConfigDiscriminators(value));
}

export function normalizeStartPageSettingsWithReport(value: unknown): ReturnType<typeof normalizeSettingsWithReport> {
  return normalizeSettingsWithReport(withLegacyConfigDiscriminators(value));
}

export function validateStartPageSettings(value: unknown): ValidationResult<StartPageSettings> {
  return validateSettings(withLegacyConfigDiscriminators(value));
}

export {
  hasBlockUserData,
  isFutureStartPageSchema,
  normalizeBlockConfig,
  normalizeTheme,
  normalizeThemeBundle,
  safeWebUrl,
  safeWebUrlTemplate,
  themeBundle,
} from "./start-page-validation.js";
export { isBlockType, isRecord } from "./start-page-validation-primitives.js";
