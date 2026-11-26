import assert from "node:assert/strict";
import { changedTabNavigationUrl, currentTabNavigationUrl, NewTabRedirectGuard } from "../src/lib/tab-navigation-change.js";
import { mayReloadPopupTarget, readStablePopupTarget, samePopupTarget, type PopupTarget } from "../src/popup/popup-target.js";

const localState: Record<string, unknown> = {};
const chromeMock = {
  storage: {
    local: {
      async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
        if (keys == null) return structuredClone(localState);
        const requested = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        const output: Record<string, unknown> = {};
        for (const key of requested) {
          if (Object.prototype.hasOwnProperty.call(localState, key)) output[key] = structuredClone(localState[key]);
          else if (keys && typeof keys === "object" && !Array.isArray(keys)) output[key] = structuredClone(keys[key]);
        }
        return output;
      },
      async set(items: Record<string, unknown>): Promise<void> {
        for (const [key, value] of Object.entries(items)) localState[key] = structuredClone(value);
      },
      async remove(keys: string | string[]): Promise<void> {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete localState[key];
      },
    },
  },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const nativeTab = await import("../src/lib/native-new-tab.js");
const bypassKey = nativeTab.NATIVE_NEW_TAB_BYPASS_KEY;
localState[bypassKey] = { tabId: 41, expiresAt: Date.now() + 10_000 };
assert.equal(await nativeTab.consumeNativeNewTabBypass(41), true,
  "The first explicit native-tab URL event must consume the bypass");
const firstConsumedAt = (localState[bypassKey] as { consumedAt?: number }).consumedAt;
assert.equal(typeof firstConsumedAt, "number");
assert.equal(await nativeTab.consumeNativeNewTabBypass(41), true,
  "Repeated URL events for the same native tab must remain bypassed during the lease");
assert.equal((localState[bypassKey] as { consumedAt?: number }).consumedAt, firstConsumedAt,
  "Repeated consumption must preserve the original lease state");
assert.equal(await nativeTab.consumeNativeNewTabBypass(42), false,
  "A native-tab lease must never bypass a different tab");
assert.ok(localState[bypassKey], "A different tab must not remove another tab's bypass lease");
localState[bypassKey] = { tabId: 41, expiresAt: Date.now() - 1, consumedAt: Date.now() - 2 };
assert.equal(await nativeTab.consumeNativeNewTabBypass(41), false,
  "Expired native-tab leases must stop bypassing redirects");
assert.equal(localState[bypassKey], undefined, "Expired native-tab leases must be removed");

assert.equal(changedTabNavigationUrl({ url: "chrome://newtab/" }), "chrome://newtab/");
assert.equal(changedTabNavigationUrl({}), null,
  "Status, title, favicon, and loading updates without an explicit URL must not re-run fallback redirects");
assert.equal(changedTabNavigationUrl({ url: "" }), null);
assert.equal(changedTabNavigationUrl({ url: 123 }), null);

const displayed: PopupTarget = {
  tabId: 7,
  url: "https://example.com/first",
  host: "example.com",
  blockedHost: null,
};
assert.equal(samePopupTarget(displayed, { ...displayed, url: "https://example.com/second" }), true,
  "Same-tab navigation inside the same host and block state may keep the displayed action");
assert.equal(samePopupTarget(displayed, { ...displayed, tabId: 8 }), false);
assert.equal(samePopupTarget(displayed, { ...displayed, host: "other.example" }), false);
assert.equal(samePopupTarget(displayed, { ...displayed, blockedHost: "example.com" }), false,
  "An external block-state change must invalidate the displayed popup action");
assert.equal(samePopupTarget(displayed, null), false);

console.log("Round 41 fixtures passed");

