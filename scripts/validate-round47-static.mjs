import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const build = await readFile("scripts/build.mjs", "utf8");
const lifecycle = await readFile("scripts/build-output-lifecycle.mjs", "utf8");
const outputHelper = await readFile("scripts/static-asset-output.mjs", "utf8");
const staticWatch = await readFile("scripts/static-asset-watch.mjs", "utf8");
const fixtures = await readFile("scripts/run-round47-fixtures.mjs", "utf8");
const selfHosted = await readFile("scripts/validate-self-hosted-ci.mjs", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const watchGuide = await readFile("docs/watch-mode.md", "utf8");
const audit = await readFile("docs/audit-2026-08-11-round-47.md", "utf8");
const manualQa = await readFile("docs/manual-qa-round47.md", "utf8");

assert.match(lifecycle, /import \{ assertSafeBuildOutputFilesystem \} from "\.\/build-output-path\.mjs"/,
  "Lifecycle must own a fresh filesystem-safety check before successful finalization");
const graphIndex = lifecycle.indexOf("assertGraph(result.metafile)");
const finalizationGuardIndex = lifecycle.indexOf("await assertSafeBuildOutputFilesystem(root, temporaryRoot, outdir)");
const copyIndex = lifecycle.indexOf("await copyStatic()");
assert.ok(graphIndex >= 0 && finalizationGuardIndex > graphIndex && copyIndex > finalizationGuardIndex,
  "Output filesystem safety must be revalidated after compilation and before static copy");
assert.match(lifecycle, /Build finalization failed and generated-output cleanup also failed/,
  "Late filesystem-safety failures must still use fail-closed cleanup handling");

assert.match(outputHelper, /export function generatedOutputCleanupPaths\(\)/);
assert.match(outputHelper, /return generatedOutputPaths\(false\)/,
  "Cleanup universe must include full-profile-only generated artifacts");
assert.match(outputHelper, /prepareGeneratedOutputs[\s\S]*generatedOutputCleanupPaths\(\)/,
  "Generated cleanup must not be narrowed by the current blocker-only profile");
assert.match(outputHelper, /full -> blocker-only profile transition cannot leave stale new-tab code/);

assert.match(staticWatch, /import \{ lstat, readdir \} from "node:fs\/promises"/,
  "Static inputs must be inspected without following links");
assert.match(staticWatch, /status = await lstat\(current\)/);
assert.match(staticWatch, /if \(!status\.isDirectory\(\)\)[\s\S]*invalidPaths\.push\(current\)/,
  "Wrong-type and linked recursive directory positions must become structured invalid paths");
assert.match(staticWatch, /invalidPaths\.push\(absolute\)/,
  "Nested links and special entries must fail structurally instead of aborting watch metadata collection");
assert.doesNotMatch(staticWatch, /throw new Error\(`Static asset trees must contain regular files and directories only/,
  "Nested special entries must not throw before recovery watch metadata can be returned");
assert.match(staticWatch, /return \{ watchFiles, watchDirs, missingDirectories, missingFiles, invalidPaths \}/,
  "Round 47 recursive recovery metadata must remain present after explicit-file validation is added");
assert.match(staticWatch, /export function staticAssetInputErrors\(inputs\)/);
assert.match(staticWatch, /export async function assertValidStaticAssetTrees\(root, blockerOnly = false\)/,
  "Shared static validation must remain reusable outside watch mode");
assert.match(staticWatch, /throw new AggregateError/,
  "One-shot static validation must fail the build when invalid inputs are found");
assert.match(staticWatch, /Static asset input contains an invalid filesystem path/);

assert.match(build, /assertValidStaticAssetTrees/,
  "The builder must invoke the shared static-input validator");
const copyFunctionIndex = build.indexOf("async function copyStaticAssets()");
const sharedTreeGuardIndex = build.indexOf("await assertValidStaticAssetTrees(root, blockerOnly)");
const firstStaticCopyIndex = build.indexOf("await staticOutputWriter.copyBatch(commonFiles)");
assert.ok(
  copyFunctionIndex >= 0
    && sharedTreeGuardIndex > copyFunctionIndex
    && firstStaticCopyIndex > sharedTreeGuardIndex,
  "Every successful finalization, including one-shot/release builds, must validate static inputs before copying",
);

for (const marker of [
  "Blocker-only cleanup must remove stale generated output from any profile",
  "The repository root must remain watched while icons is the wrong filesystem type",
  "A linked root static directory must fail without being traversed",
  "External files behind a linked static root must never enter watchFiles",
  "A nested static-tree link must fail visibly without aborting watch metadata collection",
  "Static finalization must not run through a late output junction or symlink",
  "Late output-link rejection must prevent static writes outside the build directory",
]) {
  assert.ok(fixtures.includes(marker), `Round 47 fixture is missing: ${marker}`);
}
assert.match(fixtures, /process\.platform === "win32" \? "junction" : "dir"/,
  "Round 47 must exercise real Windows junctions or POSIX directory symlinks");
assert.match(fixtures, /esbuildContext/,
  "Round 47 must exercise real esbuild watch recovery");
assert.match(fixtures, /esbuildBuild/,
  "Round 47 must exercise late successful-build finalization");

for (const command of [
  "node scripts/run-round47-fixtures.mjs",
  "node scripts/validate-round47-static.mjs",
]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test is missing ${command}`);
  assert.ok(workflow.includes(command), `CI is missing ${command}`);
  assert.ok(selfHosted.includes(command), `Self-hosted CI contract is missing ${command}`);
}
assert.ok(
  workflow.indexOf("node scripts/validate-round46-static.mjs")
    < workflow.indexOf("node scripts/run-round47-fixtures.mjs")
    && workflow.indexOf("node scripts/run-round47-fixtures.mjs")
      < workflow.indexOf("node scripts/validate-round47-static.mjs")
    && workflow.indexOf("node scripts/validate-round47-static.mjs")
      < workflow.indexOf("node scripts/validate-self-hosted-ci.mjs"),
  "Round 47 must run explicitly after Round 46 and before the CI contract",
);

assert.match(watchGuide, /revalidates the build output immediately before static finalization/i);
assert.match(watchGuide, /links, junctions, and other special filesystem entries are rejected/i);
assert.match(watchGuide, /one-shot\/release builds/i);
assert.match(watchGuide, /reusing the same safe `--outdir` across profiles/i);
assert.match(audit, /late output-path replacement/i);
assert.match(audit, /symlink\/junction/i);
assert.match(audit, /one-shot\/release builds/i);
assert.match(audit, /mixed-profile/i);
assert.match(manualQa, /junction/i);
assert.match(manualQa, /same `--outdir`/i);
assert.match(manualQa, /wrong-type/i);

console.log("Round 47 static validation passed");
