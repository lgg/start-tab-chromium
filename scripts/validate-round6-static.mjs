import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");
const [messages, blocklist, settings, runtime, sync, gate, newtab, integrations, staticRenderers] = await Promise.all([
  read("src/lib/messages.ts"),
  read("src/lib/blocklist.ts"),
  read("src/lib/start-page-settings.ts"),
  read("src/lib/start-page-runtime.ts"),
  read("src/lib/chrome-sync.ts"),
  read("src/newtab/newtab-gate.js"),
  read("src/newtab/newtab.ts"),
  read("src/newtab/block-renderers-integrations.ts"),
  read("src/newtab/block-renderers-static.ts"),
]);

for (const type of ["replace-blocked-sites", "open-native-new-tab", "reset-start-page"]) {
  assert.ok(messages.includes(type), `messages.ts must validate ${type}`);
}
assert.match(blocklist, /runMutation/, "Blocklist mutations must be serialized");
assert.match(blocklist, /migrationPromise = undefined/, "Transient migration failures must remain retryable");
assert.match(settings, /changed in another extension context/, "Settings must reject stale snapshots");
assert.match(runtime, /changed in another extension context/, "Runtime must reject stale snapshots");
assert.match(runtime, /resetStartPageRuntimeState/, "Runtime reset must be centralized");
assert.match(sync, /isPristineBackup/, "Sync must protect a pre-existing remote snapshot on a clean device");
assert.match(sync, /Object\.keys\(value\).*sort/s, "Canonical sync JSON must sort object keys");
assert.doesNotMatch(gate, /chrome\.tabs\.create|startTabNativeNewTabBypass/, "The early gate must not create native tabs or own bypass state directly");
assert.match(gate, /runtime\.sendMessage/, "The early gate must delegate native-tab creation to the service worker");
assert.doesNotMatch(newtab, /nativeNewTabButton\.addEventListener/, "The main new-tab runtime must not install a duplicate native-tab click handler");
assert.match(integrations, /cachedRequest/, "Integration renderers must cache request promises across rerenders");
assert.match(staticRenderers, /cachedRequest/, "Static external-data renderers must cache request promises across rerenders");
for (const source of [integrations, staticRenderers]) assert.match(source, /isConnected|attached\(/, "Async renderers must guard detached DOM updates");

const temporary = await mkdtemp(path.join(tmpdir(), "start-tab-round6-"));
try {
  const outfile = path.join(temporary, "round6-fixtures.mjs");
  await build({
    entryPoints: [path.join(root, "scripts/round6-fixtures.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "silent",
  });
  await import(`${pathToFileURL(outfile).href}?run=${Date.now()}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log("Round 6 static validation passed");
