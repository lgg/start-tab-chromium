import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const build = read("scripts/build.mjs");
const outputGuard = read("scripts/build-output-path.mjs");
const oauth = read("scripts/google-oauth-client.mjs");
const blocklist = read("src/lib/blocklist.ts");
const fixtures = read("scripts/round24-fixtures.ts");
const readme = read("README.md");
const deployment = read("docs/deployment-3.0.0.md");
const release = read("docs/release.md");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");

assert.match(build, /assertSafeBuildOutputFilesystem/,
  "Builder must import the filesystem-aware output guard");
assert.ok(build.indexOf("await assertSafeBuildOutputFilesystem") < build.indexOf("await rm(outdir"),
  "Filesystem link validation must run before recursive output cleanup");
assert.match(outputGuard, /lstat/,
  "Output guard must inspect existing path components without following them");
assert.match(outputGuard, /isSymbolicLink\(\)/,
  "Output guard must reject symbolic links and Windows junctions");
assert.match(outputGuard, /symbolic link or junction/,
  "Output guard must expose a clear destructive-path rejection");

assert.match(blocklist, /storedSitesEqual/,
  "Blocklist mutations must compare canonical stored sites before writing");
assert.match(blocklist, /storedLastBlockedUrlsEqual/,
  "Blocklist mutations must compare canonical URL side data before writing");
assert.match(blocklist, /if \(storedSitesEqual\([\s\S]*storedLastBlockedUrlsEqual\([\s\S]*return previousSites/,
  "Canonical no-op mutations must return before storage, DNR, or revision writes");
assert.match(blocklist, /if \(ownValue\(urls, host\) === url\) return;/,
  "Identical blocked-navigation metadata must not advance the data revision");

for (const token of ["EXAMPLE", "YOUR", "CHANGEME", "PLACEHOLDER"]) {
  assert.ok(oauth.includes(token), `OAuth validation must reject common placeholder token: ${token}`);
}
for (const [name, source] of [["README", readme], ["deployment", deployment], ["release", release]]) {
  assert.ok(source.includes("REPLACE_WITH_REAL_CLIENT_ID.apps.googleusercontent.com"),
    `${name} must show an explicitly rejected OAuth placeholder`);
  assert.doesNotMatch(source, /1234567890-example\.apps\.googleusercontent\.com/,
    `${name} must not show a syntactically accepted fake OAuth client ID`);
  assert.match(source, /intentionally rejected/,
    `${name} must explain that the shown placeholder cannot be built as-is`);
}

assert.match(fixtures, /process\.platform === "win32" \? "junction" : "dir"/,
  "Round 24 must exercise a real Windows junction or POSIX directory symlink");
assert.match(fixtures, /recursive cleanup must not cross this link/,
  "Round 24 must preserve data outside a linked output path");
assert.match(fixtures, /Canonical duplicate block operations must not advance the sync revision/);
assert.match(fixtures, /Remembering the identical blocked URL twice must not advance the sync revision/);
assert.match(fixtures, /1234567890-example\.apps\.googleusercontent\.com/,
  "Round 24 must reject the previously copyable fake OAuth ID");

for (const command of ["node scripts/run-round24-fixtures.mjs", "node scripts/validate-round24-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test is missing ${command}`);
  assert.ok(workflow.includes(command), `CI is missing ${command}`);
}

console.log("Round 24 static validation passed");
