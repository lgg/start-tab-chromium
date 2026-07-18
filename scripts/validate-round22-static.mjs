import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const packageJson = JSON.parse(read("package.json"));
const build = read("scripts/build.mjs");
const buildValidation = read("scripts/validate-build-output.mjs");
const options = read("src/options/options.ts");
const blocked = read("src/blocked/blocked.ts");
const deployment = read("docs/deployment-3.0.0.md");

assert.match(packageJson.scripts["build:google"], /node build\.mjs --google --outdir=build-google/,
  "Google-enabled packaging must select an explicit builder profile");
assert.match(packageJson.scripts.test, /run-round22-fixtures\.mjs/);
assert.match(packageJson.scripts.test, /validate-round22-static\.mjs/);

assert.match(build, /const googleEnabled = process\.argv\.includes\("--google"\)/);
assert.match(build, /googleEnabled && blockerOnly/,
  "Impossible Google blocker-only combinations must fail before output generation");
assert.match(build, /const googleOAuthClientId = googleEnabled \? process\.env\.GOOGLE_OAUTH_CLIENT_ID/,
  "Inherited OAuth environment values must be ignored outside the explicit Google profile");
assert.match(build, /if \(googleEnabled\)[\s\S]*manifest\.oauth2[\s\S]*else \{[\s\S]*delete manifest\.oauth2/,
  "Default profiles must always strip OAuth metadata and identity");

assert.match(buildValidation, /variant === "google"/,
  "Generated-output validation must distinguish Google from ordinary full builds");
assert.match(buildValidation, /Default and blocker-only builds must omit OAuth even when the environment contains a client ID/);

assert.match(options, /const startTabPageAvailable = chrome\.runtime\.getManifest\(\)\.chrome_url_overrides\?\.newtab === "newtab\.html"/,
  "Options must derive Start Tab availability from the selected manifest profile");
assert.match(options, /if \(startTabPageAvailable\) \{[\s\S]*chrome\.runtime\.getURL\("newtab\.html"\)/,
  "The Open Start Tab action must not exist in blocker-only builds");
assert.match(options, /startTabEnabled\.disabled = !startTabPageAvailable/,
  "Blocker-only Options must not expose an effective runtime Start Tab toggle");
assert.match(options, /next\.startTab\.enabled = startTabPageAvailable \? startTabEnabled\.checked : settings\.startTab\.enabled/,
  "Saving other blocker-only settings must preserve latent full-build Start Tab state");

assert.match(blocked, /blockedSiteForUrl/);
assert.match(blocked, /async function blockedHostIsActive\(\)/,
  "Blocked-page state must be verified against the current blocklist");
assert.match(blocked, /if \(host && !await blockedHostIsActive\(\)\)[\s\S]*location\.replace/,
  "Stale or manually opened blocked pages must leave without presenting an unblock action");
assert.match(blocked, /if \(!await blockedHostIsActive\(\)\) return "unchanged"/,
  "Countdown completion must recheck the current blocklist");
assert.match(blocked, /if \(result === "removed"\)[\s\S]*record-unblock/,
  "Countdown statistics must only be recorded for an actually active block");

assert.match(deployment, /inherited `GOOGLE_OAUTH_CLIENT_ID` value is ignored/,
  "Deployment documentation must describe deterministic default profiles");
assert.match(deployment, /does not offer the unavailable Open Start Tab action/,
  "Deployment documentation must describe blocker-only Options behavior");

console.log("Round 22 static validation passed");
