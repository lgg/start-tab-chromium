import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const options = read("src/options/options.ts");
const guard = read("src/options/action-guard.ts");
const settings = read("src/lib/start-page-settings.ts");
const runtime = read("src/lib/start-page-runtime.ts");
const messages = read("src/lib/messages.ts");
const worker = read("src/service-worker.ts");
const roadmap = read("docs/roadmap-implementation-2026-07-13.md");
const manualQa = read("docs/manual-qa-round40.md");
const audit = read("docs/audit-2026-08-01-round-40.md");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");
const selfHosted = read("scripts/validate-self-hosted-ci.mjs");

assert.match(guard, /class OptionsActionGuard/);
assert.match(guard, /if \(this\.active\) return false/);
assert.match(options, /if \(!actionGuard\.tryStart\(\)\) return/);
assert.match(options, /headerActions\.inert = busy[\s\S]*nav\.inert = busy[\s\S]*sections\.inert = busy/);
assert.match(options, /finally \{[\s\S]*actionGuard\.finish\(\)[\s\S]*setActionBusy\(false\)/);
assert.match(options, /catch \(error\) \{[\s\S]*await reloadState\(\);[\s\S]*render\(\)/,
  "Failed Options actions must reload canonical state");

for (const marker of [
  "updateBlockInstance(block.id, () => edited, block.updatedAt)",
  "setBlockEnabled(block.id, !block.enabled, block.updatedAt)",
  "duplicateBlockInstance(block.id, undefined, block.updatedAt)",
  "updateCustomTheme(edited, theme.updatedAt)",
  "duplicateTheme(theme.id, undefined, theme.updatedAt)",
  "deleteCustomTheme(theme.id, theme.updatedAt)",
]) assert.ok(options.includes(marker), `Options is missing stale-entity guard: ${marker}`);
assert.match(settings, /assertEntityRevision\(existing\.updatedAt, expectedUpdatedAt, "block"\)/);
assert.match(settings, /assertEntityRevision\(existing\.updatedAt, expectedUpdatedAt, "theme"\)/);
assert.match(settings, /theme changed or was removed in another extension context/);
assert.match(settings, /getBuiltInTheme\(themeId\)[\s\S]*current\.themes\.customThemes\.find[\s\S]*if \(!source\)/,
  "Theme duplication must resolve the exact requested source and reject deleted custom themes");

assert.match(messages, /delete-instance-runtime"; instanceId: string; expectedBlockUpdatedAt: number; expectedRuntimeUpdatedAt: number/);
assert.match(messages, /case "delete-instance-runtime":[\s\S]*expectedBlockUpdatedAt[\s\S]*expectedRuntimeUpdatedAt/);
assert.match(options, /deleteInstanceRuntime\(block\.id, block\.updatedAt, runtime\.updatedAt\)/);
assert.match(worker, /deleteInstanceRuntime\([\s\S]*message\.expectedBlockUpdatedAt,[\s\S]*message\.expectedRuntimeUpdatedAt/);
assert.match(runtime, /block\.updatedAt !== expectedBlockUpdatedAt/);
assert.match(runtime, /runtime\.updatedAt !== expectedRuntimeUpdatedAt/);

assert.equal((roadmap.match(/^- \[ \]/gm) ?? []).length, 0, "Completed roadmap must not contain pending checklist items");
assert.equal((roadmap.match(/^- \[x\]/gm) ?? []).length, 17, "All 17 original roadmap requirements must be marked complete");
assert.match(roadmap, /reverified through the Round 40 full-project audit/);

for (const command of ["node scripts/run-round40-fixtures.mjs", "node scripts/validate-round40-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test must include ${command}`);
  assert.ok(workflow.includes(command), `CI must include ${command}`);
  assert.ok(selfHosted.includes(command), `Self-hosted contract must include ${command}`);
}
for (const phrase of ["stale dialog", "Clear instance data", "double-activate", "canonical current state", "roadmap"]) {
  assert.ok(manualQa.includes(phrase), `Round 40 manual QA is missing: ${phrase}`);
}
for (const phrase of ["stale dialog", "single-flight", "runtime revision", "roadmap checklist"]) {
  assert.ok(audit.includes(phrase), `Round 40 audit is missing: ${phrase}`);
}

console.log("Round 40 static validation passed");
