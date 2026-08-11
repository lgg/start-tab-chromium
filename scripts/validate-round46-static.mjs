import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const build = await readFile("scripts/build.mjs", "utf8");
const watchHelper = await readFile("scripts/static-asset-watch.mjs", "utf8");
const fixtures = await readFile("scripts/run-round46-fixtures.mjs", "utf8");
const selfHosted = await readFile("scripts/validate-self-hosted-ci.mjs", "utf8");
const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const watchGuide = await readFile("docs/watch-mode.md", "utf8");
const audit = await readFile("docs/audit-2026-08-11-round-46.md", "utf8");
const manualQa = await readFile("docs/manual-qa-round46.md", "utf8");

assert.doesNotMatch(build, /rm\(outdir,\s*\{\s*recursive:\s*true/,
  "Build startup must not recursively delete the whole output directory");
assert.doesNotMatch(build, /mkdir\(outdir,\s*\{\s*recursive:\s*true/,
  "Build startup must delegate generated-output preparation to the lifecycle plugin");
assert.doesNotMatch(build, /import \{[^\n]*\brm\b[^\n]*\} from "node:fs\/promises"/);
assert.match(build, /await assertSafeBuildOutputFilesystem\(root, tmpdir\(\), outdir\)/,
  "Startup must still reject unsafe output filesystem paths before esbuild context creation");
assert.match(build, /createBuildOutputLifecyclePlugin/);

assert.match(watchHelper, /function errorCodeIs\(error, code\)/);
assert.match(watchHelper, /const missingDirectories = \[\]/);
assert.match(watchHelper, /if \(errorCodeIs\(error, "ENOENT"\)\)/);
assert.match(watchHelper, /missingDirectories\.push\(current\)/);
assert.match(watchHelper, /recursiveDirectories\.map\(\(directory\) => path\.dirname\(directory\)\)/,
  "Existing parents of recursive static roots must always remain watched");
assert.match(watchHelper, /return \{ watchFiles, watchDirs, missingDirectories, missingFiles, invalidPaths \}/,
  "Round 46 missing-root metadata must remain available when later rounds add explicit-file recovery");
assert.match(watchHelper, /inputs\.missingDirectories\.map\(\(directory\) =>/);
assert.match(watchHelper, /Required static asset directory is missing/);
assert.match(watchHelper, /watchDirs: inputs\.watchDirs/);
assert.match(watchHelper, /watchFiles: inputs\.watchFiles/);

assert.match(fixtures, /context as esbuildContext/);
assert.match(fixtures, /await watchContext\.watch\(\)/);
assert.match(fixtures, /Watch must fail visibly while the required icons root is missing/);
assert.match(fixtures, /Creating a previously missing root static directory must trigger an automatic successful rebuild/);
assert.match(fixtures, /Restoring the root icons directory after a failed rebuild must recover without a source-code edit/);
assert.match(fixtures, /unrelated startup output/);
assert.match(fixtures, /prepareGeneratedOutputs/);

for (const command of [
  "node scripts/run-round46-fixtures.mjs",
  "node scripts/validate-round46-static.mjs",
]) {
  assert.ok(workflow.includes(command), `CI must execute ${command} explicitly`);
  assert.ok(packageJson.scripts.test.includes(command), `npm test must execute ${command}`);
}
assert.ok(
  workflow.indexOf("node scripts/validate-round45-static.mjs")
    < workflow.indexOf("node scripts/run-round46-fixtures.mjs")
    && workflow.indexOf("node scripts/run-round46-fixtures.mjs")
      < workflow.indexOf("node scripts/validate-round46-static.mjs")
    && workflow.indexOf("node scripts/validate-round46-static.mjs")
      < workflow.indexOf("node scripts/validate-self-hosted-ci.mjs"),
  "Round 46 must run explicitly after Round 45 and before the CI contract",
);
for (const command of [
  "node scripts/run-round45-fixtures.mjs",
  "node scripts/validate-round45-static.mjs",
  "node scripts/run-round46-fixtures.mjs",
  "node scripts/validate-round46-static.mjs",
]) {
  assert.ok(selfHosted.includes(command), `Self-hosted CI contract must include latest regression command: ${command}`);
}

assert.match(watchGuide, /Unrelated files in the output directory are preserved both when the build command starts/);
assert.match(watchGuide, /Missing recursive static roots remain recoverable without restarting watch mode/);
assert.match(audit, /recursively removed the whole selected output directory/);
assert.match(audit, /parent of the root `icons\/` directory was not explicitly watched/);
assert.match(audit, /self-hosted CI contract no longer independently required the latest explicit regression steps/);
assert.match(manualQa, /unrelated file such as `build\/keep\.txt`/);
assert.match(manualQa, /Restore `icons\/` without editing any TypeScript/);
assert.match(manualQa, /Start watch while `icons\/` is temporarily absent/);

console.log("Round 46 static validation passed");
