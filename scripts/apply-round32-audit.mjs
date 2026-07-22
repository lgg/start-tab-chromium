import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const write = (file, content) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};

function replaceExactly(file, before, after) {
  const source = read(file);
  const first = source.indexOf(before);
  const last = source.lastIndexOf(before);
  if (first < 0 || first !== last) {
    throw new Error(`${file}: expected exactly one replacement target`);
  }
  write(file, `${source.slice(0, first)}${after}${source.slice(first + before.length)}`);
}

const metaEquality = `function syncMetaEqual(left: SyncMeta, right: SyncMeta): boolean {
  return left.version === right.version
    && left.updatedAt === right.updatedAt
    && left.contentUpdatedAt === right.contentUpdatedAt
    && left.deviceId === right.deviceId
    && left.snapshotId === right.snapshotId
    && left.checksum === right.checksum
    && left.contentChecksum === right.contentChecksum
    && left.chunks === right.chunks
    && left.backupVersion === right.backupVersion;
}`;
replaceExactly("src/lib/chrome-sync.ts", metaEquality, `${metaEquality}
function parsedMetaEqual(left: ParsedMeta | null, right: ParsedMeta): boolean {
  return left !== null && left.legacy === right.legacy && syncMetaEqual(left.meta, right.meta);
}`);

const remoteBundle = `async function readRemoteBundle(parsed: ParsedMeta): Promise<BackupBundle> {
  const { meta } = parsed;
  const keys = Array.from({ length: meta.chunks }, (_, index) => chunkKey(index));
  const values = await chrome.storage.sync.get(keys);
  const chunks = keys.map((key) => values[key]);
  if (!chunks.every((chunk): chunk is string => typeof chunk === "string")) throw new Error("Chrome sync backup is incomplete");
  const json = chunks.join("");
  if (await checksum(json) !== meta.checksum) throw new Error("Chrome sync backup checksum mismatch");
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error("Chrome sync backup contains invalid JSON"); }
  const bundle = migrateBackup(value);
  if (!parsed.legacy) {
    const currentChecksum = await checksum(canonicalBackupContent(bundle));
    const previousChecksum = await checksum(previousCanonicalBackupContent(bundle));
    const legacyChecksum = await checksum(legacyCanonicalBackupContent(bundle));
    if (currentChecksum !== meta.contentChecksum
      && previousChecksum !== meta.contentChecksum
      && legacyChecksum !== meta.contentChecksum) {
      throw new Error("Chrome sync backup content checksum mismatch");
    }
  }
  return bundle;
}`;
replaceExactly("src/lib/chrome-sync.ts", remoteBundle, `${remoteBundle}
async function assertRemoteMetaUnchanged(parsed: ParsedMeta, message: string): Promise<void> {
  if (!parsedMetaEqual(await readRemoteMeta(), parsed)) throw new Error(message);
}
async function readVerifiedRemoteBundle(parsed: ParsedMeta): Promise<BackupBundle> {
  const bundle = await readRemoteBundle(parsed);
  await assertRemoteMetaUnchanged(parsed, "Chrome sync backup changed concurrently while it was being verified");
  return bundle;
}`);

replaceExactly(
  "src/lib/chrome-sync.ts",
  `async function restoreParsedSnapshot(parsed: ParsedMeta): Promise<void> {
  const bundle = await readRemoteBundle(parsed);
  const currentRemote = await readRemoteMeta();
  if (!currentRemote || currentRemote.legacy !== parsed.legacy || !syncMetaEqual(currentRemote.meta, parsed.meta)) {
    throw new Error("Chrome sync backup changed concurrently while it was being restored");
  }
  await importBackup(bundle, { dataRevisionAt: parsed.meta.contentUpdatedAt });`,
  `async function restoreParsedSnapshot(parsed: ParsedMeta): Promise<void> {
  const bundle = await readVerifiedRemoteBundle(parsed);
  await importBackup(bundle, { dataRevisionAt: parsed.meta.contentUpdatedAt });`,
);

replaceExactly(
  "src/lib/chrome-sync.ts",
  `    const remoteBundle = await readRemoteBundle(remote);`,
  `    const remoteBundle = await readVerifiedRemoteBundle(remote);`,
);

