import { readFile, writeFile } from "node:fs/promises";

const lines = (...values) => values.join("\n");

async function replaceOnce(path, before, after) {
  const source = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Round 31 patch source not found in ${path}: ${before.slice(0, 160)}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Round 31 patch source is ambiguous in ${path}`);
  await writeFile(path, source.slice(0, first) + after + source.slice(first + before.length), "utf8");
}

await replaceOnce(
  "src/lib/blocklist.ts",
  'export const BLOCKED_PAGE = "blocked.html";',
  lines(
    'export const BLOCKED_PAGE = "blocked.html";',
    '',
    'const BLOCKLIST_RULE_OWNER_VALUE = "start-tab-blocklist-v1";',
    'const MAX_DNR_RECONCILE_ATTEMPTS = 4;',
    '',
    'class DynamicRuleCollisionError extends Error {',
    '  constructor(readonly ruleId: number, message: string) {',
    '    super(message);',
    '    this.name = "DynamicRuleCollisionError";',
    '  }',
    '}',
  ),
);

await replaceOnce(
  "src/lib/blocklist.ts",
  '        redirect: { url: chrome.runtime.getURL(`${BLOCKED_PAGE}?site=${encodeURIComponent(host)}`) },',
  '        redirect: { url: chrome.runtime.getURL(`${BLOCKED_PAGE}?site=${encodeURIComponent(host)}&owner=${BLOCKLIST_RULE_OWNER_VALUE}`) },',
);

await replaceOnce(
  "src/lib/blocklist.ts",
  lines(
    'function isBlocklistDynamicRule(rule: chrome.declarativeNetRequest.Rule): boolean {',
    '  const redirectUrl = rule.action.redirect?.url;',
    '  return rule.action.type === chrome.declarativeNetRequest.RuleActionType.REDIRECT',
    '    && typeof redirectUrl === "string"',
    '    && redirectUrl.startsWith(chrome.runtime.getURL(BLOCKED_PAGE) + "?site=");',
    '}',
  ),
  lines(
    'interface ParsedBlocklistDynamicRule {',
    '  site: string;',
    '  legacy: boolean;',
    '}',
    '',
    'function parseBlocklistDynamicRule(rule: chrome.declarativeNetRequest.Rule): ParsedBlocklistDynamicRule | null {',
    '  const redirectUrl = rule.action.redirect?.url;',
    '  if (rule.action.type !== chrome.declarativeNetRequest.RuleActionType.REDIRECT || typeof redirectUrl !== "string") {',
    '    return null;',
    '  }',
    '  let url: URL;',
    '  try {',
    '    url = new URL(redirectUrl);',
    '  } catch {',
    '    return null;',
    '  }',
    '  const blockedUrl = new URL(chrome.runtime.getURL(BLOCKED_PAGE));',
    '  if (url.origin !== blockedUrl.origin || url.pathname !== blockedUrl.pathname || url.hash) return null;',
    '  const siteValues = url.searchParams.getAll("site");',
    '  if (siteValues.length !== 1) return null;',
    '  const site = normalizeStoredHost(siteValues[0] ?? "");',
    '  if (!site) return null;',
    '',
    '  const requestDomains = rule.condition.requestDomains;',
    '  const resourceTypes = rule.condition.resourceTypes;',
    '  const conditionKeys = Object.keys(rule.condition).sort();',
    '  if (conditionKeys.length !== 2',
    '    || conditionKeys[0] !== "requestDomains"',
    '    || conditionKeys[1] !== "resourceTypes"',
    '    || requestDomains?.length !== 1',
    '    || normalizeStoredHost(requestDomains[0] ?? "") !== site',
    '    || resourceTypes?.length !== 1',
    '    || resourceTypes[0] !== chrome.declarativeNetRequest.ResourceType.MAIN_FRAME) {',
    '    return null;',
    '  }',
    '',
    '  let parameterCount = 0;',
    '  url.searchParams.forEach(() => { parameterCount += 1; });',
    '  const owners = url.searchParams.getAll("owner");',
    '  if (parameterCount === 1 && owners.length === 0) return { site, legacy: true };',
    '  if (parameterCount === 2 && owners.length === 1 && owners[0] === BLOCKLIST_RULE_OWNER_VALUE) {',
    '    return { site, legacy: false };',
    '  }',
    '  return null;',
    '}',
    '',
    'function isBlocklistDynamicRule(rule: chrome.declarativeNetRequest.Rule): boolean {',
    '  return parseBlocklistDynamicRule(rule) !== null;',
    '}',
  ),
);

await replaceOnce(
  "src/lib/blocklist.ts",
  lines(
    '  const collision = rules.find((rule) => foreignRuleIds.has(rule.id));',
    '  if (collision) {',
    '    throw new Error(',
    '      `Blocklist DNR rule ID ${collision.id} conflicts with a dynamic rule owned by another Start Tab feature`,',
    '    );',
    '  }',
    '  await chrome.declarativeNetRequest.updateDynamicRules({',
    '    removeRuleIds: currentRules.map((rule) => rule.id),',
    '    addRules: structuredClone([...rules]),',
    '  });',
  ),
  lines(
    '  const collision = rules.find((rule) => foreignRuleIds.has(rule.id));',
    '  if (collision) {',
    '    throw new DynamicRuleCollisionError(',
    '      collision.id,',
    '      `Blocklist DNR rule ID ${collision.id} conflicts with a dynamic rule owned by another Start Tab feature`,',
    '    );',
    '  }',
    '  try {',
    '    await chrome.declarativeNetRequest.updateDynamicRules({',
    '      removeRuleIds: currentRules.map((rule) => rule.id),',
    '      addRules: structuredClone([...rules]),',
    '    });',
    '  } catch (error) {',
    '    const latestRules = await chrome.declarativeNetRequest.getDynamicRules();',
    '    const latestForeignIds = new Set(foreignDynamicRules(latestRules).map((rule) => rule.id));',
    '    const latestCollision = rules.find((rule) => latestForeignIds.has(rule.id));',
    '    if (latestCollision) {',
    '      throw new DynamicRuleCollisionError(',
    '        latestCollision.id,',
    '        `Blocklist DNR rule ID ${latestCollision.id} was claimed concurrently by another Start Tab feature`,',
    '      );',
    '    }',
    '    throw error;',
    '  }',
  ),
);

await replaceOnce(
  "src/lib/blocklist.ts",
  lines(
    'async function replaceDynamicRules(',
    '  sites: string[],',
    '  _existing?: readonly chrome.declarativeNetRequest.Rule[],',
    '): Promise<void> {',
    '  const allCurrentRules = await chrome.declarativeNetRequest.getDynamicRules();',
    '  const foreignRules = foreignDynamicRules(allCurrentRules);',
    '  const rules = buildRules(sites, new Set(foreignRules.map((rule) => rule.id)));',
    '  await replaceDynamicRulesExact(rules, allCurrentRules);',
    '}',
  ),
  lines(
    'async function replaceDynamicRules(',
    '  sites: string[],',
    '  _existing?: readonly chrome.declarativeNetRequest.Rule[],',
    '): Promise<void> {',
    '  let lastCollision: DynamicRuleCollisionError | undefined;',
    '  for (let attempt = 0; attempt < MAX_DNR_RECONCILE_ATTEMPTS; attempt += 1) {',
    '    const allCurrentRules = await chrome.declarativeNetRequest.getDynamicRules();',
    '    const foreignRules = foreignDynamicRules(allCurrentRules);',
    '    const rules = buildRules(sites, new Set(foreignRules.map((rule) => rule.id)));',
    '    try {',
    '      await replaceDynamicRulesExact(rules, allCurrentRules);',
    '      return;',
    '    } catch (error) {',
    '      if (!(error instanceof DynamicRuleCollisionError)) throw error;',
    '      lastCollision = error;',
    '    }',
    '  }',
    '  throw lastCollision ?? new Error("Blocklist DNR reconciliation exhausted its retry limit");',
    '}',
  ),
);

await replaceOnce(
  "src/lib/chrome-sync.ts",
  'function chunkKey(index: number): string { return `${CHUNK_PREFIX}${index}`; }',
  lines(
    'function chunkKey(index: number): string { return `${CHUNK_PREFIX}${index}`; }',
    'export function completeChromeSyncPayload(meta: SyncMeta, chunks: readonly string[]): Record<string, unknown> {',
    '  if (chunks.length < 1 || chunks.length > MAX_SYNC_CHUNKS) throw new Error("Invalid Browser Sync chunk frame");',
    '  const payload: Record<string, unknown> = { [META_KEY]: meta };',
    '  for (let index = 0; index < MAX_SYNC_CHUNKS; index += 1) {',
    '    payload[chunkKey(index)] = chunks[index] ?? "";',
    '  }',
    '  return payload;',
    '}',
  ),
);

await replaceOnce(
  "src/lib/chrome-sync.ts",
  lines(
    '  const payload: Record<string, unknown> = { [META_KEY]: meta };',
    '  snapshot.chunks.forEach((chunk, index) => { payload[chunkKey(index)] = chunk; });',
    '  const activeChunkKeys = new Set(snapshot.chunks.map((_, index) => chunkKey(index)));',
    '  const staleKeys = Object.keys(existing).filter((key) => key.startsWith(CHUNK_PREFIX) && !activeChunkKeys.has(key));',
    '  const finalState = { ...existing, ...payload };',
    '  for (const key of staleKeys) delete finalState[key];',
    '  const totalQuota = syncTotalQuotaBytes();',
    '  if (chromeSyncStorageBytes(finalState) > totalQuota) {',
    '    throw new Error("Start Tab backup is too large for the browser sync total quota. Use JSON export or Google Drive backup instead.");',
    '  }',
    '',
    '  const writeState = { ...existing, ...payload };',
    '  let staleRemovedBeforeWrite = false;',
    '  if (staleKeys.length > 0 && chromeSyncStorageBytes(writeState) > totalQuota) {',
    '    await chrome.storage.sync.remove(staleKeys);',
    '    staleRemovedBeforeWrite = true;',
    '  }',
    '  try {',
    '    await chrome.storage.sync.set(payload);',
    '  } catch (error) {',
    '    if (staleRemovedBeforeWrite) {',
    '      const rollback = Object.fromEntries(staleKeys.map((key) => [key, existing[key]]));',
    '      try {',
    '        await chrome.storage.sync.set(rollback);',
    '      } catch (rollbackError) {',
    '        throw new AggregateError([error, rollbackError], "Browser sync upload failed and stale-chunk rollback was incomplete");',
    '      }',
    '    }',
    '    throw error;',
    '  }',
    '  if (!staleRemovedBeforeWrite && staleKeys.length > 0) await chrome.storage.sync.remove(staleKeys);',
  ),
  lines(
    '  const payload = completeChromeSyncPayload(meta, snapshot.chunks);',
    '  const finalState = { ...existing, ...payload };',
    '  const totalQuota = syncTotalQuotaBytes();',
    '  if (chromeSyncStorageBytes(finalState) > totalQuota) {',
    '    throw new Error("Start Tab backup is too large for the browser sync total quota. Use JSON export or Google Drive backup instead.");',
    '  }',
    '',
    '  await chrome.storage.sync.set(payload);',
  ),
);

await replaceOnce(
  "package.json",
  'node scripts/run-round30-fixtures.mjs && node scripts/validate-round30-static.mjs && node scripts/validate-self-hosted-ci.mjs',
  'node scripts/run-round30-fixtures.mjs && node scripts/validate-round30-static.mjs && node scripts/run-round31-fixtures.mjs && node scripts/validate-round31-static.mjs && node scripts/validate-self-hosted-ci.mjs',
);

await replaceOnce(
  "scripts/validate-self-hosted-ci.mjs",
  lines(
    '  "node scripts/run-round30-fixtures.mjs",',
    '  "node scripts/validate-round30-static.mjs",',
    '  "node scripts/validate-self-hosted-ci.mjs",',
  ),
  lines(
    '  "node scripts/run-round30-fixtures.mjs",',
    '  "node scripts/validate-round30-static.mjs",',
    '  "node scripts/run-round31-fixtures.mjs",',
    '  "node scripts/validate-round31-static.mjs",',
    '  "node scripts/validate-self-hosted-ci.mjs",',
  ),
);

console.log("Round 31 production, package, and self-hosted CI patches applied");
