import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const runnerGuide = await readFile("docs/self-hosted-runner.md", "utf8");

assert.match(workflow, /pull_request:[\s\S]*branches:[\s\S]*- master/);
assert.match(workflow, /push:[\s\S]*branches:[\s\S]*- master/);
assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /pull_request_target/);
assert.match(workflow, /permissions:\s*\n\s*contents: read/);
assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);

assert.equal((workflow.match(/^\s+jobs:/gm) ?? []).length, 0, "jobs must be a top-level key");
assert.equal((workflow.match(/^\s{2}validate:/gm) ?? []).length, 1, "CI must contain one serial project job");
assert.equal((workflow.match(/^\s{4}runs-on:/gm) ?? []).length, 1, "CI must route exactly one job");
assert.match(workflow, /^\s{4}runs-on: start-tab-chromium-ci$/m);
assert.doesNotMatch(workflow, /^\s{6}- (?:self-hosted|windows|x64)$/m);
assert.doesNotMatch(workflow, /ubuntu-latest|macos-latest/);
assert.doesNotMatch(workflow, /^concurrency:/m);
assert.doesNotMatch(workflow, /cancel-in-progress/);

assert.match(workflow, /uses: actions\/checkout@v6/);
assert.match(workflow, /clean: true/);
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

for (const command of [
  "npm ci --no-audit --no-fund --loglevel=error",
  "node scripts/report-locale-parity.mjs",
  "npm run test",
  "npm run typecheck",
  "npm run build",
  "npm run build:blocker-only",
  "npm run build:google",
]) {
  assert.ok(workflow.includes(command), `Missing CI command: ${command}`);
}

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

assert.match(workflow, /- name: Clean project workspace\s*\n\s*if: always\(\)/);
assert.match(workflow, /Refusing to remove a path outside GITHUB_WORKSPACE/);
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

console.log("Self-hosted Windows CI validation passed");