replaceExactly(
  "src/lib/chrome-sync.ts",
  `  if (localSnapshot.contentChecksum === remote.meta.contentChecksum) { await writeLocalMeta(remote.meta); return "unchanged"; }`,
  `  if (localSnapshot.contentChecksum === remote.meta.contentChecksum) {
    try {
      await readVerifiedRemoteBundle(remote);
    } catch (error) {
      let currentRemote: ParsedMeta | null;
      try {
        currentRemote = await readRemoteMeta();
      } catch (metadataError) {
        throw new AggregateError([error, metadataError], "Matching Chrome sync backup verification and metadata refresh both failed");
      }
      if (!parsedMetaEqual(currentRemote, remote)) {
        throw new AggregateError([error], "Chrome sync backup changed concurrently while matching content was being verified");
      }
      await writeRemoteSnapshot(localSnapshot);
      return "uploaded";
    }
    await writeLocalMeta(remote.meta);
    return "unchanged";
  }`,
);

replaceExactly(
  "src/lib/chrome-sync.ts",
  `  if (!localChanged && !remoteChanged) { await writeLocalMeta(remote.meta); return "unchanged"; }
`,
  "",
);

write("scripts/round32-fixtures.ts", `import assert from "node:assert/strict";

let localStorage: Record<string, unknown> = {};
let syncStorage: Record<string, unknown> = {};
let syncSetCalls = 0;
let replaceMetaAfterChunkRead: Record<string, unknown> | null = null;

function clone<T>(value: T): T { return structuredClone(value); }
function keysFor(area: Record<string, unknown>, keys?: string | string[] | Record<string, unknown> | null): string[] {
  if (keys == null) return Object.keys(area);
  if (typeof keys === "string") return [keys];
  if (Array.isArray(keys)) return keys;
  return Object.keys(keys);
}
function selected(area: Record<string, unknown>, keys?: string | string[] | Record<string, unknown> | null): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of keysFor(area, keys)) {
    if (Object.prototype.hasOwnProperty.call(area, key)) output[key] = clone(area[key]);
    else if (keys && typeof keys === "object" && !Array.isArray(keys)) output[key] = clone(keys[key]);
  }
  return output;
}
function setItems(area: Record<string, unknown>, items: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(items)) area[key] = clone(value);
}
function removeItems(area: Record<string, unknown>, keys: string | string[]): void {
  for (const key of Array.isArray(keys) ? keys : [keys]) delete area[key];
}

const chromeMock = {
  runtime: {
    getURL: (relativePath: string) => \`chrome-extension://round32/\${relativePath}\`,
    getManifest: () => ({ manifest_version: 3, name: "Round 32", version: "1" }),
    sendMessage: async () => ({ ok: true }),
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | Record<string, unknown> | null) => selected(localStorage, keys),
      set: async (items: Record<string, unknown>) => setItems(localStorage, items),
      remove: async (keys: string | string[]) => removeItems(localStorage, keys),
    },
    sync: {
      QUOTA_BYTES_PER_ITEM: 8192,
      QUOTA_BYTES: 102_400,
      get: async (keys?: string | string[] | Record<string, unknown> | null) => {
        const output = selected(syncStorage, keys);
        const requested = keysFor(syncStorage, keys);
        if (replaceMetaAfterChunkRead && requested.some((key) => key.startsWith("startTabSyncChunk"))) {
          syncStorage.startTabSyncMeta = clone(replaceMetaAfterChunkRead);
          replaceMetaAfterChunkRead = null;
        }
        return output;
      },
      set: async (items: Record<string, unknown>) => {
        syncSetCalls += 1;
        setItems(syncStorage, items);
      },
      remove: async (keys: string | string[]) => removeItems(syncStorage, keys),
    },
  },
  declarativeNetRequest: {
    RuleActionType: { REDIRECT: "redirect" },
    ResourceType: { MAIN_FRAME: "main_frame" },
    getDynamicRules: async () => [],
    updateDynamicRules: async () => undefined,
  },
  alarms: {
    getAll: async () => [],
    clear: async () => true,
    create: async () => undefined,
  },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const chromeSync = await import("../src/lib/chrome-sync.js");

await chromeSync.uploadChromeSyncBackup();
assert.equal(syncSetCalls, 1, "Initial upload must commit one complete Browser Sync frame");
const validChunk = syncStorage.startTabSyncChunk0;
assert.equal(typeof validChunk, "string");

syncStorage.startTabSyncChunk0 = \`\${validChunk}corrupted\`;
syncSetCalls = 0;
assert.equal(
  await chromeSync.syncChromeSyncBackup(),
  "uploaded",
  "Matching metadata must not hide a corrupt remote Browser Sync frame",
);
assert.equal(syncSetCalls, 1, "A corrupt matching frame must be replaced exactly once");
assert.notEqual(syncStorage.startTabSyncChunk0, \`\${validChunk}corrupted\`);
for (let index = 0; index < 12; index += 1) {
  assert.equal(typeof syncStorage[\`startTabSyncChunk\${index}\`], "string",
    "Repair upload must preserve the complete fixed-size chunk frame");
}

syncSetCalls = 0;
assert.equal(
  await chromeSync.syncChromeSyncBackup(),
  "unchanged",
  "An intact matching Browser Sync frame must remain a no-op",
);
assert.equal(syncSetCalls, 0, "Intact matching Browser Sync content must not be rewritten");

syncStorage.startTabSyncChunk0 = \`\${String(syncStorage.startTabSyncChunk0)}corrupted-again\`;
const currentMeta = clone(syncStorage.startTabSyncMeta as Record<string, unknown>);
replaceMetaAfterChunkRead = {
  ...currentMeta,
  updatedAt: "2035-01-01T00:00:00.000Z",
  snapshotId: "round32-concurrent-snapshot",
  checksum: "c".repeat(64),
  contentChecksum: "d".repeat(64),
};
syncSetCalls = 0;
await assert.rejects(
  () => chromeSync.syncChromeSyncBackup(),
  /changed concurrently/,
  "Corruption repair must not overwrite a snapshot replaced during verification",
);
assert.equal(syncSetCalls, 0, "A concurrently replaced remote snapshot must never be overwritten by repair");
assert.equal((syncStorage.startTabSyncMeta as Record<string, unknown>).snapshotId, "round32-concurrent-snapshot");

console.log("Round 32 fixtures passed");
`);