const ntp = "chrome://newtab/";
const website = "https://example.com/";
assert.equal(currentTabNavigationUrl({ url: ntp, pendingUrl: website }), website);
assert.equal(currentTabNavigationUrl({ url: "about:blank", pendingUrl: ntp }), ntp);
let live: { url?: string; pendingUrl?: string } = { url: ntp };
let redirected: number[] = [];
let bypass = false;
let enabled = true;
let removed = false;
let onEnabled: (() => Promise<boolean>) | undefined;
let liveReads = 0;
let beforeGet: (() => void) | undefined;
let guard = new NewTabRedirectGuard({
  isEligible: (url) => url === ntp,
  getTab: async () => {
    liveReads++;
    beforeGet?.();
    if (removed) throw new Error("Tab not found");
    return { ...live };
  },
  shouldBypass: async () => bypass,
  isEnabled: async () => onEnabled ? onEnabled() : enabled,
  redirect: async (id) => { redirected.push(id); },
});
await guard.observe(7, ntp);
assert.deepEqual(redirected, [7], "A stable eligible native tab must still redirect");
redirected = [];
live = { url: ntp, pendingUrl: website };
await guard.observe(7, ntp);
assert.deepEqual(redirected, [], "A pending real website must win over the committed native URL");
live = { url: ntp };
bypass = true;
await guard.observe(7, ntp);
assert.deepEqual(redirected, [], "An explicit native bypass must remain respected");
bypass = false;
enabled = false;
await guard.observe(7, ntp);
assert.deepEqual(redirected, [], "Disabled Start Tab must never redirect");
enabled = true;
removed = true;
await guard.observe(7, ntp);
assert.deepEqual(redirected, [], "A closed or inaccessible tab must not redirect");
removed = false;

// Pause the settings read; observe a newer ordinary URL in the same tab.
let release!: (v: boolean) => void;
let entered!: () => void;
const started = new Promise<void>((resolve) => { entered = resolve; });
onEnabled = () => {
  entered();
  return new Promise<boolean>((resolve) => { release = resolve; });
};
const oldAttempt = guard.observe(7, ntp);
await started;
await guard.observe(7, website);
release(true);
await oldAttempt;
assert.deepEqual(redirected, [], "A newer explicit navigation must invalidate the in-flight fallback even if tabs.get still reports the old URL");

// A real navigation may be pending before onUpdated has been delivered.
onEnabled = async () => { live = { url: ntp, pendingUrl: website }; return true; };
live = { url: ntp };
await guard.observe(7, ntp);
assert.deepEqual(redirected, [], "Live tab recheck after settings IO must protect a newer pending destination");

// Removal cancels work even if the tab ID is reused or the mock still returns a URL.
live = { url: ntp };
onEnabled = async () => { guard.cancel(7); return true; };
await guard.observe(7, ntp);
assert.deepEqual(redirected, [], "Tab removal must invalidate an in-flight redirect");

// Multiple eligible events for different tabs remain independent.
onEnabled = undefined;
await Promise.all([guard.observe(7, ntp), guard.observe(8, ntp)]);
assert.deepEqual(redirected.sort(), [7, 8]);
redirected = [];
liveReads = 0;
beforeGet = () => { if (liveReads === 2) guard.cancel(7); };
await guard.observe(7, ntp);
assert.deepEqual(redirected, [], "Cancellation during the final tabs.get must prevent the update");
console.log("Round 56 stale native-tab redirect regressions passed");

