import { readFile, writeFile } from "node:fs/promises";

async function readJson(path, optional = false) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (optional && error && typeof error === "object" && error.code === "ENOENT") return {};
    throw error;
  }
}

const [english, russianBase, russianRoadmap] = await Promise.all([
  readJson("src/_locales/en/messages.json"),
  readJson("src/_locales/ru/messages.json"),
  readJson("src/_locales/ru/roadmap-messages.json", true),
]);
const russian = { ...russianBase, ...russianRoadmap };
const englishKeys = Object.keys(english).sort();
const russianKeys = Object.keys(russian).sort();
const report = {
  englishCount: englishKeys.length,
  russianCount: russianKeys.length,
  missingRussianKeys: englishKeys.filter((key) => !Object.prototype.hasOwnProperty.call(russian, key)),
  extraRussianKeys: russianKeys.filter((key) => !Object.prototype.hasOwnProperty.call(english, key)),
};
await writeFile("locale-parity-report.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
