import { readFile, writeFile } from "node:fs/promises";

async function transformIfNeeded(path, finalMarker, transform) {
  const source = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
  if (source.includes(finalMarker)) return;
  const updated = transform(source);
  if (updated === source) throw new Error(`Round 31 follow-up made no change in ${path}`);
  if (!updated.includes(finalMarker)) throw new Error(`Round 31 follow-up marker missing in ${path}: ${finalMarker}`);
  await writeFile(path, updated, "utf8");
}

await transformIfNeeded("src/lib/blocklist.ts", "url.host !== blockedUrl.host", (source) => source.replace(
  /  if \(url\.origin !== blockedUrl\.origin \|\| url\.pathname !== blockedUrl\.pathname \|\| url\.hash\) return null;/,
  '  if (url.protocol !== blockedUrl.protocol || url.host !== blockedUrl.host || url.pathname !== blockedUrl.pathname || url.hash) return null;',
));

await transformIfNeeded("src/lib/blocklist.ts", "rawSite !== site", (source) => source.replace(
  /  const site = normalizeStoredHost\(siteValues\[0\] \?\? ""\);\n  if \(!site\) return null;/,
  `  const rawSite = siteValues[0] ?? "";
  const site = normalizeStoredHost(rawSite);
  if (!site || rawSite !== site) return null;`,
));

await transformIfNeeded("src/lib/blocklist.ts", "rule.priority !== rulePriorityForHost(site)", (source) => source.replace(
  /  const requestDomains = rule\.condition\.requestDomains;\n  const resourceTypes = rule\.condition\.resourceTypes;\n  const conditionKeys = Object\.keys\(rule\.condition\)\.sort\(\);/,
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
));

await transformIfNeeded("src/lib/blocklist.ts", "requestDomains[0] !== site", (source) => source.replace(
  /    \|\| normalizeStoredHost\(requestDomains\[0\] \?\? ""\) !== site/,
  '    || requestDomains[0] !== site',
));

await transformIfNeeded("src/lib/blocklist.ts", "const legacyRedirectUrl = chrome.runtime.getURL", (source) => {
  const start = source.indexOf('  const owners = url.searchParams.getAll("owner");');
  const end = start < 0 ? -1 : source.indexOf("  return null;", start);
  if (start < 0 || end < 0) return source;
  const replacement = `  const owners = url.searchParams.getAll("owner");
  const legacyRedirectUrl = chrome.runtime.getURL(\`\${BLOCKED_PAGE}?site=\${encodeURIComponent(site)}\`);
  const currentRedirectUrl = chrome.runtime.getURL(\`\${BLOCKED_PAGE}?site=\${encodeURIComponent(site)}&owner=\${BLOCKLIST_RULE_OWNER_VALUE}\`);
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
  }
`;
  return source.slice(0, start) + replacement + source.slice(end);
});

await transformIfNeeded("src/lib/chrome-sync.ts", "meta.chunks !== chunks.length", (source) => source.replace(
  /chunks\.length < 1 \|\| chunks\.length > MAX_SYNC_CHUNKS/,
  "chunks.length < 1 || chunks.length > MAX_SYNC_CHUNKS || meta.chunks !== chunks.length",
));

await transformIfNeeded(
  "scripts/validate-round6-static.mjs",
  "Sync uploads must replace orphaned chunks through one complete frame",
  (source) => source.replace(
    /assert\.match\(sync, \/startsWith\\\(CHUNK_PREFIX\\\)\/, "Sync uploads must clean orphaned chunks even when old metadata is corrupt"\);/,
    `assert.match(sync, /completeChromeSyncPayload/, "Sync uploads must replace orphaned chunks through one complete frame");
assert.doesNotMatch(sync, /staleRemovedBeforeWrite|const staleKeys/, "Sync uploads must not perform a destructive post-write stale cleanup");`,
  ),
);

await transformIfNeeded(
  "scripts/round6-fixtures.ts",
  "Orphaned sync chunks must be cleared inside the complete upload frame",
  (source) => source.replace(
    /assert\.equal\(Object\.prototype\.hasOwnProperty\.call\(syncState, "startTabSyncChunk9"\), false, "Orphaned sync chunks must be removed even when prior metadata is corrupt"\);/,
    'assert.equal(syncState.startTabSyncChunk9, "", "Orphaned sync chunks must be cleared inside the complete upload frame even when prior metadata is corrupt");',
  ),
);

await transformIfNeeded(
  "scripts/validate-round13-static.mjs",
  "Browser Sync must not delete or roll back stale chunks after another device may have committed",
  (source) => source.replace(
    /assert\.match\(syncSource, \/staleRemovedBeforeWrite\/, "Temporary quota pressure must use recoverable stale-chunk cleanup"\);\nassert\.match\(syncSource, \/stale-chunk rollback was incomplete\/, "A failed upload must report incomplete stale-chunk rollback"\);/,
    `assert.match(syncSource, /completeChromeSyncPayload/, "Browser Sync must clear inactive chunk slots in the same committed frame");
assert.doesNotMatch(syncSource, /staleRemovedBeforeWrite|stale-chunk rollback was incomplete/, "Browser Sync must not delete or roll back stale chunks after another device may have committed");`,
  ),
);

for (const fixture of ["round24", "round25", "round26", "round27", "round28"]) {
  await transformIfNeeded(`scripts/${fixture}-fixtures.ts`, "owner=start-tab-blocklist-v1", (source) => source.replace(
    `blocked.html?site=\${encodeURIComponent(host)}\``,
    `blocked.html?site=\${encodeURIComponent(host)}&owner=start-tab-blocklist-v1\``,
  ));
}

console.log("Round 31 follow-up hardening and historical contract migration applied");
