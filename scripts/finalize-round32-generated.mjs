import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const write = (file, content) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};

write("scripts/validate-round32-static.mjs", `import assert from "node:assert/strict";
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
  assert.ok(fixtures.includes(marker), \`Round 32 fixture is missing: \${marker}\`);
}
for (const command of ["node scripts/run-round32-fixtures.mjs", "node scripts/validate-round32-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), \`npm test is missing \${command}\`);
  assert.ok(workflow.includes(command), \`CI is missing \${command}\`);
  assert.ok(selfHostedValidation.includes(command), \`Self-hosted CI contract is missing \${command}\`);
}

console.log("Round 32 static validation passed");
`);

write("docs/audit-2026-07-22-round-32.md", `# Deep audit round 32 — Browser Sync integrity self-healing

## Scope

Independent adversarial review of the exact \`master\` state produced by PR #108, with emphasis on the Round 31 complete-frame Browser Sync change, remote snapshot integrity, semantic checksum compatibility, concurrent device replacement, branch/PR completion, and CI regression wiring.

## Confirmed defects

1. The non-legacy Smart Sync equality path trusted \`startTabSyncMeta.contentChecksum\` without reading the active remote chunks. A missing, mixed, truncated, or corrupt frame could therefore be reported as \`unchanged\` indefinitely even though restore on another device would fail.
2. The legacy comparison path read its remote frame without confirming that metadata still described the same snapshot after the chunk read, so a concurrent replacement could be followed by a stale direction decision.
3. Content verification recalculated the semantic checksum only after \`migrateBackup()\`. Current exports can normalize during migration, so a valid frame could be rejected and rewritten on every sync even though its validated raw canonical checksum matched metadata.
4. A post-equality \`!localChanged && !remoteChanged\` branch was unreachable and obscured the actual conflict-state invariants.

## Corrections

- compare complete parsed metadata, including legacy/current framing;
- verify metadata again after every remote bundle read used for restore or sync direction decisions;
- verify semantic checksums against both the validated raw export and its migrated normalization, including compatible historical canonical forms;
- when local content matches remote metadata, validate whole-frame checksum, JSON, migration, and canonical content before returning \`unchanged\`;
- if that matching frame is corrupt and metadata is still stable, replace it with one complete local frame and return \`uploaded\`;
- if metadata changes during verification, abort rather than overwriting the newer snapshot;
- remove the unreachable conflict branch;
- add executable Round 32 corruption, no-op, and concurrent-replacement fixtures plus static and self-hosted CI contracts.

## Validation

The dedicated audit gate executes the Round 32 fixtures, static contract validation, TypeScript typecheck, the full extension build, blocker-only build, and Google-enabled build before packaging the source files for the GitHub App commit.

## External boundary

Repository automation cannot prove real cross-device Chrome propagation/throttling, Chrome Web Store review, production Google OAuth/API behavior, or physical browser interaction. These remain manual release checks and are not represented as automated proof.
`);

console.log("Round 32 generated files finalized");
