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
let failLocalSetAfterApply: string | null = null;

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
        if (failLocalSetAfterApply && Object.hasOwn(items, failLocalSetAfterApply)) {
          failLocalSetAfterApply = null;
          throw new Error("Injected local storage failure after apply");
        }
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
  failLocalSetAfterApply = null;
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

// Round 53: Drive list pages may be empty even when nextPageToken exists.
// Never create a second backup merely because the first page is empty.
resetState();
localStorage = localData("drive-paged.example", REVISION_BASE + 1200);
const driveRequests: string[] = [];
let drivePatched: unknown = null;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
  driveRequests.push(url.toString());
  if (url.searchParams.get("spaces") === "appDataFolder") {
    if (!url.searchParams.get("pageToken")) {
      assert.ok(url.searchParams.get("fields")?.includes("nextPageToken"));
      return Response.json({ files: [], nextPageToken: "next" });
    }
    assert.equal(url.searchParams.get("pageToken"), "next");
    return Response.json({ files: [{ id: "existing", name: "start-tab-backup.json" }] });
  }
  assert.equal(init?.method, "PATCH");
  assert.ok(url.pathname.endsWith("/existing"));
  drivePatched = JSON.parse(String(init?.body));
  return Response.json({ id: "existing" });
};
try {
  await google.uploadDriveBackup();
  assert.equal(driveRequests.length, 3);
  assert.deepEqual((drivePatched as backup.BackupBundle).storage.blockedSites, ["drive-paged.example"]);
} finally {
  globalThis.fetch = originalFetch;
}

// A repeated pagination token is not proof of absence. Fail without POST.
resetState();
localStorage = localData("drive-loop.example", REVISION_BASE + 1250);
let loopReads = 0;
globalThis.fetch = async (_input, init) => {
  assert.equal(init?.method, undefined);
  loopReads++;
  return Response.json({ files: [], nextPageToken: "repeated" });
};
try {
  await assert.rejects(() => google.uploadDriveBackup(), /did not advance/);
  assert.equal(loopReads, 2);
} finally {
  globalThis.fetch = originalFetch;
}

// Two concurrent local uploads must share the same list/write lock.
// The second lookup must observe the first create and PATCH instead of POST.
resetState();
localStorage = localData("drive-first.example", REVISION_BASE + 1300);
let driveExists = false;
let drivePosts = 0;
let drivePatches = 0;
let driveLists = 0;
let releaseCreate!: () => void;
let enterCreate!: () => void;
const createEntered = new Promise<void>((resolve) => { enterCreate = resolve; });
const createRelease = new Promise<void>((resolve) => { releaseCreate = resolve; });
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
  if (url.searchParams.get("spaces") === "appDataFolder") {
    driveLists++;
    if (driveLists === 2) localStorage = localData("drive-second.example", REVISION_BASE + 1400);
    return Response.json({ files: driveExists ? [{ id: "created", name: "start-tab-backup.json" }] : [] });
  }
  if (init?.method === "POST") {
    drivePosts++;
    enterCreate();
    await createRelease;
    driveExists = true;
  } else if (init?.method === "PATCH") {
    drivePatches++;
    assert.deepEqual(JSON.parse(String(init.body)).storage.blockedSites, ["drive-second.example"]);
  } else {
    throw new Error("Unexpected Drive request");
  }
  return Response.json({ id: "created" });
};
try {
  const firstUpload = google.uploadDriveBackup();
  await createEntered;
  const secondUpload = google.uploadDriveBackup();
  // Wait a turn to prove the queued upload has not made a second list request.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(driveLists, 1);
  releaseCreate();
  await firstUpload;
  await secondUpload;
  assert.equal(drivePosts, 1);
  assert.equal(drivePatches, 1);
} finally {
  releaseCreate();
  globalThis.fetch = originalFetch;
}

