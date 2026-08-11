import assert from "node:assert/strict";

interface AlarmState {
  name: string;
  scheduledTime: number;
  periodInMinutes?: number;
}

type StorageHook = (keys: string | string[] | Record<string, unknown> | null | undefined) => Promise<void> | void;
type SyncSetHook = (items: Record<string, unknown>) => Promise<void> | void;

let localStorage: Record<string, unknown> = {};
let syncStorage: Record<string, unknown> = {};
let dynamicRules: chrome.declarativeNetRequest.Rule[] = [];
const alarms = new Map<string, AlarmState>();
let syncGetHook: StorageHook | null = null;
let syncSetHook: SyncSetHook | null = null;
let syncSetCount = 0;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requestedKeys(
  source: Record<string, unknown>,
  keys?: string | string[] | Record<string, unknown> | null,
): string[] {
  if (keys == null) return Object.keys(source);
  if (typeof keys === "string") return [keys];
  if (Array.isArray(keys)) return keys;
  return Object.keys(keys);
}

function selected(
  source: Record<string, unknown>,
  keys?: string | string[] | Record<string, unknown> | null,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of requestedKeys(source, keys)) {
    if (Object.prototype.hasOwnProperty.call(source, key)) output[key] = clone(source[key]);
    else if (keys && typeof keys === "object" && !Array.isArray(keys)) output[key] = clone(keys[key]);
  }
  return output;
}

const chromeMock = {
  runtime: {
    getURL: (relativePath: string) => `chrome-extension://round52/${relativePath}`,
    getManifest: () => ({ oauth2: { client_id: "round52.apps.googleusercontent.com" } }),
    sendMessage: async () => ({ ok: true }),
  },
  identity: {
    getAuthToken: async () => ({ token: "round52-token" }),
    removeCachedAuthToken: async () => undefined,
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | Record<string, unknown> | null) => selected(localStorage, keys),
      set: async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) localStorage[key] = clone(value);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete localStorage[key];
      },
    },
    sync: {
      QUOTA_BYTES_PER_ITEM: 8192,
      QUOTA_BYTES: 102_400,
      get: async (keys?: string | string[] | Record<string, unknown> | null) => {
        if (syncGetHook) await syncGetHook(keys);
        return selected(syncStorage, keys);
      },
      set: async (items: Record<string, unknown>) => {
        syncSetCount += 1;
        for (const [key, value] of Object.entries(items)) syncStorage[key] = clone(value);
        if (syncSetHook) await syncSetHook(items);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete syncStorage[key];
      },
    },
  },
  declarativeNetRequest: {
    RuleActionType: {
      ALLOW: "allow",
      ALLOW_ALL_REQUESTS: "allowAllRequests",
      BLOCK: "block",
      MODIFY_HEADERS: "modifyHeaders",
      REDIRECT: "redirect",
      UPGRADE_SCHEME: "upgradeScheme",
    },
    ResourceType: { MAIN_FRAME: "main_frame" },
    MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES: 5_000,
    MAX_NUMBER_OF_DYNAMIC_RULES: 30_000,
    getDynamicRules: async () => clone(dynamicRules),
    updateDynamicRules: async ({ removeRuleIds = [], addRules = [] }: {
      removeRuleIds?: number[];
      addRules?: chrome.declarativeNetRequest.Rule[];
    }) => {
      const next = new Map(dynamicRules.map((rule) => [rule.id, clone(rule)]));
      for (const id of removeRuleIds) next.delete(id);
      for (const rule of addRules) next.set(rule.id, clone(rule));
      dynamicRules = [...next.values()].sort((left, right) => left.id - right.id);
    },
  },
  alarms: {
    getAll: async () => clone([...alarms.values()]),
    clear: async (name: string) => alarms.delete(name),
    create: async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
      alarms.set(name, {
        name,
        scheduledTime: typeof info.when === "number" ? info.when : Date.now(),
        ...(typeof info.periodInMinutes === "number" ? { periodInMinutes: info.periodInMinutes } : {}),
      });
    },
  },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const backup = await import("../src/lib/backup.js");