const { BlockedNavigationRegistry, isBlockedPageNavigation } = await import("../src/lib/blocked-navigation.js");
const session92: Record<string, unknown> = {};
const store92 = {
  async get(key: string) { return Object.hasOwn(session92, key) ? { [key]: structuredClone(session92[key]) } : {}; },
  async set(items: Record<string, unknown>) { Object.assign(session92, structuredClone(items)); },
  async remove(key: string) { delete session92[key]; },
};
const registry92 = new BlockedNavigationRegistry(() => store92);
const match92 = async (url: string): Promise<string | null> => url.includes("example.com") ? "example.com" : null;
await Promise.all([
  registry92.observe(91, "https://example.com/first?x=1", match92),
  registry92.observe(92, "https://sub.example.com/second", match92),
]);
assert.equal(await registry92.lookup(91, "example.com"), "https://example.com/first?x=1");
assert.equal(await registry92.lookup(92, "example.com"), "https://sub.example.com/second");
assert.equal(await registry92.lookup(92, "other.example"), null);
assert.equal(await registry92.lookup(undefined, "example.com"), null);
const restarted92 = new BlockedNavigationRegistry(() => store92);
assert.equal(await restarted92.lookup(91, "example.com"), "https://example.com/first?x=1", "Session storage survives MV3 worker restart");
let entered92!: () => void;
let release92!: () => void;
const ready92 = new Promise<void>((resolve) => { entered92 = resolve; });
const recording92 = registry92.observe(91, "https://example.com/new", async () => {
  entered92();
  await new Promise<void>((resolve) => { release92 = resolve; });
  return "example.com";
});
await ready92;
let lookupDone92 = false;
const lookup92 = registry92.lookup(91, "example.com").then((url) => { lookupDone92 = true; return url; });
await Promise.resolve();
assert.equal(lookupDone92, false, "Blocked-page lookup must wait for its navigation event");
release92();
await recording92;
assert.equal(await lookup92, "https://example.com/new");
await registry92.observe(91, "https://allowed.example/", async () => null);
assert.equal(await registry92.lookup(91, "example.com"), null, "Ordinary navigation invalidates a previous blocked URL");
await assert.rejects(() => registry92.observe(92, "https://example.com/fail", async () => { throw new Error("match failed"); }), /match failed/);
assert.equal(await registry92.lookup(92, "example.com"), null, "A failed match cannot resurrect an old URL");
await registry92.observe(92, "https://attacker.invalid/path", async () => "example.com");
assert.equal(await registry92.lookup(92, "example.com"), null, "Validate the actual destination host");
await registry92.observe(92, "https://example.com/closed", match92);
await registry92.forget(92);
assert.equal(await registry92.lookup(92, "example.com"), null, "Tab closure removes the session destination");
const page92 = "chrome-extension://starttab/blocked.html";
assert.equal(isBlockedPageNavigation(page92 + "?site=example.com", page92), true);
assert.equal(isBlockedPageNavigation("chrome-extension://another/blocked.html", page92), false);
assert.equal(isBlockedPageNavigation("https://starttab/blocked.html", page92), false);
console.log("Round 92 per-tab blocked navigation regressions passed");

let active97: { id: number; url: string; pendingUrl?: string } = { id: 7, url: "https://example.com/old", pendingUrl: "https://other.example/new" };
const seen97: string[] = [];
const read97 = () => Promise.resolve({ ...active97 });
const match97 = async (url: string) => { seen97.push(url); return null; };
assert.deepEqual(await readStablePopupTarget(read97, match97), { tabId: 7, url: "https://other.example/new", host: "other.example", blockedHost: null });
assert.deepEqual(seen97, ["https://other.example/new"], "A pending destination supersedes the old tab URL");
active97 = { id: 7, url: "https://example.com/old" };
assert.equal(await readStablePopupTarget(read97, async () => { active97 = { id: 7, url: "https://other.example/new" }; return null; }), null,
  "A host change during blocklist IO invalidates the action");
active97 = { id: 7, url: "https://example.com/old" };
assert.equal(await readStablePopupTarget(read97, async () => { active97 = { id: 8, url: "https://example.com/old" }; return null; }), null,
  "A tab switch during blocklist IO invalidates the action");
active97 = { id: 7, url: "https://example.com/old" };
assert.deepEqual(await readStablePopupTarget(read97, async () => { active97.url = "https://example.com/new"; return "example.com"; }),
  { tabId: 7, url: "https://example.com/new", host: "example.com", blockedHost: "example.com" });
