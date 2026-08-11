import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function placeholders(message) {
  const values = new Set();
  for (const match of message.matchAll(/\{([A-Za-z0-9_]+)\}/g)) values.add(match[1]);
  return [...values].sort();
}

export async function readLocaleCatalog(localesRoot, locale) {
  const directory = path.join(localesRoot, locale);
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".json"))
    .sort();
  const catalog = {};
  const duplicateKeys = [];
  const schemaErrors = [];

  for (const file of files) {
    const source = path.join(directory, file);
    const value = JSON.parse(await readFile(source, "utf8"));
    if (!isRecord(value)) {
      schemaErrors.push(`${locale}/${file}: catalog root must be an object`);
      continue;
    }

    for (const [key, entry] of Object.entries(value)) {
      if (own(catalog, key)) duplicateKeys.push(key);
      catalog[key] = entry;
      if (!isRecord(entry)) {
        schemaErrors.push(`${locale}/${file}:${key}: entry must be an object`);
        continue;
      }
      if (typeof entry.message !== "string") {
        schemaErrors.push(`${locale}/${file}:${key}: message must be a string`);
        continue;
      }
      if (entry.message.trim().length === 0) {
        schemaErrors.push(`${locale}/${file}:${key}: message must not be empty`);
      }
    }
  }

  return {
    catalog,
    files,
    duplicateKeys: [...new Set(duplicateKeys)].sort(),
    schemaErrors: [...new Set(schemaErrors)].sort(),
  };
}

export async function buildLocaleParityReport(localesRoot, sourceLocale = "en", targetLocale = "ru") {
  const [source, target] = await Promise.all([
    readLocaleCatalog(localesRoot, sourceLocale),
    readLocaleCatalog(localesRoot, targetLocale),
  ]);
  const sourceKeys = Object.keys(source.catalog).sort();
  const targetKeys = Object.keys(target.catalog).sort();
  const missingTargetKeys = sourceKeys.filter((key) => !own(target.catalog, key));
  const extraTargetKeys = targetKeys.filter((key) => !own(source.catalog, key));
  const placeholderMismatches = [];

  for (const key of sourceKeys) {
    if (!own(target.catalog, key)) continue;
    const sourceMessage = source.catalog[key]?.message;
    const targetMessage = target.catalog[key]?.message;
    if (typeof sourceMessage !== "string" || typeof targetMessage !== "string") continue;
    const sourcePlaceholders = placeholders(sourceMessage);
    const targetPlaceholders = placeholders(targetMessage);
    if (sourcePlaceholders.join("\u0000") !== targetPlaceholders.join("\u0000")) {
      placeholderMismatches.push({
        key,
        sourcePlaceholders,
        targetPlaceholders,
      });
    }
  }

  return {
    sourceLocale,
    targetLocale,
    sourceCount: sourceKeys.length,
    targetCount: targetKeys.length,
    sourceFiles: source.files,
    targetFiles: target.files,
    duplicateSourceKeys: source.duplicateKeys,
    duplicateTargetKeys: target.duplicateKeys,
    missingTargetKeys,
    extraTargetKeys,
    schemaErrors: [...source.schemaErrors, ...target.schemaErrors].sort(),
    placeholderMismatches,
  };
}

export function localeParityErrors(report) {
  const errors = [];
  if (report.duplicateSourceKeys.length > 0) {
    errors.push(`Duplicate ${report.sourceLocale} locale keys: ${report.duplicateSourceKeys.join(", ")}`);
  }
  if (report.duplicateTargetKeys.length > 0) {
    errors.push(`Duplicate ${report.targetLocale} locale keys: ${report.duplicateTargetKeys.join(", ")}`);
  }
  if (report.missingTargetKeys.length > 0) {
    errors.push(`Missing ${report.targetLocale} locale keys: ${report.missingTargetKeys.join(", ")}`);
  }
  if (report.extraTargetKeys.length > 0) {
    errors.push(`Extra ${report.targetLocale} locale keys: ${report.extraTargetKeys.join(", ")}`);
  }
  errors.push(...report.schemaErrors.map((error) => `Locale schema error: ${error}`));
  for (const mismatch of report.placeholderMismatches) {
    errors.push(
      `Locale placeholder mismatch for ${mismatch.key}: ${report.sourceLocale}=[${mismatch.sourcePlaceholders.join(", ")}], ${report.targetLocale}=[${mismatch.targetPlaceholders.join(", ")}]`,
    );
  }
  return errors;
}

export function assertLocaleParity(report) {
  const errors = localeParityErrors(report);
  if (errors.length === 0) return;
  throw new AggregateError(errors.map((message) => new Error(message)), errors.join("\n"));
}