const chromeSync = await import("../src/lib/chrome-sync.js");
const google = await import("../src/lib/google-integration.js");
const revision = await import("../src/lib/data-revision.js");

const REVISION_BASE = 9_000_000_000_000;

function resetState(): void {
  localStorage = {};
  syncStorage = {};
  dynamicRules = [];
  alarms.clear();
  syncGetHook = null;
  syncSetHook = null;
  syncSetCount = 0;
}

function localData(site: string, updatedAt: number): Record<string, unknown> {
  return {
    blockedSites: [site],
    startTabDataRevision: { version: 1, updatedAt },
  };
}

function remoteBundleFromFrame(): backup.BackupBundle {
  const meta = syncStorage.startTabSyncMeta as { chunks?: number } | undefined;
  assert.ok(meta && typeof meta.chunks === "number", "Expected a committed Browser Sync metadata frame");
  const json = Array.from({ length: meta.chunks }, (_, index) => syncStorage[`startTabSyncChunk${index}`]).join("");
  return JSON.parse(json) as backup.BackupBundle;
}

async function buildRemoteFrame(site: string, updatedAt: number): Promise<Record<string, unknown>> {
  localStorage = localData(site, updatedAt);
  syncStorage = {};
  syncGetHook = null;
  syncSetHook = null;
  syncSetCount = 0;
  await chromeSync.uploadChromeSyncBackup();
  return clone(syncStorage);
}

// Direct import preconditions must fail before creating the recovery backup or
// touching storage/DNR/alarms when the caller's local revision is stale.
resetState();
localStorage = localData("current.example", REVISION_BASE + 300);
const currentSnapshot = await backup.exportBackupSnapshot();
const incoming = backup.migrateBackup({
  app: "Start Tab",
  version: 4,
  exportedAt: new Date().toISOString(),
  snapshotId: "round52-stale-import",
  storage: { blockedSites: ["remote.example"] },
});
await assert.rejects(
  () => backup.importBackup(incoming, {
    expectedCurrentDataRevision: currentSnapshot.dataRevision - 1,
    expectedCurrentDataRevisionFallback: currentSnapshot.dataRevisionFallback,
  }),
  (error: unknown) => error instanceof revision.StartTabDataRevisionConflictError,
  "A stale backup CAS must reject before destructive import work",
);
assert.deepEqual(localStorage.blockedSites, ["current.example"]);
assert.equal(localStorage.startTabPreImportBackup, undefined,
  "A rejected revision precondition must not replace the pre-import recovery snapshot");
assert.deepEqual(dynamicRules, [], "A rejected revision precondition must not touch DNR");
assert.equal(alarms.size, 0, "A rejected revision precondition must not touch alarms");

// Regression: automatic Browser Sync captured local rev 150, then another tab
// saved rev 300 while the remote rev 200 bundle was being read. The old code
// restored rev 200 over the newer local edit. Round 52 must CAS-fail that first
// restore, recalculate, and upload the rev 300 state instead.
resetState();
const remoteFrame = await buildRemoteFrame("remote.example", REVISION_BASE + 200);
syncStorage = remoteFrame;
localStorage = localData("old-local.example", REVISION_BASE + 150);
delete localStorage.startTabLocalSyncMeta;
let injectedSmartSyncEdit = false;
syncGetHook = async (keys) => {
  if (injectedSmartSyncEdit || !Array.isArray(keys) || !keys.some((key) => key.startsWith("startTabSyncChunk"))) return;
  injectedSmartSyncEdit = true;
  localStorage.blockedSites = ["new-local.example"];
  localStorage.startTabDataRevision = { version: 1, updatedAt: REVISION_BASE + 300 };
};
const smartResult = await chromeSync.syncChromeSyncBackup();
assert.equal(smartResult, "uploaded",
  "Smart Sync must recalculate after a local revision conflict and let the newer local state win");
assert.deepEqual(localStorage.blockedSites, ["new-local.example"],
  "A remote-wins decision made from an obsolete snapshot must never erase the newer local edit");
assert.equal(localStorage.startTabPreImportBackup, undefined,
  "The stale restore attempt must fail before import creates recovery state");
