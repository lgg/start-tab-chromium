import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const runnerGuide = await readFile("docs/self-hosted-runner.md", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const cleanScript = await readFile("scripts/clean.mjs", "utf8");
const cleanCiScript = await readFile("scripts/clean-ci.mjs", "utf8");
const pathSafety = await readFile("scripts/path-safety.mjs", "utf8");

assert.match(workflow, /pull_request:[\s\S]*branches:[\s\S]*- master/);
for (const activityType of ["opened", "synchronize", "reopened"]) {
  assert.match(workflow, new RegExp(`\\s+- ${activityType}`), `Missing pull_request activity type: ${activityType}`);
}
assert.doesNotMatch(workflow, /^\s{2}push:/m, "PR CI must not run a duplicate full build after merge");
assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /pull_request_target/);
assert.match(workflow, /permissions:\s*\n\s*contents: read/);
assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);

assert.equal((workflow.match(/^[ \t]+jobs:/gm) ?? []).length, 0, "jobs must be a top-level key");
assert.equal((workflow.match(/^[ \t]{2}validate:/gm) ?? []).length, 1, "CI must contain one serial project job");
assert.equal((workflow.match(/^[ \t]{4}runs-on:/gm) ?? []).length, 1, "CI must route exactly one job");
assert.match(workflow, /^[ \t]{4}runs-on: start-tab-chromium-ci$/m);
assert.doesNotMatch(workflow, /^[ \t]{6}- (?:self-hosted|windows|x64)$/m);
assert.doesNotMatch(workflow, /ubuntu-latest|macos-latest/);
assert.doesNotMatch(workflow, /^concurrency:/m);
assert.doesNotMatch(workflow, /cancel-in-progress/);
assert.match(workflow, /^[ \t]{8}shell: pwsh$/m);
assert.doesNotMatch(workflow, /^[ \t]+shell: powershell$/m);

assert.match(workflow, /- name: Configure isolated CI paths/);
assert.match(workflow, /RUNNER_TEMP/);
assert.match(workflow, /start-tab-chromium-cache/);
assert.match(workflow, /Out-File -FilePath \$env:GITHUB_ENV -Encoding utf8 -Append/);
assert.match(workflow, /NPM_CONFIG_CACHE=\$\(Join-Path \$cacheRoot 'npm'\)/);
assert.doesNotMatch(workflow, /NPM_CONFIG_CACHE:\s*\$\{\{ github\.workspace \}\}/);
assert.doesNotMatch(workflow, /New-Item[^\n]*\$cacheRoot/,
  "The workflow must not create or overwrite a stale cache junction before safe cleanup");

assert.match(workflow, /uses: actions\/checkout@v6/);
assert.match(workflow, /clean: false/,
  "Checkout must leave deletion to the checked-in bounded cleanup implementation");
assert.doesNotMatch(workflow, /clean: true/,
  "Checkout must not run broad git clean before path-safety code is available");
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /uses: actions\/setup-node@v6/);
assert.match(workflow, /node-version: 22/);
assert.match(workflow, /architecture: x64/);
assert.match(workflow, /package-manager-cache: false/);
assert.match(workflow, /uses: actions\/cache\/restore@v5/);
assert.match(workflow, /uses: actions\/cache\/save@v5/);
assert.match(
  workflow,
  /start-tab-chromium-npm-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-node22-\$\{\{ hashFiles\('package-lock\.json'\) \}\}/,
);
assert.doesNotMatch(workflow, /path:\s*node_modules/);

const releaseValidationCommands = [
  "node scripts/validate-release-docs.mjs build-cleanup",
  "node scripts/validate-release-docs.mjs oauth",
  "node scripts/validate-release-docs.mjs documentation",
  "node scripts/validate-release-docs.mjs ci",
];
const regressionCommands = [
  "node scripts/validate-static.mjs",
  "node scripts/validate-round6-static.mjs",
  "node scripts/validate-round7-static.mjs",
  "node scripts/validate-round11-static.mjs",
  ...releaseValidationCommands,
  "node scripts/run-round12-fixtures.mjs",
  "node scripts/validate-round12-static.mjs",
  "node scripts/run-round13-fixtures.mjs",
  "node scripts/validate-round13-static.mjs",
  "node scripts/run-round14-fixtures.mjs",
  "node scripts/validate-round14-static.mjs",
  "node scripts/run-round15-fixtures.mjs",
  "node scripts/validate-round15-static.mjs",
  "node scripts/run-round16-fixtures.mjs",
  "node scripts/validate-round16-static.mjs",
  "node scripts/run-round17-fixtures.mjs",
  "node scripts/validate-round17-static.mjs",
  "node scripts/run-round18-fixtures.mjs",
  "node scripts/validate-round18-static.mjs",
  "node scripts/run-round19-fixtures.mjs",
  "node scripts/validate-round19-static.mjs",
  "node scripts/run-round20-fixtures.mjs",
  "node scripts/validate-round20-static.mjs",
  "node scripts/run-round21-fixtures.mjs",
  "node scripts/validate-round21-static.mjs",
  "node scripts/run-round22-fixtures.mjs",
  "node scripts/validate-round22-static.mjs",
  "node scripts/run-round23-fixtures.mjs",
  "node scripts/validate-round23-static.mjs",
  "node scripts/run-round24-fixtures.mjs",
  "node scripts/validate-round24-static.mjs",
  "node scripts/run-round25-fixtures.mjs",
  "node scripts/validate-round25-static.mjs",
  "node scripts/run-round26-fixtures.mjs",
  "node scripts/validate-round26-static.mjs",
  "node scripts/run-round27-fixtures.mjs",
  "node scripts/validate-round27-static.mjs",
  "node scripts/run-round28-fixtures.mjs",
  "node scripts/validate-round28-static.mjs",
  "node scripts/run-round29-fixtures.mjs",
  "node scripts/validate-round29-static.mjs",
  "node scripts/run-round30-fixtures.mjs",
  "node scripts/validate-round30-static.mjs",
  "node scripts/validate-self-hosted-ci.mjs",
];

