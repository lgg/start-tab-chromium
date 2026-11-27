import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
for (const suite of ["ui-editor-fixtures.mjs", "ui-widget-fixtures.mjs", "ui-page-fixtures.mjs", "worker-fixtures.mjs", "validation-edge-fixtures.mjs", "provider-edge-fixtures.mjs", "storage-edge-fixtures.mjs", "page-failure-fixtures.mjs", "widget-race-fixtures.mjs", "remaining-edge-fixtures.mjs", "sync-conflict-edge-fixtures.mjs", "residual-runtime-fixtures.mjs", "locale-recovery-fixtures.mjs", "onboarding-boundary-fixtures.mjs", "options-capacity-fixtures.mjs", "residual-page-races-fixtures.mjs"]) {
  // A stuck browser mock must identify its suite, not consume the whole
  // CI timeout without a useful failure. Keep every suite in the run.
  console.log("UI fixture start: " + suite);
  const result = spawnSync(process.execPath, ["--import", "./scripts/coverage-loader.mjs", "scripts/" + suite], {
    cwd: root, stdio: "inherit", timeout: 180_000, killSignal: "SIGKILL",
  });
  if (result.error || result.status !== 0) {
    failures.push(suite + ": " + (result.error ?? result.signal ?? result.status));
  } else {
    console.log("UI fixture passed: " + suite);
  }
}
if (failures.length) throw new Error("UI suite failures:\n" + failures.join("\n"));
