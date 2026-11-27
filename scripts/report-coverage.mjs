import { mkdtemp, readFile, readdir, appendFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(tmpdir(), "start-tab-coverage-"));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run via npm run test:coverage");
try {
  const args = [npmCli, "exec", "--yes", "--package=c8@10.1.3", "--", "c8",
    "--all", "--src", "src", "--extension", ".ts", "--extension", ".js", "--include", "src/**/*.ts", "--include", "src/**/*.js",
    "--exclude-after-remap", "--reporter=text", "--reporter=json-summary", "--reporter=json",
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
      else if (entry.isFile() && /\.(ts|js)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) result.push(path.relative(root, full).replaceAll("\\", "/"));
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
  const report = ["## Source coverage (c8 / V8)", "Production TypeScript and JavaScript; includes files not imported by tests. V8 branch coverage is engine-derived; browser E2E is not measured here.", header,
    row("**All source**", summary.total), ...entries.sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => row(path.relative(root, name).replaceAll("\\", "/"), item))].join("\n");
  console.log(report);
  // c8 --all synthesizes an empty function/statement report for an unimported
  // type-only TypeScript module. Such declarations are checked by tsc, not
  // executable by V8. Keep the original report and floors, but also disclose
  // a separately counted executable-source total. Only syntactically proven
  // type-only modules qualify; a file with ANY value import or statement
  // stays in the executable denominator even if it was never imported.
  const declarationOnly = [];
  for (const [name, item] of entries) {
    if (!name.endsWith(".ts") || item.lines.covered !== 0) continue;
    const source = ts.createSourceFile(name, await readFile(name, "utf8"), ts.ScriptTarget.Latest, true);
    if (source.parseDiagnostics.length === 0 && source.statements.length > 0 &&
        source.statements.every(node => ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ||
          (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly === true) ||
          (ts.isExportDeclaration(node) && node.isTypeOnly === true))) {
      declarationOnly.push([name, item]);
    }
  }
  const declarationPaths = declarationOnly.map(([name]) => path.relative(root, name).replaceAll("\\\\", "/"));
  const executable = Object.fromEntries(["lines", "statements", "functions", "branches"].map(key => {
    const excludedTotal = declarationOnly.reduce((n, [, item]) => n + item[key].total, 0);
    const excludedCovered = declarationOnly.reduce((n, [, item]) => n + item[key].covered, 0);
    const total = summary.total[key].total - excludedTotal;
    const covered = summary.total[key].covered - excludedCovered;
    return [key, { total, covered, pct: total === 0 ? 100 : Math.floor(10000 * covered / total) / 100 }];
  }));
  const executableReport = [
    "## Executable source coverage (supplementary; raw c8 report unchanged)",
    "Type-only modules checked by TypeScript, not executed by V8: " + (declarationPaths.join(", ") || "none"),
    header, row("**Executable source**", executable)
  ].join("\n");
  console.log(executableReport);
  console.log("COVERAGE_EXECUTABLE_TOTAL " + JSON.stringify({ ...executable, typeOnlyFiles: declarationPaths, sourceFiles: expected.length - declarationOnly.length }));
  // Keep exact missed ranges in logs for targeted follow-up; the temporary
  // report stays local to the runner and is removed in finally.
  const detail = JSON.parse(await readFile(path.join(temporary, "coverage-final.json"), "utf8"));
  for (const [name, file] of Object.entries(detail).sort(([a], [b]) => a.localeCompare(b))) {
    const relative = path.relative(root, name).replaceAll("\\", "/");
    const missedFunctions = Object.entries(file.f ?? {}).flatMap(([id, count]) => {
      if (count !== 0) return [];
      const fn = file.fnMap?.[id];
      return fn?.loc ? [`${fn.name ?? "(anonymous)"}@${fn.loc.start.line}:${fn.loc.start.column}-${fn.loc.end.line}:${fn.loc.end.column}`] : [];
    });
    if (missedFunctions.length) console.log("UNCOVERED_FUNCTIONS " + relative + " " + missedFunctions.join(", "));
    // c8's source-derived statement ranges can span more than one line.
    // Report exact missed ranges, preserving the original measurement.
    const missedStatements = Object.entries(file.s ?? {}).flatMap(([id, count]) => {
      if (count !== 0) return [];
      const loc = file.statementMap?.[id];
      return loc ? [`${loc.start.line}:${loc.start.column}-${loc.end.line}:${loc.end.column}`] : [];
    });
    if (missedStatements.length) console.log("UNCOVERED_STATEMENTS " + relative + " " + missedStatements.join(", "));
    const missed = Object.entries(file.b ?? {}).flatMap(([id, counts]) =>
      counts.flatMap((count, index) => {
        if (count !== 0) return [];
        const loc = file.branchMap?.[id]?.locations?.[index];
        return loc ? [`${loc.start.line}:${loc.start.column}-${loc.end.line}:${loc.end.column}`] : [];
      }));
    if (missed.length) console.log("UNCOVERED_BRANCHES " + path.relative(root, name).replaceAll("\\", "/") + " " + missed.join(", "));
  }
  console.log("COVERAGE_TOTAL " + JSON.stringify({ ...summary.total, sourceFiles: expected.length, zeroLineFiles: entries.filter(([, item]) => item.lines.covered === 0).length }));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + "\n\n" + executableReport + "\n", "utf8");
  // Enforce verified floors without pretending the 90% branch target is met.
  const minimum = { lines: 95, statements: 95, functions: 95, branches: 85 };
  const below = Object.entries(minimum).filter(([key, floor]) => summary.total[key].pct < floor);
  if (below.length) throw new Error("Coverage regression: " + below.map(([key, floor]) => key + " " + summary.total[key].pct + "% < " + floor + "%").join("; "));
  console.log("Coverage floors passed (95% lines/statements/functions, 85% branches; branch goal 90%).");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
