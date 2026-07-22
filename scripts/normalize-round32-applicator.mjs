import fs from "node:fs";
import path from "node:path";

const target = path.join(process.cwd(), "scripts/apply-round32-audit.mjs");
let source = fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n");

const originalRead = 'const read = (file) => fs.readFileSync(path.join(root, file), "utf8");';
source = source.replace(originalRead, 'const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\\r\\n/g, "\\n");');

const deadBranchTarget = '  `  if (!localChanged && !remoteChanged) { await writeLocalMeta(remote.meta); return "unchanged"; }\n`,\n  "",';
source = source.replace(deadBranchTarget, '  `  if (!localChanged && !remoteChanged) { await writeLocalMeta(remote.meta); return "unchanged"; }`,\n  "",');

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

source = source.replace(
  'fs.rmSync(path.join(root, ".github/workflows/apply-round32-audit.yml"), { force: true });',
  '// GitHub App removes the temporary workflow after packaging the validated source.',
);

fs.writeFileSync(target, source);
console.log("Round 32 applicator normalized with raw-aware checksum verification");
