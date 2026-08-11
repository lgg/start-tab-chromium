import assert from "node:assert/strict";

import {
  NATIVE_NEW_TAB_BYPASS_KEY,
  consumeNativeNewTabBypass,
  openNativeNewTab,
} from "../src/lib/native-new-tab.js";

type UpdateHandler = (tabId: number, url: string) => Promise<void>;

const storage: Record<string, unknown> = {};
let updateHandler: UpdateHandler = async () => undefined;
let updatedUrls: string[] = [];
let removedTabs: number[] = [];
let nextTabId = 51;
let storageSetHook: ((items: Record<string, unknown>) => Promise<void>) | null = null;
let storageRemoveHook: ((keys: string | string[]) => Promise<void>) | null = null;

function resetState(): void {
  for (const key of Object.keys(storage)) delete storage[key];
  updateHandler = async () => undefined;
  updatedUrls = [];
  removedTabs = [];
  nextTabId = 51;
  storageSetHook = null;
  storageRemoveHook = null;
}

const localStorageMock = {
  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null) return { ...storage };
    if (typeof keys === "string") {
      return Object.prototype.hasOwnProperty.call(storage, keys) ? { [keys]: storage[keys] } : {};
    }
    return Object.fromEntries(keys.filter((key) => Object.prototype.hasOwnProperty.call(storage, key)).map((key) => [key, storage[key]]));
  },
  async set(items: Record<string, unknown>): Promise<void> {
    if (storageSetHook) await storageSetHook(items);
    Object.assign(storage, items);
  },
  async remove(keys: string | string[]): Promise<void> {
    if (storageRemoveHook) await storageRemoveHook(keys);
    for (const key of typeof keys === "string" ? [keys] : keys) delete storage[key];
  },
};