for (const command of [
  "npm ci --include=dev --bin-links=true --no-audit --no-fund --loglevel=error",
  "node scripts/report-locale-parity.mjs",
  ...regressionCommands,
  "npm run typecheck",
  "npm run build",
  "npm run build:blocker-only",
  "npm run build:google",
]) {
  assert.ok(workflow.includes(command), `Missing CI command: ${command}`);
}
for (const toolPath of ["node_modules/typescript/bin/tsc", "node_modules/esbuild/bin/esbuild"]) {
  assert.ok(workflow.includes(toolPath), `CI must verify installed tool: ${toolPath}`);
}
for (const scriptName of ["test", "typecheck", "build", "build:blocker-only", "build:google", "clean"]) {
  assert.equal(typeof packageJson.scripts?.[scriptName], "string", `package.json is missing script: ${scriptName}`);
}
assert.ok(packageJson.scripts.test.includes("node scripts/validate-release-docs.mjs"),
  "npm test must execute every release validation scope through the default all mode");
await access("scripts/report-locale-parity.mjs");
for (const command of regressionCommands) {
  const [relativePath] = command.replace(/^node\s+/, "").split(/\s+/);
  await access(relativePath);
}

assert.match(
  workflow,
  /- name: Build full extension\s*\n\s*env:\s*\n\s*GOOGLE_OAUTH_CLIENT_ID: should-be-ignored\.apps\.googleusercontent\.com\s*\n\s*run: npm run build/,
  "CI must prove the ordinary full profile ignores inherited Google OAuth configuration",
);
assert.match(
  workflow,
  /- name: Build blocker-only extension\s*\n\s*env:\s*\n\s*GOOGLE_OAUTH_CLIENT_ID: should-be-ignored\.apps\.googleusercontent\.com\s*\n\s*run: npm run build:blocker-only/,
  "CI must prove blocker-only ignores inherited Google OAuth configuration",
);
assert.match(
  workflow,
  /- name: Validate Google-enabled build\s*\n\s*env:\s*\n\s*GOOGLE_OAUTH_CLIENT_ID: ci-validation\.apps\.googleusercontent\.com\s*\n\s*run: npm run build:google/,
  "CI must validate the explicit Google profile with a non-production client ID",
);

assert.equal(packageJson.scripts?.clean, "node scripts/clean.mjs");
assert.doesNotMatch(packageJson.scripts.clean, /\brm\b|rmdir|\bdel\b/i);
assert.match(cleanScript, /removePathWithinBoundary/);
assert.match(cleanCiScript, /removePathWithinBoundary/);
assert.match(pathSafety, /lstat/);
assert.match(pathSafety, /intermediate symbolic link or junction/);
for (const directory of ["build", "build-blocker-only", "build-google", "build-round24-link", "build-round25-link"]) {
  assert.ok(cleanScript.includes(`"${directory}"`), `Portable clean script must remove ${directory}`);
  assert.ok(cleanCiScript.includes(`"${directory}"`), `CI clean script must remove ${directory}`);
}

assert.equal((workflow.match(/run: node scripts\/clean-ci\.mjs/g) ?? []).length, 2,
  "CI must run the shared safe cleanup before tests and in the always() post-step");
assert.ok(workflow.indexOf("uses: actions/checkout@v6") < workflow.indexOf("run: node scripts/clean-ci.mjs"));
assert.ok(workflow.indexOf("uses: actions/setup-node@v6") < workflow.indexOf("run: node scripts/clean-ci.mjs"));
assert.match(workflow, /- name: Clean project workspace\s*\n\s*if: always\(\)\s*\n\s*run: node scripts\/clean-ci\.mjs/);
assert.doesNotMatch(workflow, /Remove-Item[^\n]*-Recurse/,
  "CI must not use lexical-only recursive PowerShell deletion");

for (const artifactMarker of [
  "actions/upload-artifact",
  "Compress-Archive",
  "ci-artifacts",
  "retention-days",
  "start-tab-chromium-packages",
  "complete-audit-snapshot",
]) {
  assert.doesNotMatch(workflow, new RegExp(artifactMarker), `CI must not contain artifact marker: ${artifactMarker}`);
}
for (const dangerousCommand of [
  "docker system prune",
  "docker volume prune",
  "docker image prune",
  "docker container prune",
  "docker builder prune",
]) {
  assert.doesNotMatch(workflow, new RegExp(dangerousCommand));
}

assert.match(runnerGuide, /workflow requires exactly one label/);
assert.match(runnerGuide, /--no-default-labels --labels start-tab-chromium-ci/);
assert.match(runnerGuide, /2\.329\.0 or newer/);
assert.match(runnerGuide, /does not contain a Dockerfile or Compose configuration/);
assert.match(runnerGuide, /does not package or upload any build artifacts/);
assert.match(runnerGuide, /No repository secret or Actions variable is required/);
assert.match(runnerGuide, /cache retention at \*\*1 day\*\*/);
assert.match(runnerGuide, /Never approve or manually dispatch a fork-authored workflow/);
assert.match(runnerGuide, /pull requests targeting `master` and manual `workflow_dispatch` runs/);
assert.match(runnerGuide, /project-specific cache directory inside `RUNNER_TEMP`/);
assert.match(runnerGuide, /checkout's built-in recursive clean is disabled/,
  "Runner documentation must explain why checkout delegates deletion to bounded cleanup");

console.log("Self-hosted Windows CI validation passed");
