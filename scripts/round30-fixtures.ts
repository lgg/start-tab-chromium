import assert from "node:assert/strict";

let storage: Record<string, unknown> = {};
let dynamicRules: chrome.declarativeNetRequest.Rule[] = [];
let dynamicRuleUpdates = 0;
let unsafeDynamicRuleLimit = 5_000;
let totalDynamicRuleLimit = 30_000;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requestedKeys(keys?: string | string[] | Record<string, unknown> | null): string[] {
  if (keys == null) return Object.keys(storage);
  if (typeof keys === "string") return [keys];
  if (Array.isArray(keys)) return keys;
  return Object.keys(keys);
}

function selected(keys?: string | string[] | Record<string, unknown> | null): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of requestedKeys(keys)) {
    if (Object.prototype.hasOwnProperty.call(storage, key)) output[key] = clone(storage[key]);
    else if (keys && typeof keys === "object" && !Array.isArray(keys)) output[key] = clone(keys[key]);
  }
  return output;
}

const chromeMock = {
  runtime: {
    getURL: (relativePath: string) => `chrome-extension://round30/${relativePath}`,
    getManifest: () => ({ oauth2: { client_id: "round30.apps.googleusercontent.com" } }),
    sendMessage: async () => ({ ok: true }),
  },
  identity: {
    getAuthToken: async () => ({ token: "round30-token" }),
    removeCachedAuthToken: async () => undefined,
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | Record<string, unknown> | null) => selected(keys),
      set: async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) storage[key] = clone(value);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
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
    get MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES() { return unsafeDynamicRuleLimit; },
    get MAX_NUMBER_OF_DYNAMIC_RULES() { return totalDynamicRuleLimit; },
    getDynamicRules: async () => clone(dynamicRules),
    updateDynamicRules: async ({ removeRuleIds = [], addRules = [] }: {
      removeRuleIds?: number[];
      addRules?: chrome.declarativeNetRequest.Rule[];
    }) => {
      dynamicRuleUpdates += 1;
      const next = new Map(dynamicRules.map((rule) => [rule.id, clone(rule)]));
      for (const id of removeRuleIds) next.delete(id);
      for (const rule of addRules) {
        if (next.has(rule.id)) throw new Error(`duplicate dynamic rule ID ${rule.id}`);
        next.set(rule.id, clone(rule));
      }
      dynamicRules = [...next.values()].sort((left, right) => left.id - right.id);
    },
  },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const blocklist = await import("../src/lib/blocklist.js");
const google = await import("../src/lib/google-integration.js");

function resetState(): void {
  storage = {};
  dynamicRules = [];
  dynamicRuleUpdates = 0;
  unsafeDynamicRuleLimit = 5_000;
  totalDynamicRuleLimit = 30_000;
}

function foreignRedirectRule(id: number, host = "foreign.example"): chrome.declarativeNetRequest.Rule {
  return {
    id,
    priority: 1,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
      redirect: { url: "chrome-extension://round30/another-feature.html" },
    },
    condition: {
      requestDomains: [host],
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
    },
  };
}

// A different feature is free to use low dynamic-rule IDs. Round 29 rejected
// this safe coexistence case and left the user's blocklist unenforced.
resetState();
storage = {
  blockedSites: ["example.com"],
  startTabDataRevision: { version: 1, updatedAt: 1 },
};
const lowIdForeignRule = foreignRedirectRule(1);
dynamicRules = [lowIdForeignRule];
await blocklist.syncRules();
assert.deepEqual(dynamicRules.find((rule) => rule.id === lowIdForeignRule.id), lowIdForeignRule,
  "Low-ID foreign rules must survive blocklist synchronization");
assert.ok(dynamicRules.some((rule) => rule.id === 2
  && rule.action.redirect?.url?.includes("blocked.html?site=example.com")),
"A low-ID foreign rule must not prevent installation of the blocklist rule");

// Allocation must skip every occupied foreign ID deterministically without
// renumbering the ordinary no-collision case exercised by historical fixtures.
resetState();
storage = {
  blockedSites: ["a.example", "b.example"],
  startTabDataRevision: { version: 1, updatedAt: 2 },
};
const foreignOne = foreignRedirectRule(1, "one.foreign");
const foreignThree = foreignRedirectRule(3, "three.foreign");
dynamicRules = [foreignOne, foreignThree];
await blocklist.syncRules();
assert.deepEqual(dynamicRules.filter((rule) => rule.id === 1 || rule.id === 3), [foreignOne, foreignThree],
  "Sparse foreign IDs must remain byte-for-byte unchanged");
assert.deepEqual(
  dynamicRules.filter((rule) => rule.action.redirect?.url?.includes("blocked.html?site=")).map((rule) => rule.id),
  [2, 4],
  "Blocklist rule allocation must skip every occupied foreign ID deterministically",
);

// Chrome's unsafe dynamic-rule quota is shared by every feature in this
// extension. Capacity failure must be detected before the atomic API call.
resetState();
unsafeDynamicRuleLimit = 2;
totalDynamicRuleLimit = 10;
storage = {
  blockedSites: ["a.example", "b.example"],
  startTabDataRevision: { version: 1, updatedAt: 3 },
};
const quotaForeignRule = foreignRedirectRule(77);
dynamicRules = [quotaForeignRule];
await assert.rejects(
  () => blocklist.syncRules(),
  /unsafe dynamic-rule capacity/,
  "Shared unsafe DNR capacity must be validated before synchronization",
);
assert.equal(dynamicRuleUpdates, 0, "Capacity rejection must happen before updateDynamicRules");
assert.deepEqual(dynamicRules, [quotaForeignRule], "Capacity rejection must leave every existing rule untouched");

// Google explicitly permits an incomplete or empty page with a nextPageToken,
// even without q. The configured display limit is not proof that the first page
// is complete.
const originalFetch = globalThis.fetch;
const calendarUrls: URL[] = [];
let calendarPage = 0;
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  writable: true,
  value: async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    calendarUrls.push(url);
    calendarPage += 1;
    if (calendarPage === 1) {
      return new Response(JSON.stringify({ items: [], nextPageToken: "second-page" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      items: [{ id: "later-event", summary: "Later event", start: { dateTime: "2030-02-01T10:00:00Z" }, end: { dateTime: "2030-02-01T11:00:00Z" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  },
});
try {
  const events = await google.listCalendarEvents("primary", 1, "");
  assert.equal(events[0]?.id, "later-event",
    "Calendar pagination without a search query must follow an incomplete page token");
  assert.equal(calendarUrls.length, 2, "The no-query fixture must request the later page");
  assert.equal(calendarUrls[1]?.searchParams.get("pageToken"), "second-page");
  assert.equal(calendarUrls[0]?.searchParams.get("timeMin"), calendarUrls[1]?.searchParams.get("timeMin"),
    "No-query pagination must preserve the exact original request parameters");
} finally {
  Object.defineProperty(globalThis, "fetch", { value: originalFetch, configurable: true, writable: true });
}

console.log("Round 30 fixtures passed");
