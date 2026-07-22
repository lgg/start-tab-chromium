import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function readLocaleCatalog(locale) {
  const directory = path.join("src", "_locales", locale);
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".json"))
    .sort();
  const catalog = {};
  const duplicateKeys = [];
  for (const file of files) {
    const value = JSON.parse(await readFile(path.join(directory, file), "utf8"));
    for (const [key, message] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(catalog, key)) duplicateKeys.push(key);
      catalog[key] = message;
    }
  }
  return { catalog, files, duplicateKeys: [...new Set(duplicateKeys)].sort() };
}

const [englishSource, russianSource] = await Promise.all([
  readLocaleCatalog("en"),
  readLocaleCatalog("ru"),
]);
const englishKeys = Object.keys(englishSource.catalog).sort();
const russianKeys = Object.keys(russianSource.catalog).sort();
const report = {
  englishCount: englishKeys.length,
  russianCount: russianKeys.length,
  englishFiles: englishSource.files,
  russianFiles: russianSource.files,
  duplicateEnglishKeys: englishSource.duplicateKeys,
  duplicateRussianKeys: russianSource.duplicateKeys,
  missingRussianKeys: englishKeys.filter((key) => !Object.prototype.hasOwnProperty.call(russianSource.catalog, key)),
  extraRussianKeys: russianKeys.filter((key) => !Object.prototype.hasOwnProperty.call(englishSource.catalog, key)),
};
await writeFile("locale-parity-report.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
