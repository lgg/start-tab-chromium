import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [syncSource, newtabSource, schedulerSource, editorSource, optionsSource, packageJson] = await Promise.all([
  readFile(new URL("../src/lib/chrome-sync.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/newtab/newtab.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/newtab/render-scheduler.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/newtab/layout-editor.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/options/options.ts", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

assert.match(syncSource, /JSON\.stringify\(value\)/, "Sync chunk sizing must include JSON string escaping");
assert.match(syncSource, /QUOTA_BYTES_PER_ITEM/, "Sync chunk sizing must use the browser's current per-item quota");
assert.doesNotMatch(syncSource, /CHUNK_MAX_BYTES\s*=\s*7000/, "Raw UTF-8 chunk sizing must not return");
assert.match(newtabSource, /RenderScheduler/, "New-tab rendering must use the upgradeable serialized scheduler");
assert.match(schedulerSource, /if \(refresh\) this\.refreshRequested = true/, "A later refresh must upgrade an already queued render");
assert.match(schedulerSource, /this\.job\.catch\(\(\) => undefined\)\.then\(operation\)/, "Async refresh/render work must remain serialized and recoverable");
assert.match(editorSource, /onError: \(error: unknown\) => void/, "Layout editor async failures must have a visible error channel");
assert.doesNotMatch(editorSource, /=> void this\.(?:save|configure)\(/, "Layout editor actions must not create unhandled rejections");
assert.match(optionsSource, /const generation = \+\+renderGeneration/, "Options renders must identify their async generation");
assert.match(optionsSource, /generation !== renderGeneration/, "Stale async option sections must be discarded");
assert.doesNotMatch(optionsSource, /=> void \(async \(\) =>/, "Options async dialogs must use the shared error reporter");
const parsedPackage = JSON.parse(packageJson);
assert.match(parsedPackage.scripts.test, /run-round12-fixtures/);
assert.match(parsedPackage.scripts.test, /validate-round12-static/);

console.log("Round 12 static validation passed");
