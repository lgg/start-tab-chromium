import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const build = await readFile("scripts/build.mjs", "utf8");
const lifecycle = await readFile("scripts/build-output-lifecycle.mjs", "utf8");
const outputHelper = await readFile("scripts/static-asset-output.mjs", "utf8");
const fixtures = await readFile("scripts/run-round44-fixtures.mjs", "utf8");
const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const watchGuide = await readFile("docs/watch-mode.md", "utf8");
const audit = await readFile("docs/audit-2026-08-03-round-44.md", "utf8");
const manualQa = await readFile("docs/manual-qa-round44.md", "utf8");

assert.match(build, /import \{ createBuildOutputLifecyclePlugin \} from "\.\/build-output-lifecycle\.mjs"/);
assert.match(build, /const outputLifecyclePlugin = createBuildOutputLifecyclePlugin\(\{/);
assert.match(build, /copyStaticAssets,/);
assert.match(lifecycle, /prepareGeneratedOutputs/);
assert.match(lifecycle, /build\.onStart/);
assert.ok(
  build.indexOf("const outputLifecyclePlugin = createBuildOutputLifecyclePlugin")
    < build.indexOf("await esbuild.build(options)"),
  "Every generated destination must be delegated to lifecycle cleanup before esbuild starts",
);
assert.doesNotMatch(build, /rm\(output\("icons"\)/,
  "Static output cleanup must be centralized in the bounded helper");
assert.doesNotMatch(build, /rm\(output\("_locales"\)/,
  "Static output cleanup must be centralized in the bounded helper");

assert.match(outputHelper, /assertSafeBuildOutputFilesystem/);
assert.equal((outputHelper.match(/await assertSafeBuildOutputFilesystem/g) ?? []).length, 2,
  "Output safety must be checked before and after recreating the output directory");
assert.match(outputHelper, /await mkdir\(outdir, \{ recursive: true \}\)/);
assert.match(outputHelper, /await removePathWithinBoundary\(outdir, relativePath\)/);
assert.match(outputHelper, /prepareOutputPaths\(root, temporaryRoot, outdir, staticAssetOutputPaths\(blockerOnly\)\)/);
assert.match(outputHelper, /generatedOutputPaths\(blockerOnly\)/,
  "The stronger lifecycle cleanup must include the complete Round 44 static output set");
for (const output of [
  "popup.html",
  "popup.css",
  "blocked.html",
  "blocked.css",
  "options.html",
  "options.css",
  "shared-ui.css",
  "icons",
  "_locales",
  "manifest.json",
  "newtab.html",
  "newtab.css",
  "newtab-gate.js",
]) {
  assert.ok(outputHelper.includes(`"${output}"`), `Exact static output list is missing ${output}`);
}

assert.match(fixtures, /Full static preparation must remove stale output/);
assert.match(fixtures, /Blocker-only preparation must remove shared output/);
assert.match(fixtures, /Blocker-only preparation must not mutate new-tab output/);
assert.match(fixtures, /final output junction/);
assert.match(fixtures, /external data must survive/);
assert.match(fixtures, /replaced with a link after startup/);

for (const command of [
  "node scripts/run-round44-fixtures.mjs",
  "node scripts/validate-round44-static.mjs",
]) {
  assert.ok(workflow.includes(command), `CI must execute ${command} explicitly`);
  assert.ok(packageJson.scripts.test.includes(command), `npm test must execute ${command}`);
}
assert.ok(
  workflow.indexOf("node scripts/validate-round43-static.mjs")
    < workflow.indexOf("node scripts/run-round44-fixtures.mjs")
    && workflow.indexOf("node scripts/run-round44-fixtures.mjs")
      < workflow.indexOf("node scripts/validate-round44-static.mjs")
    && workflow.indexOf("node scripts/validate-round44-static.mjs")
      < workflow.indexOf("node scripts/validate-self-hosted-ci.mjs"),
  "Round 44 must run explicitly after Round 43 and before the CI contract",
);
assert.match(watchGuide, /removes every generated static target before copying/);
assert.match(watchGuide, /stale generated file/);
assert.match(audit, /long-running watch/);
assert.match(audit, /junction or symbolic link/);
assert.match(manualQa, /old `build\/newtab-gate\.js` is no longer present/);
assert.match(manualQa, /whole `build\/` directory/);

console.log("Round 44 static validation passed");
