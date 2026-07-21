import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/apply-round30.mjs";
const source = await readFile(path, "utf8");
const before = "\\`${BLOCKED_PAGE}?site=\\${encodeURIComponent(host)}\\`";
const after = "\\`\\${BLOCKED_PAGE}?site=\\${encodeURIComponent(host)}\\`";
const occurrences = source.split(before).length - 1;
if (occurrences !== 2) {
  throw new Error(`Expected exactly two Round 30 BLOCKED_PAGE applicator placeholders, found ${occurrences}`);
}
await writeFile(path, source.replaceAll(before, after), "utf8");
console.log("Round 30 applicator placeholders repaired");