// An edit arriving during the media request must not be reported as a fresh
// backup. The already-uploaded snapshot may remain remotely; retry explicitly.
resetState();
localStorage = localData("drive-stale.example", REVISION_BASE + 1500);
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
  if (url.searchParams.get("spaces") === "appDataFolder") {
    return Response.json({ files: [{ id: "existing", name: "start-tab-backup.json" }] });
  }
  assert.equal(init?.method, "PATCH");
  localStorage = localData("drive-fresh.example", REVISION_BASE + 1600);
  return Response.json({ id: "existing" });
};
try {
  await assert.rejects(() => google.uploadDriveBackup(),
    (error: unknown) => error instanceof revision.StartTabDataRevisionConflictError);
  assert.deepEqual(localStorage.blockedSites, ["drive-fresh.example"]);
} finally {
  globalThis.fetch = originalFetch;
}

// A malicious/invalid remote revision cannot poison all subsequent local CAS.
resetState();
localStorage = localData("safe.example", REVISION_BASE + 1700);
const safeBefore = clone(localStorage);
await assert.rejects(() => revision.markStartTabDataChanged(1e30), /safe integer range/);
assert.deepEqual(localStorage, safeBefore);
localStorage = localData("corrupted-revision.example", 1e30);
await assert.rejects(() => chromeSync.uploadChromeSyncBackup(), /safe integer range/);
assert.equal(syncSetCount, 0);
localStorage = clone(safeBefore);
const unsafeFrame = await buildRemoteFrame("unsafe-remote.example", REVISION_BASE + 1800);
(unsafeFrame.startTabSyncMeta as { contentUpdatedAt: number }).contentUpdatedAt = 1e30;
syncStorage = unsafeFrame;
localStorage = clone(safeBefore);
await assert.rejects(() => chromeSync.restoreChromeSyncBackup(), /invalid data revision/);
await assert.rejects(() => chromeSync.uploadChromeSyncBackup(), /invalid data revision/);
assert.deepEqual(localStorage, safeBefore);
assert.equal((syncStorage.startTabSyncMeta as { contentUpdatedAt: number }).contentUpdatedAt, 1e30);

console.log("Round 52 remote backup concurrency fixtures passed");
console.log("Round 53 Drive pagination, upload serialization and safe revision fixtures passed");

// Round 55: a persisted counter is authoritative, even if legacy settings
// or runtime timestamps are much larger than it.
resetState();
const legacyTime = REVISION_BASE + 2100;
localStorage = {
  startPageSettings: { schemaVersion: 4, updatedAt: legacyTime },
  blockedSites: ["legacy-before.example"],
  startTabDataRevision: { version: 1, updatedAt: 100 },
};
const smallerCounter = await backup.exportBackupSnapshot();
assert.equal(smallerCounter.dataRevisionFallback, legacyTime);
assert.equal(smallerCounter.dataRevision, 100, "A legacy fallback must not mask a valid persisted counter");
assert.equal(smallerCounter.storedDataRevision, 100);
await assert.rejects(() => backup.importBackupAfterRead(async () => {
  localStorage.blockedSites = ["counter-new.example"];
  localStorage.startTabDataRevision = { version: 1, updatedAt: 101 };
  return incoming;
}), (error: unknown) => error instanceof revision.StartTabDataRevisionConflictError);
assert.deepEqual(localStorage.blockedSites, ["counter-new.example"]);
assert.equal(localStorage.startTabPreImportBackup, undefined);

