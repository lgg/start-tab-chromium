import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const build = await readFile("scripts/build.mjs", "utf8");
const finalization = await readFile("scripts/static-asset-finalization.mjs", "utf8");
const watchHelper = await readFile("scripts/static-asset-watch.mjs", "utf8");
const outputHelper = await readFile("scripts/static-asset-output.mjs", "utf8");
const outputPath = await readFile("scripts/build-output-path.mjs", "utf8");
const fixtures = await readFile("scripts/run-round48-fixtures.mjs", "utf8");
const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const selfHosted = await readFile("scripts/validate-self-hosted-ci.mjs", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const watchGuide = await readFile("docs/watch-mode.md", "utf8");
const audit = await readFile("docs/audit-2026-08-11-round-48.md", "utf8");
const manualQa = await readFile("docs/manual-qa-round48.md", "utf8");

assert.match(build, /createStaticOutputWriter/);
assert.match(build, /const staticOutputWriter = createStaticOutputWriter/);
assert.match(build, /await assertValidStaticAssetTrees\(root, blockerOnly\)/);
assert.match(build, /await staticOutputWriter\.copyBatch\(commonFiles\)/);
assert.match(build, /await staticOutputWriter\.writeOne\(output\("manifest\.json"\)/);
assert.doesNotMatch(build, /Promise\.all\(commonFiles/,
  "Static file batches must not reject while sibling copies are still running");

assert.match(finalization, /async function guard\(\)[\s\S]*assertSafe\(root, temporaryRoot, outdir\)/,
  "Every static writer operation must own a fresh output guard");
assert.match(finalization, /async function copyOne[\s\S]*await guard\(\);[\s\S]*await copyFile/);
assert.match(finalization, /async function copyBatch\(entries\)[\s\S]*for \(const entry of entries\)[\s\S]*await copyOne/,
  "Static copy batches must settle sequentially before exposing failures");
assert.match(finalization, /async function writeOne[\s\S]*await guard\(\);[\s\S]*await writeFileValue/);

assert.match(watchHelper, /async function inspectExplicitStaticFiles\(files\)/);
assert.match(watchHelper, /const status = await lstat\(file\)/);
assert.match(watchHelper, /if \(!status\.isFile\(\)\) invalidPaths\.push\(file\)/);
assert.match(watchHelper, /const missingFiles = \[\]/);
assert.match(watchHelper, /Required static asset file is missing/);
assert.match(watchHelper, /explicit assets must be regular files/);
assert.match(watchHelper, /return \{ watchFiles, watchDirs, missingDirectories, missingFiles, invalidPaths \}/);

assert.match(outputPath, /export function trustedBuildOutputRoot/);
assert.match(outputHelper, /const trustedRoot = trustedBuildOutputRoot\(root, temporaryRoot, outdir\)/);
assert.match(outputHelper, /removePathWithinBoundary\(trustedRoot, path\.join\(outdir, relativePath\)\)/,
  "Generated child cleanup must inspect outdir as an intermediate path from the trusted root");
assert.doesNotMatch(outputHelper, /removePathWithinBoundary\(outdir, relativePath\)/,
  "Mutable outdir must not be treated as the cleanup trust boundary");

for (const marker of [
  "Explicit static symlink/junction must be rejected as an invalid filesystem path",
  "Recreating a missing explicit static file must recover the same watch process automatically",
  "Output replacement after source validation must be rejected before the first static copy",
  "Serialized static batch must wait for the delayed copy before exposing the later failure",
  "No in-flight static writer may recreate output after failure cleanup has completed",
]) {
  assert.ok(fixtures.includes(marker), `Round 48 fixture is missing: ${marker}`);
}
assert.match(fixtures, /esbuildContext/);
assert.match(fixtures, /esbuildBuild/);
assert.match(fixtures, /process\.platform === "win32"/);

for (const command of [
  "node scripts/run-round48-fixtures.mjs",
  "node scripts/validate-round48-static.mjs",
]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test is missing ${command}`);
  assert.ok(workflow.includes(command), `CI is missing ${command}`);
  assert.ok(selfHosted.includes(command), `Self-hosted CI contract is missing ${command}`);
}
assert.ok(
  workflow.indexOf("node scripts/validate-round47-static.mjs")
    < workflow.indexOf("node scripts/run-round48-fixtures.mjs")
    && workflow.indexOf("node scripts/run-round48-fixtures.mjs")
      < workflow.indexOf("node scripts/validate-round48-static.mjs")
    && workflow.indexOf("node scripts/validate-round48-static.mjs")
      < workflow.indexOf("node scripts/validate-self-hosted-ci.mjs"),
  "Round 48 must run explicitly after Round 47 and before the CI contract",
);

assert.match(watchGuide, /Explicit assets such as `manifest\.json`/);
assert.match(watchGuide, /Static output writes are serialized and guarded individually/);
assert.match(watchGuide, /trusted repository\/temporary root/);
assert.match(audit, /Promise\.all/);
assert.match(audit, /explicit static files/i);
assert.match(audit, /cleanup boundary/i);
assert.match(manualQa, /missing required static file/i);
assert.match(manualQa, /intentionally slow/i);

console.log("Round 48 static validation passed");