write("scripts/run-round32-fixtures.mjs", `import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(tmpdir(), "start-tab-round32-runner-"));
try {
  const outfile = path.join(temporary, "round32-fixtures.mjs");
  await build({
    entryPoints: [path.join(root, "scripts", "round32-fixtures.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "silent",
  });
  await import(\`\${pathToFileURL(outfile).href}?run=\${Date.now()}\`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
`);

write("scripts/validate-round32-static.mjs", `import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const chromeSync = read("src/lib/chrome-sync.ts");
const fixtures = read("scripts/round32-fixtures.ts");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");
const selfHostedValidation = read("scripts/validate-self-hosted-ci.mjs");

assert.match(chromeSync, /function parsedMetaEqual\(left: ParsedMeta \| null, right: ParsedMeta\)/,
  "Browser Sync must compare complete parsed metadata including legacy framing");
assert.match(chromeSync, /async function readVerifiedRemoteBundle\(parsed: ParsedMeta\)/,
  "Remote bundle reads must verify metadata again after reading chunks");
assert.match(chromeSync, /await readVerifiedRemoteBundle\(remote\);[\s\S]*writeRemoteSnapshot\(localSnapshot\);[\s\S]*return "uploaded";/,
  "Matching local content must repair a corrupt stable remote frame");
assert.match(chromeSync, /Chrome sync backup changed concurrently while matching content was being verified/,
  "Repair must refuse to overwrite a concurrently replaced remote snapshot");
assert.doesNotMatch(chromeSync, /if \(!localChanged && !remoteChanged\)/,
  "The unreachable post-checksum unchanged branch must stay removed");

for (const marker of [
  "Matching metadata must not hide a corrupt remote Browser Sync frame",
  "An intact matching Browser Sync frame must remain a no-op",
  "Corruption repair must not overwrite a snapshot replaced during verification",
]) {
  assert.ok(fixtures.includes(marker), \`Round 32 fixture is missing: \${marker}\`);
}
for (const command of ["node scripts/run-round32-fixtures.mjs", "node scripts/validate-round32-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), \`npm test is missing \${command}\`);
  assert.ok(workflow.includes(command), \`CI is missing \${command}\`);
  assert.ok(selfHostedValidation.includes(command), \`Self-hosted CI contract is missing \${command}\`);
}

console.log("Round 32 static validation passed");
`);

