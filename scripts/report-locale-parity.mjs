import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  assertLocaleParity,
  buildLocaleParityReport,
} from "./locale-catalog-validation.mjs";

const genericReport = await buildLocaleParityReport(path.join("src", "_locales"), "en", "ru");

// Preserve the long-standing report field names for tooling/readability while
// adding the schema and runtime-template checks that make this a real validator.
const report = {
  englishCount: genericReport.sourceCount,
  russianCount: genericReport.targetCount,
  englishFiles: genericReport.sourceFiles,
  russianFiles: genericReport.targetFiles,
  duplicateEnglishKeys: genericReport.duplicateSourceKeys,
  duplicateRussianKeys: genericReport.duplicateTargetKeys,
  missingRussianKeys: genericReport.missingTargetKeys,
  extraRussianKeys: genericReport.extraTargetKeys,
  schemaErrors: genericReport.schemaErrors,
  placeholderMismatches: genericReport.placeholderMismatches,
};

// Keep the diagnostic report even when validation fails so CI/local failures
// have a structured artifact to inspect. assertLocaleParity() is intentionally
// called only after the report is written and printed.
await writeFile("locale-parity-report.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
assertLocaleParity(genericReport);