assert.equal(mayReloadPopupTarget(displayed, { id: 7, url: "https://example.com/current" }), true);
assert.equal(mayReloadPopupTarget(displayed, { id: 7, url: "https://example.com/current", pendingUrl: "https://other.example/" }), false);
assert.equal(mayReloadPopupTarget(displayed, { id: 7, url: "https://example.com/current", pendingUrl: "https://example.com/next" }), false);
assert.equal(mayReloadPopupTarget(displayed, { id: 7, url: "https://other.example/" }), false);
assert.equal(mayReloadPopupTarget(displayed, { id: 8, url: "https://example.com/current" }), false);
assert.equal(mayReloadPopupTarget(displayed, undefined), false);
console.log("Round 97 stable popup target and guarded reload regressions passed");

let removeFails103 = false;
let setFails103 = false;
let getFails103 = false;
let storageUnavailable103 = false;
const persisted103: Record<string, unknown> = {};
const store103 = {
  async get(key: string) {
    if (getFails103) throw new Error("read unavailable");
    return { [key]: structuredClone(persisted103[key]) };
  },
  async set(items: Record<string, unknown>) {
    if (setFails103) throw new Error("write unavailable");
    Object.assign(persisted103, structuredClone(items));
  },
  async remove(key: string) {
    if (removeFails103) throw new Error("remove unavailable");
    delete persisted103[key];
  },
};
const registry103 = new BlockedNavigationRegistry(() => {
  if (storageUnavailable103) throw new Error("session unavailable");
  return store103;
});
const host103 = "example.com";
let matches103 = 0;
const match103 = async () => { matches103++; return host103; };
await registry103.observe(103, "https://example.com/old", match103);
removeFails103 = true;
setFails103 = true;
assert.equal(await registry103.observe(103, "https://example.com/new", match103), host103);
assert.equal(matches103, 2, "Session failure must not suppress the core blocked-site match");
assert.equal(await registry103.lookup(103, host103), "https://example.com/new", "Failed session persistence must use the newest in-memory destination");
assert.equal(await registry103.lookup(103, "other.example"), null);
await assert.rejects(() => registry103.observe(103, "https://example.com/error", async () => { throw new Error("match failed"); }), /match failed/);
assert.equal(await registry103.lookup(103, host103), null, "A failed invalidation and match must mask stale persisted URLs");
setFails103 = false;
await registry103.observe(103, "https://example.com/recovered", match103);
assert.equal(await new BlockedNavigationRegistry(() => store103).lookup(103, host103), "https://example.com/recovered");
await registry103.forget(103);
assert.equal(await new BlockedNavigationRegistry(() => store103).lookup(103, host103), null, "A durable tombstone survives worker restart if removal fails");
getFails103 = true;
assert.equal(await registry103.lookup(103, host103), null);
storageUnavailable103 = true;
assert.equal(await registry103.observe(104, "https://example.com/unavailable", match103), host103);
assert.equal(await registry103.lookup(104, host103), "https://example.com/unavailable");
await registry103.forget(104);
assert.equal(await registry103.lookup(104, host103), null);
console.log("Round 103 session storage degradation regressions passed");

const { settlePopupAction } = await import("../src/popup/action-recovery.js");
const mutationError112 = new Error("worker rejected stale blocklist");
const refreshError112 = new Error("refresh failed");
let writes112 = 0;
let reads112 = 0;
assert.deepEqual(await settlePopupAction(async () => { writes112++; }, async () => { reads112++; throw refreshError112; }),
  { committed: true, refreshError: refreshError112 });
assert.equal(writes112, 1, "A committed clear must not be repeated because a view read failed");
assert.deepEqual(await settlePopupAction(async () => { throw mutationError112; }, async () => { reads112++; }),
  { committed: false, error: mutationError112 });
assert.deepEqual(await settlePopupAction(async () => { throw mutationError112; }, async () => { reads112++; throw refreshError112; }),
  { committed: false, error: mutationError112, refreshError: refreshError112 });
assert.equal(reads112, 3, "Failed and committed actions both refresh canonical state");
assert.deepEqual(await settlePopupAction(async () => { writes112++; }, async () => { reads112++; }), { committed: true });
console.log("Round 112 popup acknowledged mutation recovery regressions passed");

