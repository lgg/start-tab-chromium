import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path, before, after) {
  const source = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Round 30 patch source not found in ${path}: ${before.slice(0, 140)}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Round 30 patch source is ambiguous in ${path}`);
  await writeFile(path, source.slice(0, first) + after + source.slice(first + before.length), "utf8");
}

await replaceOnce(
  "src/lib/blocklist.ts",
  `function buildRules(sites: string[]): chrome.declarativeNetRequest.Rule[] {\n  const normalized = normalizeBlockedSites(sites);\n  assertBlockedSiteCapacity(normalized);\n  return normalized.map((host, index) => ({\n    id: index + 1,\n    priority: rulePriorityForHost(host),\n    action: {\n      type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,\n      redirect: { url: chrome.runtime.getURL(\`${BLOCKED_PAGE}?site=\${encodeURIComponent(host)}\`) },\n    },\n    condition: {\n      requestDomains: [host],\n      resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],\n    },\n  }));\n}`,
  `function buildRules(\n  sites: string[],\n  occupiedRuleIds: ReadonlySet<number> = new Set<number>(),\n): chrome.declarativeNetRequest.Rule[] {\n  const normalized = normalizeBlockedSites(sites);\n  assertBlockedSiteCapacity(normalized);\n  let nextRuleId = 1;\n  return normalized.map((host) => {\n    while (occupiedRuleIds.has(nextRuleId)) nextRuleId += 1;\n    const id = nextRuleId;\n    nextRuleId += 1;\n    return {\n      id,\n      priority: rulePriorityForHost(host),\n      action: {\n        type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,\n        redirect: { url: chrome.runtime.getURL(\`${BLOCKED_PAGE}?site=\${encodeURIComponent(host)}\`) },\n      },\n      condition: {\n        requestDomains: [host],\n        resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],\n      },\n    };\n  });\n}`,
);

await replaceOnce(
  "src/lib/blocklist.ts",
  `function blocklistDynamicRules(\n  rules: readonly chrome.declarativeNetRequest.Rule[],\n): chrome.declarativeNetRequest.Rule[] {\n  return rules.filter(isBlocklistDynamicRule);\n}`,
  `function blocklistDynamicRules(\n  rules: readonly chrome.declarativeNetRequest.Rule[],\n): chrome.declarativeNetRequest.Rule[] {\n  return rules.filter(isBlocklistDynamicRule);\n}\n\nfunction foreignDynamicRules(\n  rules: readonly chrome.declarativeNetRequest.Rule[],\n): chrome.declarativeNetRequest.Rule[] {\n  return rules.filter((rule) => !isBlocklistDynamicRule(rule));\n}`,
);

await replaceOnce(
  "src/lib/blocklist.ts",
  `async function replaceDynamicRulesExact(\n  rules: readonly chrome.declarativeNetRequest.Rule[],\n  _existing?: readonly chrome.declarativeNetRequest.Rule[],\n): Promise<void> {\n  const allCurrentRules = await chrome.declarativeNetRequest.getDynamicRules();\n  const currentRules = blocklistDynamicRules(allCurrentRules);\n  const foreignRuleIds = new Set(\n    allCurrentRules\n      .filter((rule) => !isBlocklistDynamicRule(rule))\n      .map((rule) => rule.id),\n  );\n  const collision = rules.find((rule) => foreignRuleIds.has(rule.id));\n  if (collision) {\n    throw new Error(\n      \`Blocklist DNR rule ID \${collision.id} conflicts with a dynamic rule owned by another Start Tab feature\`,\n    );\n  }\n  await chrome.declarativeNetRequest.updateDynamicRules({\n    removeRuleIds: currentRules.map((rule) => rule.id),\n    addRules: structuredClone([...rules]),\n  });\n}`,
  `const SAFE_DYNAMIC_RULE_ACTIONS = new Set(["allow", "allowAllRequests", "block", "upgradeScheme"]);\n\ninterface DynamicRuleLimitSurface {\n  MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES?: number;\n  MAX_NUMBER_OF_DYNAMIC_RULES?: number;\n}\n\nfunction dynamicRuleLimit(value: unknown, fallback: number): number {\n  return typeof value === "number" && Number.isFinite(value) && value > 0\n    ? Math.floor(value)\n    : fallback;\n}\n\nfunction isUnsafeDynamicRule(rule: chrome.declarativeNetRequest.Rule): boolean {\n  return !SAFE_DYNAMIC_RULE_ACTIONS.has(String(rule.action.type));\n}\n\nfunction assertDynamicRuleCapacity(\n  foreignRules: readonly chrome.declarativeNetRequest.Rule[],\n  rules: readonly chrome.declarativeNetRequest.Rule[],\n): void {\n  const limits = chrome.declarativeNetRequest as typeof chrome.declarativeNetRequest & DynamicRuleLimitSurface;\n  const unsafeLimit = dynamicRuleLimit(limits.MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES, MAX_BLOCKED_SITES);\n  const totalLimit = dynamicRuleLimit(limits.MAX_NUMBER_OF_DYNAMIC_RULES, unsafeLimit);\n  const finalRules = [...foreignRules, ...rules];\n  const unsafeCount = finalRules.filter(isUnsafeDynamicRule).length;\n  if (unsafeCount > unsafeLimit) {\n    throw new Error(\n      \`Start Tab blocklist exceeds Chrome's shared unsafe dynamic-rule capacity (\${unsafeCount}/\${unsafeLimit})\`,\n    );\n  }\n  if (finalRules.length > totalLimit) {\n    throw new Error(\n      \`Start Tab blocklist exceeds Chrome's shared dynamic-rule capacity (\${finalRules.length}/\${totalLimit})\`,\n    );\n  }\n}\n\nasync function replaceDynamicRulesExact(\n  rules: readonly chrome.declarativeNetRequest.Rule[],\n  _existing?: readonly chrome.declarativeNetRequest.Rule[],\n): Promise<void> {\n  const allCurrentRules = await chrome.declarativeNetRequest.getDynamicRules();\n  const currentRules = blocklistDynamicRules(allCurrentRules);\n  const foreignRules = foreignDynamicRules(allCurrentRules);\n  assertDynamicRuleCapacity(foreignRules, rules);\n  const foreignRuleIds = new Set(foreignRules.map((rule) => rule.id));\n  const collision = rules.find((rule) => foreignRuleIds.has(rule.id));\n  if (collision) {\n    throw new Error(\n      \`Blocklist DNR rule ID \${collision.id} conflicts with a dynamic rule owned by another Start Tab feature\`,\n    );\n  }\n  await chrome.declarativeNetRequest.updateDynamicRules({\n    removeRuleIds: currentRules.map((rule) => rule.id),\n    addRules: structuredClone([...rules]),\n  });\n}`,
);

await replaceOnce(
  "src/lib/blocklist.ts",
  `async function replaceDynamicRules(\n  sites: string[],\n  existing?: readonly chrome.declarativeNetRequest.Rule[],\n): Promise<void> {\n  await replaceDynamicRulesExact(buildRules(sites), existing);\n}`,
  `async function replaceDynamicRules(\n  sites: string[],\n  _existing?: readonly chrome.declarativeNetRequest.Rule[],\n): Promise<void> {\n  const allCurrentRules = await chrome.declarativeNetRequest.getDynamicRules();\n  const foreignRules = foreignDynamicRules(allCurrentRules);\n  const rules = buildRules(sites, new Set(foreignRules.map((rule) => rule.id)));\n  await replaceDynamicRulesExact(rules, allCurrentRules);\n}`,
);

await replaceOnce(
  "src/lib/blocklist.ts",
  `  if (storageUnchanged) {\n    const expectedRules = buildRules(nextSites);\n    if (dynamicRulesEqual(originalRules, expectedRules)) return previousSites;`,
  `  if (storageUnchanged) {\n    const allCurrentRules = await chrome.declarativeNetRequest.getDynamicRules();\n    const foreignRules = foreignDynamicRules(allCurrentRules);\n    const currentRules = blocklistDynamicRules(allCurrentRules);\n    const expectedRules = buildRules(nextSites, new Set(foreignRules.map((rule) => rule.id)));\n    if (dynamicRulesEqual(currentRules, expectedRules)) return previousSites;`,
);

await replaceOnce(
  "src/lib/google-integration.ts",
  `    if (!normalizedQuery || !nextPageToken || seenPageTokens.has(nextPageToken)) break;`,
  `    if (!nextPageToken || seenPageTokens.has(nextPageToken)) break;`,
);

await replaceOnce(
  "scripts/round29-fixtures.ts",
  `// A foreign rule that occupies a blocklist rule ID must cause a safe failure,\n// never silent deletion or replacement of the foreign rule.\nresetState();\nstorage = {\n  blockedSites: ["example.com"],\n  startTabDataRevision: { version: 1, updatedAt: 2 },\n};\nconst collidingRule = foreignRedirectRule(1);\ndynamicRules = [collidingRule];\nawait assert.rejects(\n  () => blocklist.syncRules(),\n  /conflicts with a dynamic rule owned by another Start Tab feature/,\n  "DNR ownership collisions must fail before any foreign rule is removed",\n);\nassert.deepEqual(dynamicRules, [collidingRule], "A DNR ownership collision must leave the complete rule set untouched");`,
  `// A low-ID foreign rule must remain untouched while the blocklist allocates a\n// different free ID and still enforces the requested site.\nresetState();\nstorage = {\n  blockedSites: ["example.com"],\n  startTabDataRevision: { version: 1, updatedAt: 2 },\n};\nconst collidingRule = foreignRedirectRule(1);\ndynamicRules = [collidingRule];\nawait blocklist.syncRules();\nassert.deepEqual(dynamicRules.find((rule) => rule.id === collidingRule.id), collidingRule,\n  "Low-ID foreign rules must remain untouched during blocklist synchronization");\nassert.ok(dynamicRules.some((rule) => rule.id !== collidingRule.id\n  && rule.action.redirect?.url?.includes("blocked.html?site=example.com")),\n"Low-ID foreign rules must not block blocklist synchronization");`,
);

await replaceOnce(
  "scripts/validate-round29-static.mjs",
  `  "DNR ownership collisions must fail before any foreign rule is removed",`,
  `  "Low-ID foreign rules must not block blocklist synchronization",`,
);

await replaceOnce(
  "package.json",
  `node scripts/run-round29-fixtures.mjs && node scripts/validate-round29-static.mjs && node scripts/validate-self-hosted-ci.mjs`,
  `node scripts/run-round29-fixtures.mjs && node scripts/validate-round29-static.mjs && node scripts/run-round30-fixtures.mjs && node scripts/validate-round30-static.mjs && node scripts/validate-self-hosted-ci.mjs`,
);

await replaceOnce(
  ".github/workflows/ci.yml",
  `      - name: Validate round 29\n        run: node scripts/validate-round29-static.mjs\n\n      - name: Validate self-hosted CI contract`,
  `      - name: Validate round 29\n        run: node scripts/validate-round29-static.mjs\n\n      - name: Run round 30 fixtures\n        run: node scripts/run-round30-fixtures.mjs\n\n      - name: Validate round 30\n        run: node scripts/validate-round30-static.mjs\n\n      - name: Validate self-hosted CI contract`,
);

await replaceOnce(
  "scripts/validate-self-hosted-ci.mjs",
  `  "node scripts/run-round26-fixtures.mjs",\n  "node scripts/validate-round26-static.mjs",\n  "node scripts/validate-self-hosted-ci.mjs",`,
  `  "node scripts/run-round26-fixtures.mjs",\n  "node scripts/validate-round26-static.mjs",\n  "node scripts/run-round27-fixtures.mjs",\n  "node scripts/validate-round27-static.mjs",\n  "node scripts/run-round28-fixtures.mjs",\n  "node scripts/validate-round28-static.mjs",\n  "node scripts/run-round29-fixtures.mjs",\n  "node scripts/validate-round29-static.mjs",\n  "node scripts/run-round30-fixtures.mjs",\n  "node scripts/validate-round30-static.mjs",\n  "node scripts/validate-self-hosted-ci.mjs",`,
);

console.log("Round 30 production, regression, package, and CI patches applied");
