import assert from "node:assert/strict";
import { chromeSyncItemBytes, chunkForChromeSync } from "../src/lib/chrome-sync.js";
import { RenderScheduler } from "../src/newtab/render-scheduler.js";

const quota = 8192;
const escapeHeavy = `${"\\\"\n".repeat(5000)}tail`;
const chunks = chunkForChromeSync(escapeHeavy, quota);
assert.ok(chunks.length > 1, "JSON-escaped content must split before exceeding the per-item quota");
assert.equal(chunks.join(""), escapeHeavy, "Chunking must preserve the exact serialized backup text");
for (const [index, chunk] of chunks.entries()) {
  assert.ok(
    chromeSyncItemBytes(`startTabSyncChunk${index}`, chunk) <= quota,
    `Chunk ${index} must fit Chrome's JSON-stringified per-item quota`,
  );
}

const unicode = "🧭Привет世界\\\"".repeat(1200);
const unicodeChunks = chunkForChromeSync(unicode, quota);
assert.equal(unicodeChunks.join(""), unicode, "Unicode chunking must preserve code points and escapes");
for (const [index, chunk] of unicodeChunks.entries()) {
  assert.ok(chromeSyncItemBytes(`startTabSyncChunk${index}`, chunk) <= quota);
}
assert.throws(() => chunkForChromeSync("x", 1), /cannot fit/, "Impossible quotas must fail before storage writes");

const frames: Array<() => void> = [];
const events: string[] = [];
const scheduler = new RenderScheduler({
  requestFrame: (callback) => { frames.push(callback); },
  refresh: async () => { events.push("refresh"); },
  render: () => { events.push("render"); },
  onError: (error) => { throw error; },
});
scheduler.queueRender();
scheduler.queueRefresh();
assert.equal(frames.length, 1, "A refresh must upgrade an already queued render rather than schedule duplicate frames");
frames.shift()?.();
await scheduler.waitForIdle();
assert.deepEqual(events, ["refresh", "render"], "The upgraded frame must refresh state before rendering");

scheduler.queueRefresh();
scheduler.queueRender();
assert.equal(frames.length, 1, "A visual render must not downgrade an already queued refresh");
frames.shift()?.();
await scheduler.waitForIdle();
assert.deepEqual(events, ["refresh", "render", "refresh", "render"]);

scheduler.dispose();
scheduler.queueRefresh();
assert.equal(frames.length, 0, "Disposed pages must not schedule more work");

console.log("Round 12 fixtures passed");
