import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const build = read("scripts/build.mjs");
const outputGuard = read("scripts/build-output-path.mjs");
const oauth = read("scripts/google-oauth-client.mjs");
const oauthGuard = read("scripts/require-google-oauth.mjs");
const outputValidator = read("scripts/validate-build-output.mjs");
const messages = read("src/lib/messages.ts");
const blocklist = read("src/lib/blocklist.ts");
const worker = read("src/service-worker.ts");
const blocked = read("src/blocked/blocked.ts");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");

assert.match(build, /resolveSafeBuildOutput\(root, tmpdir\(\), requestedOutdir\)/,
  "Builder must validate the output path before recursive cleanup");
assert.match(build, /const googleOAuthClientId = googleEnabled \? requireGoogleOAuthClientId\(\) : ""/,
  "Google credentials must be validated before output cleanup or compilation");
assert.ok(build.indexOf("requireGoogleOAuthClientId()") < build.indexOf("await rm(outdir"),
  "Google profile validation must run before existing output is removed");
assert.match(outputGuard, /Repository-local outputs must live under a top-level build\* path/);
assert.match(outputGuard, /External build output must be inside the operating-system temp directory/);
assert.match(outputGuard, /Refusing to use the repository or its parent as build output/);

assert.match(oauth, /PLACEHOLDER_PATTERN/);
assert.match(oauth, /REPLACE\|TODO/,
  "OAuth validation must reject documented placeholder IDs");
assert.match(oauthGuard, /requireGoogleOAuthClientId\(\)/,
  "The npm Google guard must use shared placeholder-safe validation");
assert.match(outputValidator, /isValidGoogleOAuthClientId\(configuredGoogleClientId\)/,
  "Generated Google build validation must reject placeholder credentials too");

assert.match(messages, /changed\?: boolean/,
  "Worker acknowledgements must expose whether a mutation actually changed state");
assert.match(blocklist, /export async function unblockHost\(host: string\): Promise<boolean>/,
  "Unblock operations must return an atomic mutation result");
assert.match(blocklist, /if \(!sites\.includes\(normalized\)\) return false;/,
  "A stale unblock must remain a no-op inside the serialized mutation queue");
assert.match(worker, /case "unblock": return \{ changed: await unblockHost\(message\.host\) \};/,
  "The service worker must return the actual serialized unblock result");
assert.match(worker, /sendResponse\(\{ ok: true, \.\.\.\(result \?\? \{\}\) \}\)/,
  "Worker message results must reach the calling extension page");
assert.match(blocked, /return ack\.changed === true \? "removed" : "unchanged";/,
  "The blocked page must not infer removal from a generic successful acknowledgement");
assert.match(blocked, /if \(result === "removed"\)[\s\S]*record-unblock/,
  "Countdown statistics must remain conditional on a confirmed removal");

for (const command of ["node scripts/run-round23-fixtures.mjs", "node scripts/validate-round23-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test is missing ${command}`);
  assert.ok(workflow.includes(command), `CI is missing ${command}`);
}

console.log("Round 23 static validation passed");