const mockChrome = {
  storage: { local: localStorageMock },
  tabs: {
    async create(): Promise<chrome.tabs.Tab> {
      return { id: nextTabId } as chrome.tabs.Tab;
    },
    async update(tabId: number, properties: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab> {
      const url = properties.url ?? "";
      updatedUrls.push(url);
      await updateHandler(tabId, url);
      return { id: tabId, url } as chrome.tabs.Tab;
    },
    async remove(tabId: number): Promise<void> {
      removedTabs.push(tabId);
    },
  },
} as unknown as typeof chrome;

Object.defineProperty(globalThis, "chrome", { configurable: true, value: mockChrome });

// A normal navigation succeeds only after the exact tab's grant is marked consumed.
resetState();
updateHandler = async (tabId) => {
  assert.equal(await consumeNativeNewTabBypass(tabId), true);
};
await openNativeNewTab({ consumptionTimeoutMs: 100, pollIntervalMs: 1 });
assert.equal(updatedUrls.length, 1, "A consumed first native URL should finish without trying fallbacks");
assert.deepEqual(removedTabs, [], "A successfully opened native tab must not be removed");
const consumed = storage[NATIVE_NEW_TAB_BYPASS_KEY] as { tabId?: number; consumedAt?: number } | undefined;
assert.equal(consumed?.tabId, 51);
assert.equal(typeof consumed?.consumedAt, "number");

// Regression: a grant can expire while tabs.update is still settling. The old
// poller started a fresh timeout afterward and could accept loss of the grant
// as success even though no bypass was consumed.
resetState();
const realNow = Date.now;
let fakeNow = 10_000;
Date.now = () => fakeNow;
try {
  updateHandler = async (tabId) => {
    fakeNow += 1_000;
    assert.equal(await consumeNativeNewTabBypass(tabId), false, "An expired grant must never be consumed");
  };
  await assert.rejects(
    openNativeNewTab({ consumptionTimeoutMs: 100, pollIntervalMs: 1 }),
    /browser rejected every native new-tab URL/i,
    "Expiry before tabs.update settles must fail closed instead of treating a missing bypass as consumed",
  );
  assert.equal(updatedUrls.length, 3, "An unconsumed native URL must fall through every declared candidate");
  assert.deepEqual(removedTabs, [51], "Total native-new-tab failure must remove its temporary about:blank tab");
} finally {
  Date.now = realNow;
}

// Missing or foreign ownership is not a success acknowledgement.
resetState();
updateHandler = async () => {
  delete storage[NATIVE_NEW_TAB_BYPASS_KEY];
};
await assert.rejects(
  openNativeNewTab({ consumptionTimeoutMs: 20, pollIntervalMs: 1 }),
  /browser rejected every native new-tab URL/i,
  "A disappeared bypass key must not be mistaken for consumption",
);
assert.equal(updatedUrls.length, 3);
assert.deepEqual(removedTabs, [51]);

resetState();
updateHandler = async () => {
  storage[NATIVE_NEW_TAB_BYPASS_KEY] = { tabId: 999, expiresAt: Date.now() + 10_000 };
};
await assert.rejects(
  openNativeNewTab({ consumptionTimeoutMs: 20, pollIntervalMs: 1 }),
  /browser rejected every native new-tab URL/i,
  "A bypass owned by another tab must not acknowledge this opener",
);
assert.equal((storage[NATIVE_NEW_TAB_BYPASS_KEY] as { tabId?: number }).tabId, 999,
  "Failure cleanup must not delete another tab's bypass");

// Expired leases should still be cleaned promptly. The cleanup is safe now
// because the read and remove happen under the same lock used by retry grants.
resetState();
storage[NATIVE_NEW_TAB_BYPASS_KEY] = { tabId: 51, expiresAt: Date.now() - 1 };
assert.equal(await consumeNativeNewTabBypass(51), false);
assert.equal(storage[NATIVE_NEW_TAB_BYPASS_KEY], undefined,
  "An expired consumer must remove its stale bypass lease under the shared lock");

// Regression: delayed expired cleanup must finish before a retry can publish.
// Therefore the old cleanup can never erase the newer grant after publication.
resetState();
storage[NATIVE_NEW_TAB_BYPASS_KEY] = { tabId: 51, expiresAt: Date.now() - 1 };
let signalExpiredRemoval!: () => void;
let releaseExpiredRemoval!: () => void;
const expiredRemovalStarted = new Promise<void>((resolve) => { signalExpiredRemoval = resolve; });
const expiredRemovalRelease = new Promise<void>((resolve) => { releaseExpiredRemoval = resolve; });
storageRemoveHook = async (keys) => {
  const requested = typeof keys === "string" ? [keys] : keys;
  if (!requested.includes(NATIVE_NEW_TAB_BYPASS_KEY)) return;
  signalExpiredRemoval();
  await expiredRemovalRelease;
};
const expiredConsumer = consumeNativeNewTabBypass(51);
await expiredRemovalStarted;
updateHandler = async (tabId) => {
  assert.equal(await consumeNativeNewTabBypass(tabId), true);
};
const retryAfterCleanup = openNativeNewTab({ consumptionTimeoutMs: 100, pollIntervalMs: 1 });
releaseExpiredRemoval();
assert.equal(await expiredConsumer, false);
await retryAfterCleanup;
const afterExpiredCleanupRace = storage[NATIVE_NEW_TAB_BYPASS_KEY] as { tabId?: number; expiresAt?: number; consumedAt?: number } | undefined;
assert.equal(afterExpiredCleanupRace?.tabId, 51,
  "Locked expired cleanup must not erase a retry grant published afterward");
assert.equal(typeof afterExpiredCleanupRace?.consumedAt, "number");

// Regression: a delayed consumer from attempt 1 must not overwrite attempt 2.
// The shared native-bypass storage lock makes the retry wait for the old
// read-modify-write to settle before publishing its next grant.
resetState();
let firstConsumptionWrite = true;
let backgroundConsume: Promise<boolean> | null = null;
const grantExpiries: number[] = [];
storageSetHook = async (items) => {
  const value = items[NATIVE_NEW_TAB_BYPASS_KEY] as { expiresAt?: number; consumedAt?: number } | undefined;
  if (!value) return;
  if (typeof value.consumedAt !== "number" && typeof value.expiresAt === "number") grantExpiries.push(value.expiresAt);
  if (typeof value.consumedAt === "number" && firstConsumptionWrite) {
    firstConsumptionWrite = false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
let updateCount = 0;
updateHandler = async (tabId) => {
  updateCount += 1;
  if (updateCount === 1) {
    backgroundConsume = consumeNativeNewTabBypass(tabId);
    return;
  }
  assert.equal(await consumeNativeNewTabBypass(tabId), true);
};
await openNativeNewTab({ consumptionTimeoutMs: 5, pollIntervalMs: 1 });
assert.ok(backgroundConsume, "The delayed first-attempt consumer must have started");
assert.equal(await backgroundConsume, true);
assert.equal(updateCount, 2, "The second candidate should recover after the first attempt times out");
assert.equal(grantExpiries.length, 2, "Exactly two grants should be published for the recovery scenario");
const finalBypass = storage[NATIVE_NEW_TAB_BYPASS_KEY] as { expiresAt?: number; consumedAt?: number };
assert.equal(finalBypass.expiresAt, grantExpiries[1],
  "A late first-attempt consumer must not overwrite the second attempt's grant");
assert.equal(typeof finalBypass.consumedAt, "number");

console.log("Round 51 native new-tab fixtures passed");
