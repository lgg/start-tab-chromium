import { readFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const commands = pkg.scripts.test.split(" && ").map(command => command.match(/^node scripts\/run-(round\d+)-fixtures\.mjs$/)).filter(Boolean);
if (!commands.length) throw new Error("No fixture suites found in npm test");
for (const [, suite] of commands) {
  const source = path.join(root, "scripts", suite + "-fixtures.ts");
  let hasSource = true;
  try { await access(source); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    hasSource = false;
  }
  const args = hasSource
    ? ["--import", path.join(root, "scripts", "coverage-loader.mjs"), source]
    : [path.join(root, "scripts", "run-" + suite + "-fixtures.mjs")];
  console.log("Coverage fixture: " + suite);
  const child = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error("Coverage fixture failed: " + suite + " (" + child.status + ", " + child.signal + ")");
}
