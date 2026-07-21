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
  '  if (parameterCount === 1 && owners.length === 0) return { site, legacy: true };',
  '  if (parameterCount === 1 && owners.length === 0 && rule.id >= 1 && rule.id <= MAX_BLOCKED_SITES) return { site, legacy: true };',
);

await replaceOnce(
  "src/lib/chrome-sync.ts",
  '  if (chunks.length < 1 || chunks.length > MAX_SYNC_CHUNKS) throw new Error("Invalid Browser Sync chunk frame");',
  '  if (chunks.length < 1 || chunks.length > MAX_SYNC_CHUNKS || meta.chunks !== chunks.length) throw new Error("Invalid Browser Sync chunk frame");',
);

console.log("Round 31 follow-up hardening applied");
