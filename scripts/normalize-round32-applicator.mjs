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

fs.writeFileSync(target, source);
console.log("Round 32 applicator normalized for Windows checkout");
