import assert from "node:assert/strict";
import { changedTabNavigationUrl } from "../src/lib/tab-navigation-change.js";
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
