import fs from "node:fs";
import path from "node:path";

const target = path.join(process.cwd(), "scripts/apply-round32-audit.mjs");
let source = fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n");

const originalRead = 'const read = (file) => fs.readFileSync(path.join(root, file), "utf8");';
const normalizedRead = 'const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\\r\\n/g, "\\n");';
if (!source.includes(originalRead)) throw new Error("Round 32 applicator read helper changed unexpectedly");
source = source.replace(originalRead, normalizedRead);

const deadBranchTarget = '  `  if (!localChanged && !remoteChanged) { await writeLocalMeta(remote.meta); return "unchanged"; }\n`,\n  "",';
const correctedDeadBranchTarget = '  `  if (!localChanged && !remoteChanged) { await writeLocalMeta(remote.meta); return "unchanged"; }`,\n  "",';
if (!source.includes(deadBranchTarget)) throw new Error("Round 32 dead-branch target changed unexpectedly");
source = source.replace(deadBranchTarget, correctedDeadBranchTarget);

const checksumValidation = `  const bundle = migrateBackup(value);
  if (!parsed.legacy) {
    const currentChecksum = await checksum(canonicalBackupContent(bundle));
    const previousChecksum = await checksum(previousCanonicalBackupContent(bundle));
    const legacyChecksum = await checksum(legacyCanonicalBackupContent(bundle));
    if (currentChecksum !== meta.contentChecksum
      && previousChecksum !== meta.contentChecksum
      && legacyChecksum !== meta.contentChecksum) {
      throw new Error("Chrome sync backup content checksum mismatch");
    }
  }`;
const rawAwareChecksumValidation = `  const bundle = migrateBackup(value);
  if (!parsed.legacy) {
    const rawBundle = value as BackupBundle;
    const acceptedChecksums = await Promise.all([
      checksum(canonicalBackupContent(rawBundle)),
      checksum(previousCanonicalBackupContent(rawBundle)),
      checksum(legacyCanonicalBackupContent(rawBundle)),
      checksum(canonicalBackupContent(bundle)),
      checksum(previousCanonicalBackupContent(bundle)),
      checksum(legacyCanonicalBackupContent(bundle)),
    ]);
    if (!acceptedChecksums.includes(meta.contentChecksum)) {
      throw new Error("Chrome sync backup content checksum mismatch");
    }
  }`;
if (!source.includes(checksumValidation)) throw new Error("Round 32 checksum validation target changed unexpectedly");
source = source.replace(checksumValidation, rawAwareChecksumValidation);

const staticRemoteReadAssertion = `assert.match(chromeSync, /async function readVerifiedRemoteBundle\\(parsed: ParsedMeta\\)/,
  "Remote bundle reads must verify metadata again after reading chunks");`;
const staticRawChecksumAssertion = `${staticRemoteReadAssertion}
assert.match(chromeSync, /const rawBundle = value as BackupBundle;[\\s\\S]*acceptedChecksums\\.includes\\(meta\\.contentChecksum\\)/,
  "Browser Sync content verification must accept the validated raw export checksum before migration normalization");`;
if (!source.includes(staticRemoteReadAssertion)) throw new Error("Round 32 static checksum assertion anchor changed unexpectedly");
source = source.replace(staticRemoteReadAssertion, staticRawChecksumAssertion);

const defectList = `1. The non-legacy Smart Sync equality path trusted \\`startTabSyncMeta.contentChecksum\\` without reading the active remote chunks. A missing, mixed, truncated, or corrupt frame could therefore be reported as \\`unchanged\\` indefinitely even though restore on another device would fail.
2. The legacy comparison path read its remote frame without confirming that metadata still described the same snapshot after the chunk read, so a concurrent replacement could be followed by a stale direction decision.
3. A post-equality \\`!localChanged && !remoteChanged\\` branch was unreachable and obscured the actual conflict-state invariants.`;
const expandedDefectList = `1. The non-legacy Smart Sync equality path trusted \\`startTabSyncMeta.contentChecksum\\` without reading the active remote chunks. A missing, mixed, truncated, or corrupt frame could therefore be reported as \\`unchanged\\` indefinitely even though restore on another device would fail.
2. The legacy comparison path read its remote frame without confirming that metadata still described the same snapshot after the chunk read, so a concurrent replacement could be followed by a stale direction decision.
3. Content verification recalculated the semantic checksum only after \\`migrateBackup()\\`. Current exports can normalize during migration, so a valid frame could be rejected and rewritten on every sync even though its raw canonical checksum matched metadata.
4. A post-equality \\`!localChanged && !remoteChanged\\` branch was unreachable and obscured the actual conflict-state invariants.`;
if (!source.includes(defectList)) throw new Error("Round 32 audit defect list changed unexpectedly");
source = source.replace(defectList, expandedDefectList);

const correctionAnchor = `- verify metadata again after every remote bundle read used for restore or sync direction decisions;`;
const correctionExpanded = `${correctionAnchor}
- verify content checksums against both the validated raw export and its migrated normalization for current and compatible historical canonical forms;`;
if (!source.includes(correctionAnchor)) throw new Error("Round 32 audit correction list changed unexpectedly");
source = source.replace(correctionAnchor, correctionExpanded);

const workflowCleanup = 'fs.rmSync(path.join(root, ".github/workflows/apply-round32-audit.yml"), { force: true });';
if (!source.includes(workflowCleanup)) throw new Error("Round 32 workflow cleanup changed unexpectedly");
source = source.replace(workflowCleanup, '// GitHub App removes the temporary workflow after packaging the validated source.');

fs.writeFileSync(target, source);
console.log("Round 32 applicator normalized with raw-aware checksum verification");