replaceExactly(
  "package.json",
  `node scripts/run-round31-fixtures.mjs && node scripts/validate-round31-static.mjs && node scripts/validate-self-hosted-ci.mjs`,
  `node scripts/run-round31-fixtures.mjs && node scripts/validate-round31-static.mjs && node scripts/run-round32-fixtures.mjs && node scripts/validate-round32-static.mjs && node scripts/validate-self-hosted-ci.mjs`,
);

replaceExactly(
  ".github/workflows/ci.yml",
  `      - name: Validate round 31
        run: node scripts/validate-round31-static.mjs

      - name: Validate self-hosted CI contract`,
  `      - name: Validate round 31
        run: node scripts/validate-round31-static.mjs

      - name: Run round 32 fixtures
        run: node scripts/run-round32-fixtures.mjs

      - name: Validate round 32
        run: node scripts/validate-round32-static.mjs

      - name: Validate self-hosted CI contract`,
);

replaceExactly(
  "scripts/validate-self-hosted-ci.mjs",
  `  "node scripts/run-round31-fixtures.mjs",
  "node scripts/validate-round31-static.mjs",
  "node scripts/validate-self-hosted-ci.mjs",`,
  `  "node scripts/run-round31-fixtures.mjs",
  "node scripts/validate-round31-static.mjs",
  "node scripts/run-round32-fixtures.mjs",
  "node scripts/validate-round32-static.mjs",
  "node scripts/validate-self-hosted-ci.mjs",`,
);

write("docs/audit-2026-07-22-round-32.md", `# Deep audit round 32 — Browser Sync integrity self-healing

## Scope

Independent adversarial review of the exact \`master\` state produced by PR #108, with emphasis on the Round 31 complete-frame Browser Sync change, remote snapshot integrity, concurrent device replacement, branch/PR completion, and CI regression wiring.

## Confirmed defects

1. The non-legacy Smart Sync equality path trusted \`startTabSyncMeta.contentChecksum\` without reading the active remote chunks. A missing, mixed, truncated, or corrupt frame could therefore be reported as \`unchanged\` indefinitely even though restore on another device would fail.
2. The legacy comparison path read its remote frame without confirming that metadata still described the same snapshot after the chunk read, so a concurrent replacement could be followed by a stale direction decision.
3. A post-equality \`!localChanged && !remoteChanged\` branch was unreachable and obscured the actual conflict-state invariants.

## Corrections

- compare complete parsed metadata, including legacy/current framing;
- verify metadata again after every remote bundle read used for restore or sync direction decisions;
- when local content matches remote metadata, validate whole-frame checksum, JSON, migration, and canonical content before returning \`unchanged\`;
- if that matching frame is corrupt and metadata is still stable, replace it with one complete local frame and return \`uploaded\`;
- if metadata changes during verification, abort rather than overwriting the newer snapshot;
- remove the unreachable conflict branch;
- add executable Round 32 corruption, no-op, and concurrent-replacement fixtures plus static and self-hosted CI contracts.

## External boundary

Repository automation cannot prove real cross-device Chrome propagation/throttling, Chrome Web Store review, production Google OAuth/API behavior, or physical browser interaction. These remain manual release checks and are not represented as automated proof.
`);

fs.rmSync(path.join(root, "scripts/apply-round32-audit.mjs"), { force: true });
fs.rmSync(path.join(root, ".github/workflows/apply-round32-audit.yml"), { force: true });
console.log("Round 32 audit patch applied");
