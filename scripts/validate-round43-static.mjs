import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const build = await readFile("scripts/build.mjs", "utf8");
const lifecycle = await readFile("scripts/build-output-lifecycle.mjs", "utf8");
const watchHelper = await readFile("scripts/static-asset-watch.mjs", "utf8");
const outputHelper = await readFile("scripts/static-asset-output.mjs", "utf8");
const fixtures = await readFile("scripts/run-round43-fixtures.mjs", "utf8");
const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const watchGuide = await readFile("docs/watch-mode.md", "utf8");
const audit = await readFile("docs/audit-2026-08-03-round-43.md", "utf8");
const manualQa = await readFile("docs/manual-qa-round43.md", "utf8");

assert.match(build, /createStaticAssetWatchPlugin/);
assert.match(build, /if \(watch\) plugins\.unshift\(createStaticAssetWatchPlugin\(root, blockerOnly\)\)/);
assert.match(build, /\.\.\.\(watch \? \{ inject: \[STATIC_ASSET_WATCH_IMPORT\] \} : \{\}\)/);
assert.match(build, /Watching \$\{profile\} extension sources and static assets/);
assert.match(build, /createBuildOutputLifecyclePlugin/);
assert.match(lifecycle, /prepareGeneratedOutputs/);
assert.match(lifecycle, /build\.onStart/);
assert.match(outputHelper, /removePathWithinBoundary/);
assert.ok(outputHelper.includes('"icons"'), "Copied icon output must be included in exact static cleanup");
assert.ok(outputHelper.includes('"_locales"'), "Copied locale output must be included in exact static cleanup");
assert.match(outputHelper, /generatedOutputPaths\(blockerOnly\)/,
  "The lifecycle output set must include copied static trees before every rebuild");
assert.ok(
  build.indexOf("const outputLifecyclePlugin = createBuildOutputLifecyclePlugin")
    < build.indexOf("const plugins = [outputLifecyclePlugin]"),
  "The lifecycle plugin must be created before it is registered with esbuild",
);
assert.match(watchHelper, /watchFiles/);
assert.match(watchHelper, /watchDirs/);
assert.match(watchHelper, /directories\.push\(current\)/);
assert.match(watchHelper, /traversedDirectories/);
assert.ok(watchHelper.includes('path.join(root, "src", "_locales")'));
assert.ok(watchHelper.includes('path.join(root, "icons")'));
assert.match(watchHelper, /if \(!blockerOnly\)/);
assert.match(watchHelper, /entry\.isFile\(\)/);
assert.match(watchHelper, /Static asset trees must contain regular files and directories only/);
assert.match(fixtures, /Full watch set is missing/);
assert.match(fixtures, /Blocker watch set must omit/);
assert.match(fixtures, /Every traversed directory must be watched/);
assert.match(fixtures, /start-tab-static-assets/);
assert.match(fixtures, /esbuildBuild/);
assert.match(fixtures, /real esbuild build/);

for (const command of [
  "node scripts/run-round42-fixtures.mjs",
  "node scripts/validate-round42-static.mjs",
  "node scripts/run-round43-fixtures.mjs",
  "node scripts/validate-round43-static.mjs",
]) {
  assert.ok(workflow.includes(command), `CI must execute ${command} explicitly`);
  assert.ok(packageJson.scripts.test.includes(command), `npm test must execute ${command}`);
}
assert.ok(
  workflow.indexOf("node scripts/validate-round41-static.mjs")
    < workflow.indexOf("node scripts/run-round42-fixtures.mjs")
    && workflow.indexOf("node scripts/run-round42-fixtures.mjs")
      < workflow.indexOf("node scripts/validate-round42-static.mjs")
    && workflow.indexOf("node scripts/validate-round42-static.mjs")
      < workflow.indexOf("node scripts/run-round43-fixtures.mjs")
    && workflow.indexOf("node scripts/run-round43-fixtures.mjs")
      < workflow.indexOf("node scripts/validate-round43-static.mjs"),
  "The latest regression rounds must run explicitly and in order",
);
assert.match(watchGuide, /npm run watch/);
assert.match(watchGuide, /HTML, CSS, manifest, locale, icon, and early gate changes/);
assert.match(watchGuide, /blocker-only/);
assert.match(audit, /static asset/);
assert.match(audit, /Round 42/);
assert.match(audit, /stale copied file/);
assert.match(manualQa, /npm run watch/);
assert.match(manualQa, /newtab-gate\.js/);

console.log("Round 43 static validation passed");
