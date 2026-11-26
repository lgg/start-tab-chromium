import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
for (const suite of ["ui-editor-fixtures.mjs", "ui-widget-fixtures.mjs", "ui-page-fixtures.mjs", "worker-fixtures.mjs", "validation-edge-fixtures.mjs"]) {
  const result = spawnSync(process.execPath, ["--import", "./scripts/coverage-loader.mjs", "scripts/" + suite], { cwd: root, stdio: "inherit" });
  if (result.error || result.status !== 0) failures.push(suite + ": " + (result.error ?? result.status));
}
if (failures.length) throw new Error("UI suite failures:\n" + failures.join("\n"));