const { readBlockedDestinationForSender } = await import("../src/lib/blocked-navigation.js");
const page113 = "chrome-extension://starttab/blocked.html";
const url113 = page113 + "?site=example.com";
const sender113 = { url: url113, frameId: 0, documentLifecycle: "active", tab: { id: 113 } };
let tab113: { id: number; url: string; pendingUrl?: string } = { id: 113, url: url113 };
let lookups113 = 0;
const read113 = async () => ({ ...tab113 });
const lookup113 = async (id: number, host: string) => {
  assert.equal(id, 113); assert.equal(host, "example.com"); lookups113++;
  return "https://example.com/private";
};
assert.equal(await readBlockedDestinationForSender(sender113, page113, "example.com", read113, lookup113), "https://example.com/private");
for (const stale113 of [
  { ...sender113, frameId: 1 },
  { ...sender113, frameId: undefined },
  { ...sender113, documentLifecycle: "cached" },
  { ...sender113, tab: {} },
  { ...sender113, url: page113 + "?site=other.example" },
  { ...sender113, url: url113 + "&site=other.example" },
  { ...sender113, url: "https://example.com/blocked.html?site=example.com" },
]) assert.equal(await readBlockedDestinationForSender(stale113, page113, "example.com", read113, lookup113), null);
assert.equal(lookups113, 1, "Unrelated documents and subframes cannot access registry entries");
tab113 = { id: 113, url: url113, pendingUrl: "https://other.example/" };
assert.equal(await readBlockedDestinationForSender(sender113, page113, "example.com", read113, lookup113), null);
tab113 = { id: 113, url: url113 };
assert.equal(await readBlockedDestinationForSender(sender113, page113, "example.com", read113, async () => {
  tab113 = { id: 113, url: page113 + "?site=other.example" };
  return "https://example.com/private";
}), null, "A navigation during the registry read must not leak its result");
assert.equal(await readBlockedDestinationForSender(sender113, page113, "example.com", async () => { throw new Error("tab gone"); }, lookup113), null);
console.log("Round 113 blocked destination sender regressions passed");

const sender116 = { ...sender113, documentId: "document-a" };
tab113 = { id: 113, url: url113 };
let frame116: { documentId: string; documentLifecycle: string; url: string } | null = {
  documentId: "document-a", documentLifecycle: "active", url: url113,
};
const readFrame116 = async () => frame116;
assert.equal(await readBlockedDestinationForSender(sender116, page113, "example.com", read113, lookup113, readFrame116), "https://example.com/private");
const count116 = lookups113;
frame116 = { documentId: "document-b", documentLifecycle: "active", url: url113 };
assert.equal(await readBlockedDestinationForSender(sender116, page113, "example.com", read113, lookup113, readFrame116), null, "A new document at the same URL cannot use a previous sender");
assert.equal(lookups113, count116);
frame116 = { documentId: "document-a", documentLifecycle: "active", url: url113 };
assert.equal(await readBlockedDestinationForSender(sender116, page113, "example.com", read113, async () => {
  frame116 = { documentId: "document-b", documentLifecycle: "active", url: url113 };
  return "https://example.com/private";
}, readFrame116), null, "A same-URL navigation during lookup must discard the old request");
frame116 = { documentId: "document-a", documentLifecycle: "cached", url: url113 };
assert.equal(await readBlockedDestinationForSender(sender116, page113, "example.com", read113, lookup113, readFrame116), null);
frame116 = null;
assert.equal(await readBlockedDestinationForSender(sender116, page113, "example.com", read113, lookup113, readFrame116), null);
assert.equal(await readBlockedDestinationForSender(sender116, page113, "example.com", read113, lookup113), null);
assert.equal(await readBlockedDestinationForSender(sender116, page113, "example.com", read113, lookup113, async () => { throw new Error("frame gone"); }), null);
console.log("Round 116 blocked document identity regressions passed");
