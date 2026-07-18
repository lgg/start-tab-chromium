import assert from "node:assert/strict";

import type { BackupBundle } from "../src/lib/backup.js";

const requestedCalendarUrls: URL[] = [];

const chromeMock = {
  runtime: {
    getManifest(): chrome.runtime.Manifest {
      return { manifest_version: 3, name: "Round 21", version: "1", oauth2: { client_id: "round21.apps.googleusercontent.com", scopes: [] } };
    },
  },
  identity: {
    async getAuthToken(): Promise<{ token: string }> { return { token: "round21-token" }; },
    async removeCachedAuthToken(): Promise<void> {},
  },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    requestedCalendarUrls.push(url);
    const pageToken = url.searchParams.get("pageToken");
    const payload = pageToken === "round21-page-2"
      ? {
        items: [{ id: "target", summary: "Target planning", start: { dateTime: "2030-01-02T10:00:00Z" }, end: { dateTime: "2030-01-02T11:00:00Z" } }],
      }
      : {
        items: [{ id: "description-only", summary: "Unrelated title", start: { dateTime: "2030-01-01T10:00:00Z" }, end: { dateTime: "2030-01-01T11:00:00Z" } }],
        nextPageToken: "round21-page-2",
      };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  },
});

const [{ canonicalBackupContent, previousCanonicalBackupContent }, { listCalendarEvents }] = await Promise.all([
  import("../src/lib/chrome-sync.js"),
  import("../src/lib/google-integration.js"),
]);

function backup(noteValue: string, timestamp: number): BackupBundle {
  return {
    app: "Start Tab",
    version: 4,
    exportedAt: new Date(timestamp).toISOString(),
    snapshotId: `round21-${timestamp}`,
    schema: { version: 4, storageKeys: [] },
    storage: {
      startPageSettings: {
        updatedAt: timestamp,
        layout: {
          blocks: [{ id: "note", type: "note", createdAt: timestamp, updatedAt: timestamp }],
        },
        themes: {
          customThemes: [{ id: "theme", createdAt: timestamp, updatedAt: timestamp }],
        },
      },
      startPageRuntimeState: {
        updatedAt: timestamp,
        notes: { updatedAt: noteValue },
        tasks: {
          createdAt: [{ id: "task", title: "Task", done: false, createdAt: timestamp, updatedAt: timestamp }],
        },
      },
    },
  };
}

const first = backup("first user note", 1_000);
const sameContentNewTimestamps = backup("first user note", 2_000);
assert.equal(
  canonicalBackupContent(first),
  canonicalBackupContent(sameContentNewTimestamps),
  "Generated entity timestamps must not create Browser Sync conflicts",
);

const changedUserDictionaryValue = backup("second user note", 2_000);
assert.notEqual(
  canonicalBackupContent(first),
  canonicalBackupContent(changedUserDictionaryValue),
  "A user-controlled dictionary key named updatedAt must remain part of the content checksum",
);
assert.equal(
  previousCanonicalBackupContent(first),
  previousCanonicalBackupContent(changedUserDictionaryValue),
  "The compatibility checksum fixture must reproduce the previous globally filtered behavior",
);

const events = await listCalendarEvents("primary", 1, "Target");
assert.deepEqual(events.map((event) => event.title), ["Target planning"],
  "Calendar title filtering must continue through API pages until the configured result limit is satisfied");
assert.equal(requestedCalendarUrls.length, 2);
for (const url of requestedCalendarUrls) {
  assert.equal(url.searchParams.get("q"), "Target", "Calendar filtering must be sent to Google before the display limit");
  assert.equal(url.searchParams.get("maxResults"), "100", "Filtered Calendar requests must use a bounded search page size");
}
assert.equal(requestedCalendarUrls[0]?.searchParams.has("pageToken"), false);
assert.equal(requestedCalendarUrls[1]?.searchParams.get("pageToken"), "round21-page-2");

console.log("Round 21 fixtures passed");
