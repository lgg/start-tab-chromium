import assert from "node:assert/strict";
import { changedTabNavigationUrl, currentTabNavigationUrl, NewTabRedirectGuard } from "../src/lib/tab-navigation-change.js";
import { samePopupTarget, type PopupTarget } from "../src/popup/popup-target.js";

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