// The first stored counter may equal the legacy fallback exactly. The
// presence transition must still invalidate the old destructive snapshot.
resetState();
localStorage = {
  startPageSettings: { schemaVersion: 4, updatedAt: legacyTime },
  blockedSites: ["first-counter-old.example"],
};
const beforeFirstCounter = await backup.exportBackupSnapshot();
assert.equal(beforeFirstCounter.dataRevision, legacyTime);
assert.equal(beforeFirstCounter.storedDataRevision, null);
await assert.rejects(() => backup.importBackupAfterRead(async () => {
  localStorage.blockedSites = ["first-counter-new.example"];
  localStorage.startTabDataRevision = { version: 1, updatedAt: legacyTime };
  return incoming;
}), (error: unknown) => error instanceof revision.StartTabDataRevisionConflictError);
assert.deepEqual(localStorage.blockedSites, ["first-counter-new.example"]);
assert.equal(localStorage.startTabPreImportBackup, undefined);

// Smart Sync initially observes no remote frame. A newer remote backup
// arrives before the selected upload reads the quota/current frame. The
// stale no-remote decision must not overwrite it.
resetState();
const newlyArrivingFrame = await buildRemoteFrame("newly-arriving-remote.example", REVISION_BASE + 2300);
syncStorage = {};
localStorage = localData("older-local-race.example", REVISION_BASE + 2200);
syncSetCount = 0;
let remoteArrived = false;
syncGetHook = (keys) => {
  if (keys === null && !remoteArrived) {
    remoteArrived = true;
    syncStorage = clone(newlyArrivingFrame);
  }
};
assert.equal(await chromeSync.syncChromeSyncBackup(), "restored");
assert.ok(remoteArrived);
assert.equal(syncSetCount, 0, "A newly arrived remote snapshot must not be overwritten by a stale upload decision");
assert.deepEqual(localStorage.blockedSites, ["newly-arriving-remote.example"]);

// A previously observed remote exists, but another device supplies a newer
// frame immediately before the last pre-write metadata check.
resetState();
const oldObservedFrame = await buildRemoteFrame("old-observed.example", REVISION_BASE + 2400);
const newestRemoteFrame = await buildRemoteFrame("newest-remote.example", REVISION_BASE + 2600);
syncStorage = clone(oldObservedFrame);
localStorage = localData("intermediate-local.example", REVISION_BASE + 2500);
syncSetCount = 0;
let quotaRead = false;
let newerRemoteArrived = false;
syncGetHook = (keys) => {
  if (keys === null) quotaRead = true;
  else if (quotaRead && keys === "startTabSyncMeta" && !newerRemoteArrived) {
    newerRemoteArrived = true;
    syncStorage = clone(newestRemoteFrame);
  }
};
assert.equal(await chromeSync.syncChromeSyncBackup(), "restored");
assert.ok(newerRemoteArrived);
assert.equal(syncSetCount, 0, "A changed remote decision must be recalculated before upload");
assert.deepEqual(localStorage.blockedSites, ["newest-remote.example"]);
console.log("Round 55 exact legacy revision and remote decision fixtures passed");

