import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const build = await readFile("scripts/build.mjs", "utf8");
const lifecycle = await readFile("scripts/build-output-lifecycle.mjs", "utf8");
const finalization = await readFile("scripts/static-asset-finalization.mjs", "utf8");
const watchHelper = await readFile("scripts/static-asset-watch.mjs", "utf8");
const fixtures = await readFile("scripts/run-round49-fixtures.mjs", "utf8");
const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const selfHosted = await readFile("scripts/validate-self-hosted-ci.mjs", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const watchGuide = await readFile("docs/watch-mode.md", "utf8");
const audit = await readFile("docs/audit-2026-08-11-round-49.md", "utf8");
const manualQa = await readFile("docs/manual-qa-round49.md", "utf8");

assert.match(build, /import \{ bundleOutputPaths \} from "\.\/static-asset-output\.mjs"/);
assert.match(build, /assertValidStaticCopySource/);
assert.match(build, /assertSourceSafe: assertValidStaticCopySource/,
  "Production static finalization must revalidate each concrete source before use");
assert.match(build, /async function validateFinalizationInputs\(\)[\s\S]*await assertValidStaticAssetTrees\(root, blockerOnly\)/);
assert.match(build, /async function writeBundleOutputs\(outputFiles\)[\s\S]*writeOutputFiles\(outputFiles, bundleOutputPaths\(blockerOnly\)\)/);
assert.match(build, /validateFinalizationInputs,/);
assert.match(build, /writeBundleOutputs,/);
assert.match(build, /const manifest = JSON\.parse\(await staticOutputWriter\.readOne\(source\("manifest\.json"\), "utf8"\)\)/,
  "Transformed manifest reads must use the per-source guard");
assert.match(build, /write:\s*false/,
  "Production esbuild must keep bundles in memory until guarded lifecycle finalization");
assert.doesNotMatch(build, /write:\s*true/,
  "Production build must never let esbuild write JavaScript bundles directly");

const graphIndex = lifecycle.indexOf("assertGraph(result.metafile)");
const inputValidationIndex = lifecycle.indexOf("await validateInputs()");
const postCompileGuardIndex = lifecycle.indexOf("await assertSafeBuildOutputFilesystem(root, temporaryRoot, outdir)");
const bundleWriteIndex = lifecycle.indexOf("await writeBundles(result.outputFiles)");
const staticCopyIndex = lifecycle.indexOf("await copyStatic()");
assert.ok(
  graphIndex >= 0
    && inputValidationIndex > graphIndex
    && postCompileGuardIndex > inputValidationIndex
    && bundleWriteIndex > postCompileGuardIndex
    && staticCopyIndex > bundleWriteIndex,
  "Successful lifecycle order must be graph -> input preflight -> output guard -> guarded bundles -> guarded static assets",
);
assert.match(lifecycle, /Production builds keep esbuild outputs in memory/);
assert.match(lifecycle, /await invalidateGeneratedOutputs\(\)/,
  "Bundle finalization failures must retain fail-closed generated-output cleanup");

assert.match(finalization, /async function copyOne\(from, to, options\)[\s\S]*await assertSource\(from, options\);[\s\S]*await guard\(\);[\s\S]*await copyFile/,
  "Concrete static source validation must run before the fresh output guard and cp");
assert.match(finalization, /async function readOne\(source, options\)[\s\S]*await assertSource\(source, \{ recursive: false \}\)[\s\S]*readFileValue/);
assert.match(finalization, /Build output target must stay strictly inside the selected outdir/,
  "Every generated destination must remain a strict child of outdir");
assert.match(finalization, /async function writeOutputFiles\(outputFiles, expectedRelativePaths\)/);
assert.match(finalization, /configure the build with write: false/);
assert.match(finalization, /Unexpected esbuild output set; missing=/,
  "Bundle output materialization must reject missing and unexpected files before writing");
assert.match(finalization, /for \(const \{ target \} of expected\.values\(\)\)[\s\S]*await writeOne\(target, outputFile\.contents\)/,
  "Accepted in-memory bundles must be written sequentially through the guarded writer");

assert.match(watchHelper, /export async function assertValidStaticCopySource\(source, options = \{\}\)/);
assert.match(watchHelper, /if \(options\?\.recursive\)[\s\S]*listRegularTree\(source\)/,
  "Per-operation recursive copy validation must rescan the concrete tree");
assert.match(watchHelper, /inspectExplicitStaticFiles\(\[source\]\)/,
  "Per-operation explicit copy/read validation must lstat the concrete file");

for (const marker of [
  "A static source replaced after whole-tree validation must be rejected before cp is invoked",
  "Manifest replacement after whole-tree validation must be rejected before readFile is invoked",
  "A recursive static root replaced after preflight must be rejected before cp is invoked",
  "Unexpected bundle output must fail before any expected bundle is written",
  "A late output link must not receive an esbuild JavaScript bundle",
  "Lifecycle must receive the real in-memory esbuild output file instead of relying on direct filesystem writes",
]) {
  assert.ok(fixtures.includes(marker), `Round 49 fixture is missing: ${marker}`);
}
assert.match(fixtures, /write:\s*false/);
assert.match(fixtures, /process\.platform === "win32"/);
assert.match(fixtures, /esbuildBuild/);

for (const command of [
  "node scripts/run-round49-fixtures.mjs",
  "node scripts/validate-round49-static.mjs",
]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test is missing ${command}`);
  assert.ok(workflow.includes(command), `CI is missing ${command}`);
  assert.ok(selfHosted.includes(command), `Self-hosted CI contract is missing ${command}`);
}
assert.ok(
  workflow.indexOf("node scripts/validate-round48-static.mjs")
    < workflow.indexOf("node scripts/run-round49-fixtures.mjs")
    && workflow.indexOf("node scripts/run-round49-fixtures.mjs")
      < workflow.indexOf("node scripts/validate-round49-static.mjs")
    && workflow.indexOf("node scripts/validate-round49-static.mjs")
      < workflow.indexOf("node scripts/validate-self-hosted-ci.mjs"),
  "Round 49 must run explicitly after Round 48 and before the CI contract",
);

assert.match(watchGuide, /esbuild keeps JavaScript bundle outputs in memory/i);
assert.match(watchGuide, /revalidates each concrete static source/i);
assert.match(audit, /unguarded JavaScript bundle/i);
assert.match(audit, /source-side validation window/i);
assert.match(manualQa, /bundle/i);
assert.match(manualQa, /manifest/i);

console.log("Round 49 static validation passed");