assert.deepEqual(remoteBundleFromFrame().storage.blockedSites, ["new-local.example"],
  "The retry must converge the remote frame to the newer local state");

// A manual Browser Sync Upload can race after its pre-commit check. Mutate local
// data from the sync.set hook itself: post-commit revision verification must
// notice it and retry, so the function cannot return with a stale remote frame.
resetState();
localStorage = localData("upload-old.example", REVISION_BASE + 400);
let injectedUploadEdit = false;
syncSetHook = async () => {
  if (injectedUploadEdit) return;
  injectedUploadEdit = true;
  localStorage.blockedSites = ["upload-new.example"];
  localStorage.startTabDataRevision = { version: 1, updatedAt: REVISION_BASE + 500 };
};
await chromeSync.uploadChromeSyncBackup();
assert.equal(syncSetCount, 2,
  "Browser Sync Upload must retry after local data changes during the remote commit");
assert.deepEqual(remoteBundleFromFrame().storage.blockedSites, ["upload-new.example"],
  "A successful Upload must finish with the latest stable local snapshot remotely committed");

// Explicit Browser Sync Restore is destructive and should not silently retry
// over an edit made after the user's confirmation. The mutation is injected on
// the first metadata read itself, so the guard must have been captured before
// any remote I/O, not merely before the later chunk download.
resetState();
const explicitRemoteFrame = await buildRemoteFrame("restore-remote.example", REVISION_BASE + 700);
syncStorage = explicitRemoteFrame;
localStorage = localData("restore-old-local.example", REVISION_BASE + 600);
let injectedExplicitRestoreEdit = false;
syncGetHook = async (keys) => {
  if (injectedExplicitRestoreEdit || keys !== "startTabSyncMeta") return;
  injectedExplicitRestoreEdit = true;
  localStorage.blockedSites = ["restore-new-local.example"];
  localStorage.startTabDataRevision = { version: 1, updatedAt: REVISION_BASE + 800 };
};
await assert.rejects(
  () => chromeSync.restoreChromeSyncBackup(),
  (error: unknown) => error instanceof revision.StartTabDataRevisionConflictError,
  "Explicit Browser Sync Restore must fail closed if local data changes after confirmation",
);
assert.deepEqual(localStorage.blockedSites, ["restore-new-local.example"]);
assert.equal(localStorage.startTabPreImportBackup, undefined);

// Google Drive Restore has the same destructive network window: capture the
// local revision before list/download, then refuse the import if another tab
// saves while the remote body is arriving.
resetState();
localStorage = localData("drive-old-local.example", REVISION_BASE + 900);
const driveRemoteBundle = backup.migrateBackup({
  app: "Start Tab",
  version: 4,
  exportedAt: new Date().toISOString(),
  snapshotId: "round52-drive-remote",
  storage: { blockedSites: ["drive-remote.example"] },
});
const originalFetch = globalThis.fetch;
let driveFetchCount = 0;
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  writable: true,
  value: async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    driveFetchCount += 1;
    if (url.searchParams.get("spaces") === "appDataFolder") {
      return new Response(JSON.stringify({ files: [{ id: "round52-drive", name: "start-tab-backup.json" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.searchParams.get("alt") === "media") {
      localStorage.blockedSites = ["drive-new-local.example"];
      localStorage.startTabDataRevision = { version: 1, updatedAt: REVISION_BASE + 1_000 };
      return new Response(JSON.stringify(driveRemoteBundle), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected Round 52 Google request: ${url}`);
  },
});
try {
  await assert.rejects(
    () => google.restoreDriveBackup(),
    (error: unknown) => error instanceof revision.StartTabDataRevisionConflictError,
    "Google Drive Restore must fail closed when local data changes during download",
  );
  assert.equal(driveFetchCount, 2);
  assert.deepEqual(localStorage.blockedSites, ["drive-new-local.example"]);
  assert.equal(localStorage.startTabPreImportBackup, undefined);
} finally {
  Object.defineProperty(globalThis, "fetch", { value: originalFetch, configurable: true, writable: true });
}

console.log("Round 52 remote backup concurrency fixtures passed");
