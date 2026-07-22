import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const chromeSync = read("src/lib/chrome-sync.ts");
const fixtures = read("scripts/round32-fixtures.ts");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");
const selfHostedValidation = read("scripts/validate-self-hosted-ci.mjs");

assert.ok(
  chromeSync.includes("function parsedMetaEqual(left: ParsedMeta | null, right: ParsedMeta)"),
  "Browser Sync must compare complete parsed metadata including legacy framing",
);
assert.ok(
  chromeSync.includes("async function readVerifiedRemoteBundle(parsed: ParsedMeta)"),
  "Remote bundle reads must verify metadata again after reading chunks",
);
assert.ok(
  chromeSync.includes("const rawBundle = value as BackupBundle;")
    && chromeSync.includes("acceptedChecksums.includes(meta.contentChecksum)"),
  "Browser Sync content verification must accept validated raw and migrated checksum forms",
);
const verificationIndex = chromeSync.indexOf("await readVerifiedRemoteBundle(remote);");
const repairIndex = chromeSync.indexOf("await writeRemoteSnapshot(localSnapshot);", verificationIndex);
assert.ok(
  verificationIndex >= 0 && repairIndex > verificationIndex,
  "Matching local content must verify and then repair a corrupt stable remote frame",
);
assert.ok(
  chromeSync.includes("Chrome sync backup changed concurrently while matching content was being verified"),
  "Repair must refuse to overwrite a concurrently replaced remote snapshot",
);
assert.ok(
  !chromeSync.includes("if (!localChanged && !remoteChanged)"),
  "The unreachable post-checksum unchanged branch must stay removed",
);

for (const marker of [
  "Matching metadata must not hide a corrupt remote Browser Sync frame",
  "An intact matching Browser Sync frame must remain a no-op",
  "Corruption repair must not overwrite a snapshot replaced during verification",
]) {
  assert.ok(fixtures.includes(marker), `Round 32 fixture is missing: ${marker}`);
}
for (const command of ["node scripts/run-round32-fixtures.mjs", "node scripts/validate-round32-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test is missing ${command}`);
  assert.ok(workflow.includes(command), `CI is missing ${command}`);
  assert.ok(selfHostedValidation.includes(command), `Self-hosted CI contract is missing ${command}`);
}

console.log("Round 32 static validation passed");
