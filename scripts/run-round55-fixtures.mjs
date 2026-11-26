import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run UI fixtures via npm run test:ui or npm test");
const child = spawnSync(process.execPath, [npm, "exec", "--yes", "--package=jsdom@26.1.0", "--", "node",
  "--import", "./scripts/coverage-loader.mjs", "scripts/ui-fixtures.mjs"], { cwd: root, stdio: "inherit" });
if (child.error) throw child.error;
if (child.status !== 0) throw new Error("UI fixtures failed: " + child.status);
