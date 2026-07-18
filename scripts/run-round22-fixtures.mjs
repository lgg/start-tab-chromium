import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(tmpdir(), "start-tab-round22-"));
const inheritedClientId = "round22-inherited.apps.googleusercontent.com";
const explicitClientId = "round22-explicit.apps.googleusercontent.com";

async function runBuild(args, clientId) {
  const env = { ...process.env };
  if (clientId === undefined) delete env.GOOGLE_OAUTH_CLIENT_ID;
  else env.GOOGLE_OAUTH_CLIENT_ID = clientId;
  return execute(process.execPath, [path.join(root, "build.mjs"), ...args], {
    cwd: root,
    env,
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function manifest(directory) {
  return JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
}

function assertGoogleDisabled(value, label) {
  assert.equal(value.oauth2, undefined, `${label} must ignore inherited Google OAuth configuration`);
  assert.equal(value.permissions?.includes("identity"), false, `${label} must omit identity`);
}

try {
  const fullDirectory = path.join(temporary, "full");
  await runBuild([`--outdir=${fullDirectory}`], inheritedClientId);
  const full = await manifest(fullDirectory);
  assertGoogleDisabled(full, "Default full build");
  assert.equal(full.chrome_url_overrides?.newtab, "newtab.html");

  const blockerDirectory = path.join(temporary, "blocker");
  await runBuild(["--without-newtab", `--outdir=${blockerDirectory}`], inheritedClientId);
  const blocker = await manifest(blockerDirectory);
  assertGoogleDisabled(blocker, "Blocker-only build");
  assert.equal(blocker.chrome_url_overrides, undefined);
  assert.equal(blocker.permissions?.includes("history"), false);

  const googleDirectory = path.join(temporary, "google");
  await runBuild(["--google", `--outdir=${googleDirectory}`], explicitClientId);
  const google = await manifest(googleDirectory);
  assert.equal(google.oauth2?.client_id, explicitClientId);
  assert.equal(google.permissions?.includes("identity"), true);
  assert.equal(google.chrome_url_overrides?.newtab, "newtab.html");

  await assert.rejects(
    () => runBuild(["--google", "--without-newtab", `--outdir=${path.join(temporary, "invalid-mixed")}`], explicitClientId),
    (error) => String(error?.stderr ?? error).includes("cannot be combined with blocker-only mode"),
    "Google and blocker-only flags must be rejected as an impossible build profile",
  );

  await assert.rejects(
    () => runBuild(["--google", `--outdir=${path.join(temporary, "missing-client")}`], undefined),
    (error) => String(error?.stderr ?? error).includes("GOOGLE_OAUTH_CLIENT_ID is required"),
    "The explicit Google profile must fail without a client ID",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log("Round 22 fixtures passed");
