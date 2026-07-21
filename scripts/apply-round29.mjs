import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path, before, after) {
  const source = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Round 29 patch source not found in ${path}: ${before.slice(0, 120)}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Round 29 patch source is ambiguous in ${path}`);
  await writeFile(path, source.slice(0, first) + after + source.slice(first + before.length), "utf8");
}

await replaceOnce(
  "src/lib/blocklist.ts",
  `export async function readDynamicRulesSnapshot(): Promise<chrome.declarativeNetRequest.Rule[]> {\n  return structuredClone(await chrome.declarativeNetRequest.getDynamicRules());\n}`,
  `function isBlocklistDynamicRule(rule: chrome.declarativeNetRequest.Rule): boolean {\n  const redirectUrl = rule.action.redirect?.url;\n  return rule.action.type === chrome.declarativeNetRequest.RuleActionType.REDIRECT\n    && typeof redirectUrl === "string"\n    && redirectUrl.startsWith(chrome.runtime.getURL(BLOCKED_PAGE) + "?site=");\n}\n\nfunction blocklistDynamicRules(\n  rules: readonly chrome.declarativeNetRequest.Rule[],\n): chrome.declarativeNetRequest.Rule[] {\n  return rules.filter(isBlocklistDynamicRule);\n}\n\nexport async function readDynamicRulesSnapshot(): Promise<chrome.declarativeNetRequest.Rule[]> {\n  const rules = await chrome.declarativeNetRequest.getDynamicRules();\n  return structuredClone(blocklistDynamicRules(rules));\n}`,
);

await replaceOnce(
  "src/lib/blocklist.ts",
  `async function replaceDynamicRulesExact(\n  rules: readonly chrome.declarativeNetRequest.Rule[],\n  existing?: readonly chrome.declarativeNetRequest.Rule[],\n): Promise<void> {\n  const currentRules = existing ? structuredClone([...existing]) : await readDynamicRulesSnapshot();\n  await chrome.declarativeNetRequest.updateDynamicRules({\n    removeRuleIds: currentRules.map((rule) => rule.id),\n    addRules: structuredClone([...rules]),\n  });\n}`,
  `async function replaceDynamicRulesExact(\n  rules: readonly chrome.declarativeNetRequest.Rule[],\n  _existing?: readonly chrome.declarativeNetRequest.Rule[],\n): Promise<void> {\n  const allCurrentRules = await chrome.declarativeNetRequest.getDynamicRules();\n  const currentRules = blocklistDynamicRules(allCurrentRules);\n  const foreignRuleIds = new Set(\n    allCurrentRules\n      .filter((rule) => !isBlocklistDynamicRule(rule))\n      .map((rule) => rule.id),\n  );\n  const collision = rules.find((rule) => foreignRuleIds.has(rule.id));\n  if (collision) {\n    throw new Error(\n      \`Blocklist DNR rule ID \${collision.id} conflicts with a dynamic rule owned by another Start Tab feature\`,\n    );\n  }\n  await chrome.declarativeNetRequest.updateDynamicRules({\n    removeRuleIds: currentRules.map((rule) => rule.id),\n    addRules: structuredClone([...rules]),\n  });\n}`,
);

await replaceOnce(
  "src/lib/start-page-runtime.ts",
  `      try {\n        await restoreStorageKeysSnapshot(previous, RUNTIME_STORAGE_KEYS);\n        await restoreClockAlarmSnapshot(previousAlarms);\n      } catch (rollbackError) {\n        throw new AggregateError([error, rollbackError], "Failed to delete instance runtime and restore the previous state");\n      }`,
  `      try {\n        await runIndependentEffects([\n          () => restoreStorageKeysSnapshot(previous, RUNTIME_STORAGE_KEYS),\n          () => restoreClockAlarmSnapshot(previousAlarms),\n        ], "Instance runtime storage/alarm rollback was incomplete");\n      } catch (rollbackError) {\n        throw new AggregateError([error, rollbackError], "Failed to delete instance runtime and restore the previous state");\n      }`,
);

await replaceOnce(
  "src/lib/google-integration.ts",
  `  const events: GoogleCalendarEvent[] = [];\n  const seenPageTokens = new Set<string>();`,
  `  const events: GoogleCalendarEvent[] = [];\n  const timeMin = new Date().toISOString();\n  const seenPageTokens = new Set<string>();`,
);

await replaceOnce(
  "src/lib/google-integration.ts",
  `    url.searchParams.set("timeMin", new Date().toISOString());`,
  `    url.searchParams.set("timeMin", timeMin);`,
);

await replaceOnce(
  "scripts/round29-fixtures.ts",
  `const timerBlock = settings.layout.blocks.find(\n  (block): block is Extract<typeof block, { type: "timer" }> => block.id === "timer-main" && block.type === "timer",\n);\nassert.ok(timerBlock, "Default settings must contain timer-main for the fixture");`,
  `const timerBlock = settings.layout.blocks.find((block) => block.id === "timer-main");\nassert.ok(timerBlock && timerBlock.type === "timer", "Default settings must contain timer-main for the fixture");`,
);

await replaceOnce(
  "package.json",
  `node scripts/run-round28-fixtures.mjs && node scripts/validate-round28-static.mjs && node scripts/validate-self-hosted-ci.mjs`,
  `node scripts/run-round28-fixtures.mjs && node scripts/validate-round28-static.mjs && node scripts/run-round29-fixtures.mjs && node scripts/validate-round29-static.mjs && node scripts/validate-self-hosted-ci.mjs`,
);

await replaceOnce(
  ".github/workflows/ci.yml",
  `      - name: Validate round 28\n        run: node scripts/validate-round28-static.mjs\n\n      - name: Validate self-hosted CI contract`,
  `      - name: Validate round 28\n        run: node scripts/validate-round28-static.mjs\n\n      - name: Run round 29 fixtures\n        run: node scripts/run-round29-fixtures.mjs\n\n      - name: Validate round 29\n        run: node scripts/validate-round29-static.mjs\n\n      - name: Validate self-hosted CI contract`,
);

console.log("Round 29 production, fixture, package, and CI patches applied");
