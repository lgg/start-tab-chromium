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

const workflowCleanup = 'fs.rmSync(path.join(root, ".github/workflows/apply-round32-audit.yml"), { force: true });';
if (!source.includes(workflowCleanup)) throw new Error("Round 32 workflow cleanup changed unexpectedly");
source = source.replace(workflowCleanup, '// GitHub App removes the temporary workflow after the validated source push.');

const noOpFixture = `syncSetCalls = 0;
assert.equal(
  await chromeSync.syncChromeSyncBackup(),
  "unchanged",
  "An intact matching Browser Sync frame must remain a no-op",
);
assert.equal(syncSetCalls, 0, "Intact matching Browser Sync content must not be rewritten");`;
const instrumentedNoOpFixture = `const backupModule = await import("../src/lib/backup.js");
async function fixtureChecksum(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
const repairedMeta = clone(syncStorage.startTabSyncMeta as Record<string, unknown>);
const repairedChunkCount = Number(repairedMeta.chunks);
const repairedJson = Array.from({ length: repairedChunkCount }, (_, index) => String(syncStorage[\`startTabSyncChunk\${index}\`] ?? "")).join("");
const repairedBundle = backupModule.migrateBackup(JSON.parse(repairedJson));
const localBundleBeforeNoOp = await backupModule.exportBackup();
console.log("Round 32 checksum diagnostic", JSON.stringify({
  metaFrameChecksum: repairedMeta.checksum,
  actualFrameChecksum: await fixtureChecksum(repairedJson),
  metaContentChecksum: repairedMeta.contentChecksum,
  migratedRemoteContentChecksum: await fixtureChecksum(chromeSync.canonicalBackupContent(repairedBundle)),
  localContentChecksum: await fixtureChecksum(chromeSync.canonicalBackupContent(localBundleBeforeNoOp)),
}));
syncSetCalls = 0;
const intactResult = await chromeSync.syncChromeSyncBackup();
console.log("Round 32 no-op result", intactResult, JSON.stringify(syncStorage.startTabSyncMeta));
assert.equal(
  intactResult,
  "unchanged",
  "An intact matching Browser Sync frame must remain a no-op",
);
assert.equal(syncSetCalls, 0, "Intact matching Browser Sync content must not be rewritten");`;
if (!source.includes(noOpFixture)) throw new Error("Round 32 no-op fixture changed unexpectedly");
source = source.replace(noOpFixture, instrumentedNoOpFixture);

fs.writeFileSync(target, source);
console.log("Round 32 applicator normalized and checksum diagnostics injected");
