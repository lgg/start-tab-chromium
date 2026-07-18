import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");
const scope = process.argv[2] ?? "all";
const scopes = new Set(["all", "build-cleanup", "oauth", "documentation", "ci"]);
if (!scopes.has(scope)) throw new Error(`Unknown release validation scope: ${scope}`);
const selected = (name) => scope === "all" || scope === name;

const [
  packageSource,
  readme,
  releaseNotes,
  deployment,
  manualQa,
  ci,
  googleGuard,
  googleValidator,
  cleanScript,
  cleanCiScript,
  pathSafety,
] = await Promise.all([
  read("package.json"),
  read("README.md"),
  read("docs/release.md"),
  read("docs/deployment-3.0.0.md"),
  read("docs/manual-qa-3.0.0.md"),
  read(".github/workflows/ci.yml"),
  read("scripts/require-google-oauth.mjs"),
  read("scripts/google-oauth-client.mjs"),
  read("scripts/clean.mjs"),
  read("scripts/clean-ci.mjs"),
  read("scripts/path-safety.mjs"),
]);

const packageJson = JSON.parse(packageSource);

if (selected("build-cleanup")) {
  const googleBuild = packageJson.scripts?.["build:google"];
  assert.equal(typeof googleBuild, "string", "package.json must expose build:google");
  assert.match(googleBuild, /require-google-oauth\.mjs/, "build:google must reject missing OAuth configuration");
  assert.match(googleBuild, /node build\.mjs --google/, "build:google must select the explicit Google profile");
  assert.match(googleBuild, /--outdir=build-google\b/, "build:google must write build-google/");
  assert.match(googleBuild, /validate-build-output\.mjs build-google google/, "build:google must validate the generated Google profile");

  assert.equal(packageJson.scripts?.clean, "node scripts/clean.mjs", "clean must use the portable Node cleanup entrypoint");
  assert.match(cleanScript, /removePathWithinBoundary/,
    "Local cleanup must delegate to the shared bounded remover");
  assert.match(cleanCiScript, /removePathWithinBoundary/,
    "Self-hosted CI cleanup must delegate to the shared bounded remover");
  assert.match(pathSafety, /lstat/,
    "Shared cleanup safety must inspect links without following them");
  assert.match(pathSafety, /intermediate symbolic link or junction/,
    "Shared cleanup safety must reject intermediate links");
  for (const directory of ["build", "build-blocker-only", "build-google"]) {
    assert.ok(cleanScript.includes(`"${directory}"`), `clean.mjs must remove ${directory}/`);
    assert.ok(cleanCiScript.includes(`"${directory}"`), `clean-ci.mjs must remove ${directory}/`);
  }
}

if (selected("oauth")) {
  assert.match(googleGuard, /requireGoogleOAuthClientId\(\)/,
    "Google build guard must delegate to the shared strict OAuth validator");
  assert.match(googleValidator, /GOOGLE_OAUTH_CLIENT_ID is required/,
    "Shared Google validation must reject a missing client ID");
  assert.ok(googleValidator.includes("\\.apps\\.googleusercontent\\.com"),
    "Shared Google validation must enforce the Chrome OAuth client format");
  for (const placeholderToken of ["REPLACE", "TODO", "EXAMPLE", "YOUR", "CHANGEME", "PLACEHOLDER"]) {
    assert.ok(googleValidator.includes(placeholderToken),
      `Shared Google validation must reject placeholder token: ${placeholderToken}`);
  }
}

if (selected("documentation")) {
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
  for (const [name, source] of [["README", readme], ["release notes", releaseNotes], ["deployment guide", deployment]]) {
    assert.ok(source.includes("REPLACE_WITH_REAL_CLIENT_ID.apps.googleusercontent.com"),
      `${name} must show an explicitly rejected OAuth placeholder`);
    assert.doesNotMatch(source, /1234567890-example\.apps\.googleusercontent\.com/,
      `${name} must not publish a syntactically accepted fake OAuth ID`);
    assert.match(source, /intentionally rejected/,
      `${name} must explain that the shown OAuth placeholder cannot be used as-is`);
  }

  assert.match(readme, /Roadmap Status — Completed In 3\.0\.0/, "README must mark the completed roadmap as completed");
  assert.doesNotMatch(readme, /real OAuth client ID in `src\/manifest\.json`/, "README must not instruct users to edit the source manifest");
  assert.match(releaseNotes, /Start Page settings schema: version 4|Start Page schema 4/, "Release notes must document the current settings schema");
  assert.match(releaseNotes, /explicit Google profile/, "Release notes must describe deterministic build-profile selection");
  assert.match(manualQa, /npm run build:google/, "Manual QA must include the Google-enabled profile");
}

if (selected("ci")) {
  assert.match(
    ci,
    /GOOGLE_OAUTH_CLIENT_ID:\s*ci-validation\.apps\.googleusercontent\.com[\s\S]*run: npm run build:google/,
    "CI must execute the Google-enabled build with a non-production validation ID",
  );
  assert.match(ci, /uses: actions\/checkout@v6[\s\S]*clean: false/,
    "Checkout must delegate deletion to the repository's bounded cleanup");
  assert.doesNotMatch(ci, /clean: true/,
    "Checkout must not run broad recursive git clean before bounded cleanup");
  assert.equal((ci.match(/run: node scripts\/clean-ci\.mjs/g) ?? []).length, 2,
    "CI must invoke the shared cleanup before validation and in the final always() step");
  assert.ok(cleanCiScript.includes('"build-google"'),
    "The delegated CI cleanup must remove the Google build output");
  assert.doesNotMatch(ci, /actions\/upload-artifact|Compress-Archive|retention-days:/, "CI must not upload build artifacts");
}

console.log(`Release validation passed: ${scope}`);