const settingsApi61 = await import("../src/lib/start-page-settings.js");
const runtimeApi61 = await import("../src/lib/start-page-runtime.js");
resetState();
const revision61 = REVISION_BASE + 3000;
const beforeRestore61 = settingsApi61.normalizeStartPageSettings({
  schemaVersion: 4, updatedAt: revision61,
  layout: { mode: "free", blocks: [{ id: "note-61", type: "note", title: "Old note", updatedAt: revision61 }] },
  themes: { selectedThemeId: "theme-61", customThemes: [{ id: "theme-61", name: "Old theme", updatedAt: revision61 }] },
});
const beforeRuntime61 = runtimeApi61.normalizeRuntimeState({
  version: 2, updatedAt: revision61, notes: { "note-61": "old content" },
}, beforeRestore61);
localStorage = {
  startPageSettings: clone(beforeRestore61),
  startPageRuntimeState: clone(beforeRuntime61),
  startTabDataRevision: { version: 1, updatedAt: revision61 },
};
const incoming61 = backup.migrateBackup({
  app: "Start Tab", version: 4, exportedAt: new Date().toISOString(),
  storage: {
    startPageSettings: {
      ...beforeRestore61,
      layout: { ...beforeRestore61.layout, blocks: beforeRestore61.layout.blocks.map((block) => ({ ...block, title: "Restored note" })) },
      themes: { ...beforeRestore61.themes, customThemes: beforeRestore61.themes.customThemes.map((theme) => ({ ...theme, name: "Restored theme" })) },
    },
    startPageRuntimeState: { ...beforeRuntime61, notes: { "note-61": "restored content" } },
  },
});
await backup.importBackup(incoming61);
const afterRestore61 = await settingsApi61.getStartPageSettings();
const afterRuntime61 = await runtimeApi61.getStartPageRuntimeState();
assert.ok(afterRestore61.updatedAt > revision61, "A restore must never reuse a previous local settings revision");
assert.ok(afterRuntime61.updatedAt > revision61, "A restore must invalidate stale runtime snapshots");
assert.ok(afterRestore61.layout.blocks[0]!.updatedAt > revision61);
assert.ok(afterRestore61.themes.customThemes[0]!.updatedAt > revision61);
assert.equal(afterRestore61.layout.blocks[0]!.title, "Restored note");
assert.equal(afterRuntime61.notes["note-61"], "restored content");
await assert.rejects(() => settingsApi61.updateBlockInstance("note-61", (block) => ({ ...block, title: "Stale" }), revision61), /changed in another extension context/);
await assert.rejects(() => settingsApi61.updateCustomTheme(beforeRestore61.themes.customThemes[0]!, revision61), /changed in another extension context/);
await assert.rejects(() => runtimeApi61.replaceStartPageSettingsWithRuntime(beforeRestore61, revision61, revision61), /changed in another extension context/);
assert.equal(chromeSync.canonicalBackupContent(await backup.exportBackup()), chromeSync.canonicalBackupContent(incoming61),
  "Local restore tokens must not alter semantic Browser Sync checksums");
const firstRestoredRevision61 = afterRestore61.updatedAt;
await backup.importBackup(incoming61);
assert.ok((await settingsApi61.getStartPageSettings()).updatedAt > firstRestoredRevision61,
  "Restoring the same file twice must still invalidate old optimistic edit tokens");
console.log("Round 61 restored local revision regressions passed");

resetState();
localStorage = { ...localData("before-failure.example", REVISION_BASE + 9000), startTabPreImportBackup: { prior: true } };
const beforeRecoveryFailure70 = clone(localStorage);
failLocalSetAfterApply = "startTabPreImportBackup";
await assert.rejects(() => backup.importBackup(incoming), /Injected local storage failure/);
assert.deepEqual(localStorage, beforeRecoveryFailure70, "Recovery write failures after apply must restore the old recovery snapshot");
assert.deepEqual(dynamicRules, []);
assert.equal(alarms.size, 0);

resetState();
const remote70 = await buildRemoteFrame("remote-atomic.example", REVISION_BASE + 9100);
const meta70 = clone(localStorage.startTabLocalSyncMeta);
localStorage = { ...localData("local-atomic.example", REVISION_BASE + 9000), startTabLocalSyncMeta: meta70, startTabPreImportBackup: { prior: true } };
syncStorage = remote70;
const beforeMetaFailure70 = clone(localStorage);
failLocalSetAfterApply = "startTabLocalSyncMeta";
await assert.rejects(() => chromeSync.restoreChromeSyncBackup(), /Injected local storage failure/);
assert.deepEqual(localStorage, beforeMetaFailure70, "Failed sync baseline commit must restore all pre-import data and metadata");
assert.deepEqual(dynamicRules, []);
assert.equal(alarms.size, 0);
await chromeSync.restoreChromeSyncBackup();
assert.deepEqual(localStorage.blockedSites, ["remote-atomic.example"]);
assert.deepEqual(localStorage.startTabLocalSyncMeta, syncStorage.startTabSyncMeta);
console.log("Round 70 atomic recovery and sync-baseline regressions passed");
