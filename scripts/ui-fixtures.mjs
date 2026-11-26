import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const suite of ["ui-editor-fixtures.mjs", "ui-widget-fixtures.mjs", "ui-page-fixtures.mjs", "worker-fixtures.mjs"]) {
  const result = spawnSync(process.execPath, ["--import", "./scripts/coverage-loader.mjs", "scripts/" + suite], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(suite + " failed: " + result.status);
}
