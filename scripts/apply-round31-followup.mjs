import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path, before, after) {
  const source = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Round 31 follow-up source not found in ${path}: ${before.slice(0, 160)}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Round 31 follow-up source is ambiguous in ${path}`);
  await writeFile(path, source.slice(0, first) + after + source.slice(first + before.length), "utf8");
}

await replaceOnce(
  "src/lib/blocklist.ts",
  '  if (url.origin !== blockedUrl.origin || url.pathname !== blockedUrl.pathname || url.hash) return null;',
  '  if (url.protocol !== blockedUrl.protocol || url.host !== blockedUrl.host || url.pathname !== blockedUrl.pathname || url.hash) return null;',
);

await replaceOnce(
  "src/lib/blocklist.ts",
  `  const site = normalizeStoredHost(siteValues[0] ?? "");
  if (!site) return null;`,
  `  const rawSite = siteValues[0] ?? "";
  const site = normalizeStoredHost(rawSite);
  if (!site || rawSite !== site) return null;`,
);

await replaceOnce(
  "src/lib/blocklist.ts",
  `  const requestDomains = rule.condition.requestDomains;
  const resourceTypes = rule.condition.resourceTypes;
  const conditionKeys = Object.keys(rule.condition).sort();`,
  `  const actionKeys = Object.keys(rule.action).sort();
  const redirectKeys = rule.action.redirect ? Object.keys(rule.action.redirect).sort() : [];
  if (actionKeys.length !== 2
    || actionKeys[0] !== "redirect"
    || actionKeys[1] !== "type"
    || redirectKeys.length !== 1
    || redirectKeys[0] !== "url"
    || rule.priority !== rulePriorityForHost(site)) {
    return null;
  }

  const requestDomains = rule.condition.requestDomains;
  const resourceTypes = rule.condition.resourceTypes;
  const conditionKeys = Object.keys(rule.condition).sort();`,
);

await replaceOnce(
  "src/lib/blocklist.ts",
  '    || normalizeStoredHost(requestDomains[0] ?? "") !== site',
  '    || requestDomains[0] !== site',
);

await replaceOnce(
  "src/lib/blocklist.ts",
  `  const owners = url.searchParams.getAll("owner");
  if (parameterCount === 1 && owners.length === 0) return { site, legacy: true };
  if (parameterCount === 2 && owners.length === 1 && owners[0] === BLOCKLIST_RULE_OWNER_VALUE) {
    return { site, legacy: false };
  }`,
  `  const owners = url.searchParams.getAll("owner");
  const legacyRedirectUrl = chrome.runtime.getURL(\`${BLOCKED_PAGE}?site=\${encodeURIComponent(site)}\`);
  const currentRedirectUrl = chrome.runtime.getURL(\`${BLOCKED_PAGE}?site=\${encodeURIComponent(site)}&owner=\${BLOCKLIST_RULE_OWNER_VALUE}\`);
  if (parameterCount === 1
    && owners.length === 0
    && rule.id >= 1
    && rule.id <= MAX_BLOCKED_SITES
    && redirectUrl === legacyRedirectUrl) {
    return { site, legacy: true };
  }
  if (parameterCount === 2
    && owners.length === 1
    && owners[0] === BLOCKLIST_RULE_OWNER_VALUE
    && redirectUrl === currentRedirectUrl) {
    return { site, legacy: false };
  }`,
);

await replaceOnce(
  "src/lib/chrome-sync.ts",
  '  if (chunks.length < 1 || chunks.length > MAX_SYNC_CHUNKS) throw new Error("Invalid Browser Sync chunk frame");',
  '  if (chunks.length < 1 || chunks.length > MAX_SYNC_CHUNKS || meta.chunks !== chunks.length) throw new Error("Invalid Browser Sync chunk frame");',
);

await replaceOnce(
  "scripts/validate-round6-static.mjs",
  'assert.match(sync, /startsWith\\(CHUNK_PREFIX\\)/, "Sync uploads must clean orphaned chunks even when old metadata is corrupt");',
  `assert.match(sync, /completeChromeSyncPayload/, "Sync uploads must replace orphaned chunks through one complete frame");
assert.doesNotMatch(sync, /staleRemovedBeforeWrite|const staleKeys/, "Sync uploads must not perform a destructive post-write stale cleanup");`,
);

await replaceOnce(
  "scripts/round6-fixtures.ts",
  'assert.equal(Object.prototype.hasOwnProperty.call(syncState, "startTabSyncChunk9"), false, "Orphaned sync chunks must be removed even when prior metadata is corrupt");',
  'assert.equal(syncState.startTabSyncChunk9, "", "Orphaned sync chunks must be cleared inside the complete upload frame even when prior metadata is corrupt");',
);

await replaceOnce(
  "scripts/validate-round13-static.mjs",
  `assert.match(syncSource, /staleRemovedBeforeWrite/, "Temporary quota pressure must use recoverable stale-chunk cleanup");
assert.match(syncSource, /stale-chunk rollback was incomplete/, "A failed upload must report incomplete stale-chunk rollback");`,
  `assert.match(syncSource, /completeChromeSyncPayload/, "Browser Sync must clear inactive chunk slots in the same committed frame");
assert.doesNotMatch(syncSource, /staleRemovedBeforeWrite|stale-chunk rollback was incomplete/, "Browser Sync must not delete or roll back stale chunks after another device may have committed");`,
);

await replaceOnce(
  "scripts/round27-fixtures.ts",
  '      redirect: { url: `chrome-extension://round27/blocked.html?site=${encodeURIComponent(host)}` },',
  '      redirect: { url: `chrome-extension://round27/blocked.html?site=${encodeURIComponent(host)}&owner=start-tab-blocklist-v1` },',
);

console.log("Round 31 follow-up hardening and historical contract migration applied");
