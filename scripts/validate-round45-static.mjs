import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const build = await readFile("scripts/build.mjs", "utf8");
const lifecycle = await readFile("scripts/build-output-lifecycle.mjs", "utf8");
const outputHelper = await readFile("scripts/static-asset-output.mjs", "utf8");
const fixtures = await readFile("scripts/run-round45-fixtures.mjs", "utf8");
const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const watchGuide = await readFile("docs/watch-mode.md", "utf8");
const audit = await readFile("docs/audit-2026-08-05-round-45.md", "utf8");
const manualQa = await readFile("docs/manual-qa-round45.md", "utf8");

assert.match(build, /import \{ createBuildOutputLifecyclePlugin \} from "\.\/build-output-lifecycle\.mjs"/);
assert.match(build, /const outputLifecyclePlugin = createBuildOutputLifecyclePlugin\(\{/);
assert.match(build, /temporaryRoot: tmpdir\(\)/);
assert.match(build, /assertProductionGraph,/);
assert.match(build, /copyStaticAssets,/);
assert.match(build, /const plugins = \[outputLifecyclePlugin\]/);
assert.doesNotMatch(build, /prepareStaticAssetOutputs/,
  "Static cleanup must not wait until successful onEnd finalization");
assert.doesNotMatch(build, /build\.onEnd/,
  "The reusable lifecycle helper must own all build-result handling");

assert.match(lifecycle, /build\.onStart\(async \(\) =>/);
assert.match(lifecycle, /await prepareGeneratedOutputs\(root, temporaryRoot, outdir, blockerOnly\)/);
assert.match(lifecycle, /if \(result\.errors\.length > 0\) return/);
assert.match(lifecycle, /assertGraph\(result\.metafile\)/);
assert.match(lifecycle, /await copyStatic\(\)/);
assert.equal((lifecycle.match(/await invalidateGeneratedOutputs\(\)/g) ?? []).length, 2,
  "Generated outputs must be invalidated before every build and after finalization failure");
assert.match(lifecycle, /Build finalization failed and generated-output cleanup also failed/);
assert.match(lifecycle, /throw error/);

assert.match(outputHelper, /COMMON_BUNDLE_OUTPUTS/);
assert.match(outputHelper, /NEW_TAB_BUNDLE_OUTPUTS/);
assert.match(outputHelper, /export function generatedOutputPaths/);
assert.match(outputHelper, /export async function prepareGeneratedOutputs/);
assert.match(outputHelper, /generatedOutputPaths\(blockerOnly\)/);
for (const output of [
  "service-worker.js",
  "popup.js",
  "blocked.js",
  "options.js",
  "newtab.js",
]) {
  assert.ok(outputHelper.includes(`"${output}"`), `Generated bundle list is missing ${output}`);
}

assert.match(fixtures, /export const broken = ;/);
assert.match(fixtures, /Static finalization must not run after a compile failure/);
assert.match(fixtures, /fixture finalization failure/);
assert.match(fixtures, /partial new output/);
assert.match(fixtures, /Generated output must be absent after a failed build/);
assert.match(fixtures, /A successful build must retain its fresh JavaScript bundle/);
assert.match(fixtures, /Blocker-only invalidation must preserve full-profile-only output/);
assert.match(fixtures, /unrelated output survives/);
assert.match(fixtures, /esbuildBuild/);

for (const command of [
  "node scripts/run-round45-fixtures.mjs",
  "node scripts/validate-round45-static.mjs",
]) {
  assert.ok(workflow.includes(command), `CI must execute ${command} explicitly`);
  assert.ok(packageJson.scripts.test.includes(command), `npm test must execute ${command}`);
}
assert.ok(
  workflow.indexOf("node scripts/validate-round44-static.mjs")
    < workflow.indexOf("node scripts/run-round45-fixtures.mjs")
    && workflow.indexOf("node scripts/run-round45-fixtures.mjs")
      < workflow.indexOf("node scripts/validate-round45-static.mjs")
    && workflow.indexOf("node scripts/validate-round45-static.mjs")
      < workflow.indexOf("node scripts/validate-self-hosted-ci.mjs"),
  "Round 45 must run explicitly after Round 44 and before the CI contract",
);

assert.match(watchGuide, /invalidates every generated JavaScript and static output before each rebuild attempt/);
assert.match(watchGuide, /failed rebuild leaves the generated extension incomplete and visibly absent/);
assert.match(audit, /early compilation or watch-input failure/);
assert.match(audit, /mixed-version output/);
assert.match(manualQa, /TypeScript syntax error/);
assert.match(manualQa, /temporarily rename the root `icons\/` directory/i);
assert.match(manualQa, /all generated files return only after a successful rebuild/);

console.log("Round 45 static validation passed");
