import { mkdtemp, readFile, readdir, appendFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(tmpdir(), "start-tab-coverage-"));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run via npm run test:coverage");
try {
  const args = [npmCli, "exec", "--yes", "--package=c8@10.1.3", "--", "c8",
    "--all", "--src", "src", "--extension", ".ts", "--include", "src/**/*.ts",
    "--exclude-after-remap", "--reporter=text", "--reporter=json-summary",
    "--reports-dir", temporary, "--temp-directory", path.join(temporary, "raw"),
    "node", "scripts/run-coverage-fixtures.mjs"];
  const child = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error("Coverage run failed (" + child.status + ", " + child.signal + ")");
  const summary = JSON.parse(await readFile(path.join(temporary, "coverage-summary.json"), "utf8"));
  const entries = Object.entries(summary).filter(([name]) => name !== "total");
  const files = entries.map(([name]) => path.relative(root, name).replaceAll("\\", "/"));
  async function sourceFiles(directory) {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) result.push(...await sourceFiles(full));
      else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) result.push(path.relative(root, full).replaceAll("\\", "/"));
    }
    return result;
  }
  const expected = await sourceFiles(path.join(root, "src"));
  const missing = expected.filter(name => !files.includes(name));
  if (missing.length) throw new Error("Coverage report omitted source files: " + missing.join(", "));
  if (files.some(name => !expected.includes(name))) throw new Error("Coverage report contains files outside production source");
  if (!summary.total.lines.total || !summary.total.lines.covered) throw new Error("Empty or ineffective coverage report");
  const metric = (item, name) => item[name].pct + "% (" + item[name].covered + "/" + item[name].total + ")";
  const header = "| File | Lines | Functions | Branches | Statements |\n|---|---:|---:|---:|---:|";
  const row = (name, item) => "| " + name + " | " + ["lines", "functions", "branches", "statements"].map(key => metric(item, key)).join(" | ") + " |";
  const report = ["## Source coverage (c8 / V8)", "Production TypeScript only; includes files not imported by tests. V8 branch coverage is engine-derived; browser E2E is not measured here.", header,
    row("**All source**", summary.total), ...entries.sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => row(path.relative(root, name).replaceAll("\\", "/"), item))].join("\n");
  console.log(report);
  console.log("COVERAGE_TOTAL " + JSON.stringify({ ...summary.total, sourceFiles: expected.length, zeroLineFiles: entries.filter(([, item]) => item.lines.covered === 0).length }));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + "\n", "utf8");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
