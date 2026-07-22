import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const limits = read("src/lib/platform-limits.ts");
const runtimeRenderer = read("src/newtab/block-renderers-runtime.ts");
const runtime = read("src/lib/start-page-runtime.ts");
const messages = read("src/lib/messages.ts");
const worker = read("src/service-worker.ts");
const integrations = read("src/newtab/block-renderers-integrations.ts");
const options = read("src/options/options.ts");
const editor = read("src/lib/block-settings-editor.ts");
const readme = read("README.md");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");
const selfHostedValidation = read("scripts/validate-self-hosted-ci.mjs");

assert.match(limits, /export const MAX_NOTE_LENGTH = 200_000/,
  "The note capacity must be a shared platform limit");
for (const source of [runtimeRenderer, runtime, messages, worker]) {
  assert.ok(source.includes("MAX_NOTE_LENGTH"), "Every note persistence boundary must consume the shared limit");
  assert.doesNotMatch(source, /200_000/, "Feature code must not duplicate the note limit literal");
}
assert.match(runtimeRenderer, /textarea\.maxLength = MAX_NOTE_LENGTH/,
  "The note editor must prevent text that persistence would discard");

assert.match(integrations,
  /if \(!block\.config\.city\.trim\(\)\) return \{ latitude: block\.config\.latitude, longitude: block\.config\.longitude \};[\s\S]*if \(!geocoded\) throw new Error/,
  "Configured cities must not silently display coordinate fallback weather under the wrong label");
assert.doesNotMatch(integrations, /geocodeCity\([^\n]+\)\.catch\(\(\) => null\)/,
  "Geocoding failures must reach the weather unavailable state");

assert.match(integrations, /export function visibleWebUrlItems[\s\S]*safeWebUrl\(item\.url\)/,
  "History and browser-pinned entries must cross the shared HTTP(S) URL boundary");
assert.match(integrations, /recentHistory[\s\S]*visibleWebUrlItems\(items, maxResults\)/);
assert.match(integrations, /browserPinnedTabs[\s\S]*visibleWebUrlItems\(tabs\)/);

assert.match(options, /const localeChanged = locale\.value !== localePreference/);
assert.match(options, /if \(localeChanged\) \{[\s\S]*await setLocalePreference[\s\S]*location\.reload\(\)/,
  "Switching back to automatic locale detection must apply immediately");
assert.doesNotMatch(options, /locale\.value !== "auto"\) location\.reload/);

assert.match(editor, /function providersEditor\([\s\S]*onChange: \(providers: SearchProvider\[\]\) => void/,
  "The search provider collection must publish live changes");
assert.match(editor, /for \(const input of \[id, title, url\]\) input\.addEventListener\("input", notify\)/);
assert.match(editor, /remove\.addEventListener\("click", \(\) => \{ row\.remove\(\); notify\(\); \}\)/);
assert.match(editor, /provider\.replaceChildren\([\s\S]*provider\.selectedIndex = providerSelectionIndexAfterEdit/,
  "The default-provider select must remain valid while providers are edited");

assert.ok(readme.includes("Sectioned Options page with persistent navigation"),
  "README must describe the actual Options navigation model");
assert.ok(!readme.includes("Tabbed options page"));

for (const command of ["node scripts/run-round33-fixtures.mjs", "node scripts/validate-round33-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test is missing ${command}`);
  assert.ok(workflow.includes(command), `CI is missing ${command}`);
  assert.ok(selfHostedValidation.includes(command), `Self-hosted CI contract is missing ${command}`);
}

console.log("Round 33 static validation passed");
