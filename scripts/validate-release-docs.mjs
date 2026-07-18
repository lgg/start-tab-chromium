import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

const [packageSource, readme, releaseNotes, deployment, manualQa, ci, googleGuard, cleanScript] = await Promise.all([
  read("package.json"),
  read("README.md"),
  read("docs/release.md"),
  read("docs/deployment-3.0.0.md"),
  read("docs/manual-qa-3.0.0.md"),
  read(".github/workflows/ci.yml"),
  read("scripts/require-google-oauth.mjs"),
  read("scripts/clean.mjs"),
]);

const packageJson = JSON.parse(packageSource);
const googleBuild = packageJson.scripts?.["build:google"];
assert.equal(typeof googleBuild, "string", "package.json must expose build:google");
assert.match(googleBuild, /require-google-oauth\.mjs/, "build:google must reject missing OAuth configuration");
assert.match(googleBuild, /node build\.mjs --google/, "build:google must select the explicit Google profile");
assert.match(googleBuild, /--outdir=build-google\b/, "build:google must write build-google/");
assert.match(googleBuild, /validate-build-output\.mjs build-google google/, "build:google must validate the generated Google profile");
assert.equal(packageJson.scripts?.clean, "node scripts/clean.mjs", "clean must use the portable Node cleanup entrypoint");
for (const directory of ["build", "build-blocker-only", "build-google"]) {
  assert.ok(cleanScript.includes(`"${directory}"`), `clean.mjs must remove ${directory}/`);
}
assert.match(googleGuard, /GOOGLE_OAUTH_CLIENT_ID is required/, "Google build guard must reject a missing client ID");
assert.match(googleGuard, /\.apps\.googleusercontent\.com/, "Google build guard must validate the Chrome OAuth client format");

for (const [name, source] of [
  ["README", readme],
  ["release notes", releaseNotes],
  ["deployment guide", deployment],
  ["manual QA", manualQa],
]) {
  assert.match(source, /build-google\//, `${name} must document build-google/`);
  assert.match(source, /GOOGLE_OAUTH_CLIENT_ID/, `${name} must document build-time Google OAuth configuration`);
  assert.doesNotMatch(source, /(?:^|\W)dist(?:-blocker-only)?\//m, `${name} must not reference obsolete dist output folders`);
}

assert.match(readme, /Roadmap Status — Completed In 3\.0\.0/, "README must mark the completed roadmap as completed");
assert.doesNotMatch(readme, /real OAuth client ID in `src\/manifest\.json`/, "README must not instruct users to edit the source manifest");
assert.match(releaseNotes, /Start Page settings schema: version 4|Start Page schema 4/, "Release notes must document the current settings schema");
assert.match(releaseNotes, /explicit Google profile/, "Release notes must describe deterministic build-profile selection");
assert.match(manualQa, /npm run build:google/, "Manual QA must include the Google-enabled profile");
assert.match(
  ci,
  /GOOGLE_OAUTH_CLIENT_ID:\s*ci-validation\.apps\.googleusercontent\.com[\s\S]*run: npm run build:google/,
  "CI must execute the Google-enabled build with a non-production validation ID",
);
assert.match(ci, /build-google/, "CI must generate and clean the build-google/ validation output");
assert.doesNotMatch(ci, /actions\/upload-artifact|Compress-Archive|retention-days:/, "CI must not upload build artifacts");

console.log("Release documentation and build-profile validation passed");
