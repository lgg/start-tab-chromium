import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path, before, after) {
  const source = await readFile(path, "utf8");
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Round 28 patch source not found in ${path}: ${before.slice(0, 100)}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Round 28 patch source is ambiguous in ${path}`);
  await writeFile(path, source.slice(0, first) + after + source.slice(first + before.length), "utf8");
}

await replaceOnce(
  "src/lib/blocklist.ts",
  `function rulePriorityForHost(host: string): number {\n  return Math.max(1, host.split(".").length - 1);\n}`,
  `function rulePriorityForHost(host: string): number {\n  // A proper child suffix always contains at least one additional label. Using\n  // the complete label depth keeps that ordering strict even for one-label\n  // parents such as localhost or a deliberately blocked public suffix.\n  return host.split(".").length;\n}`,
);

await replaceOnce(
  "src/lib/start-page-runtime.ts",
  `import { cloneDictionary, createDictionary, ownValue } from "./dictionary.js";\nimport { withStorageLock } from "./storage-lock.js";`,
  `import { cloneDictionary, createDictionary, ownValue } from "./dictionary.js";\nimport { runIndependentEffects } from "./independent-effects.js";\nimport { withStorageLock } from "./storage-lock.js";`,
);

await replaceOnce(
  "src/lib/start-page-runtime.ts",
  `        try {\n          await restoreStorageKeysSnapshot(previousStorage, rollbackKeys);\n          if (previousAlarms) await restoreClockAlarmSnapshot(previousAlarms);\n        } catch (rollbackError) {`,
  `        try {\n          const rollbackEffects: Array<() => Promise<void>> = [\n            () => restoreStorageKeysSnapshot(previousStorage, rollbackKeys),\n          ];\n          if (previousAlarms) rollbackEffects.push(() => restoreClockAlarmSnapshot(previousAlarms));\n          await runIndependentEffects(rollbackEffects, "Clock runtime storage/alarm rollback was incomplete");\n        } catch (rollbackError) {`,
);

await replaceOnce(
  "src/lib/start-page-runtime.ts",
  `export async function restoreClockAlarmSnapshot(snapshot: ClockAlarmSnapshot[]): Promise<void> {\n  await clearClockAlarms();\n  for (const alarm of snapshot) {\n    await chrome.alarms.create(alarm.name, {\n      when: alarm.scheduledTime,\n      ...(typeof alarm.periodInMinutes === "number" ? { periodInMinutes: alarm.periodInMinutes } : {}),\n    });\n  }\n}`,
  `export async function restoreClockAlarmSnapshot(snapshot: ClockAlarmSnapshot[]): Promise<void> {\n  const errors: unknown[] = [];\n  try {\n    const existing = await chrome.alarms.getAll();\n    try {\n      await runIndependentEffects(\n        existing\n          .filter((alarm) => alarm.name.startsWith(CLOCK_ALARM_PREFIX))\n          .map((alarm) => async () => { await chrome.alarms.clear(alarm.name); }),\n        "Clock alarm snapshot cleanup was incomplete",\n      );\n    } catch (error) {\n      errors.push(error);\n    }\n  } catch (error) {\n    errors.push(error);\n  }\n\n  try {\n    await runIndependentEffects(\n      snapshot.map((alarm) => async () => {\n        await chrome.alarms.create(alarm.name, {\n          when: alarm.scheduledTime,\n          ...(typeof alarm.periodInMinutes === "number" ? { periodInMinutes: alarm.periodInMinutes } : {}),\n        });\n      }),\n      "Clock alarm snapshot recreation was incomplete",\n    );\n  } catch (error) {\n    errors.push(error);\n  }\n\n  if (errors.length === 1) throw errors[0];\n  if (errors.length > 1) throw new AggregateError(errors, "Clock alarm snapshot restoration was incomplete");\n}`,
);

await replaceOnce(
  "src/lib/start-page-runtime.ts",
  `async function restoreStorageKeysSnapshot(snapshot: Record<string, unknown>, keys: readonly string[]): Promise<void> {\n  const absent = absentStorageKeys(snapshot, keys);\n  if (absent.length > 0) await chrome.storage.local.remove(absent);\n  if (Object.keys(snapshot).length > 0) await chrome.storage.local.set(snapshot);\n}`,
  `async function restoreStorageKeysSnapshot(snapshot: Record<string, unknown>, keys: readonly string[]): Promise<void> {\n  const absent = absentStorageKeys(snapshot, keys);\n  const effects: Array<() => Promise<void>> = [];\n  if (absent.length > 0) effects.push(() => chrome.storage.local.remove(absent));\n  if (Object.keys(snapshot).length > 0) effects.push(() => chrome.storage.local.set(snapshot));\n  await runIndependentEffects(effects, "Start Tab runtime storage rollback was incomplete");\n}`,
);

await replaceOnce(
  "src/lib/start-page-runtime.ts",
  `      try {\n        await restoreStorageKeysSnapshot(previous, RUNTIME_STORAGE_KEYS);\n        await restoreClockAlarmSnapshot(previousAlarms);\n      } catch (rollbackError) {\n        throw new AggregateError([error, rollbackError], "Failed to reset Start Tab runtime and restore the previous state");\n      }`,
  `      try {\n        await runIndependentEffects([\n          () => restoreStorageKeysSnapshot(previous, RUNTIME_STORAGE_KEYS),\n          () => restoreClockAlarmSnapshot(previousAlarms),\n        ], "Start Tab runtime reset rollback was incomplete");\n      } catch (rollbackError) {\n        throw new AggregateError([error, rollbackError], "Failed to reset Start Tab runtime and restore the previous state");\n      }`,
);

await replaceOnce(
  "src/lib/start-page-runtime.ts",
  `      try {\n        await restoreStorageKeysSnapshot(previous, RESET_STORAGE_KEYS);\n        await restoreClockAlarmSnapshot(previousAlarms);\n      } catch (rollbackError) {\n        throw new AggregateError([error, rollbackError], "Failed to reset Start Tab data and restore the previous state");\n      }`,
  `      try {\n        await runIndependentEffects([\n          () => restoreStorageKeysSnapshot(previous, RESET_STORAGE_KEYS),\n          () => restoreClockAlarmSnapshot(previousAlarms),\n        ], "Start Tab data reset rollback was incomplete");\n      } catch (rollbackError) {\n        throw new AggregateError([error, rollbackError], "Failed to reset Start Tab data and restore the previous state");\n      }`,
);

await replaceOnce(
  "scripts/round27-fixtures.ts",
  `  redirectRule(1, "app.example.com", 2),\n  redirectRule(2, "example.com", 1),`,
  `  redirectRule(1, "app.example.com", 3),\n  redirectRule(2, "example.com", 2),`,
);

await replaceOnce(
  "scripts/validate-round27-static.mjs",
  `assert.match(blocklist, /Math\\.max\\(1, host\\.split\\("\\."\\)\\.length - 1\\)/,\n  "Every additional subdomain label must raise DNR priority");`,
  `assert.match(blocklist, /return host\\.split\\("\\."\\)\\.length;/,\n  "Every additional subdomain label, including one-label to two-label nesting, must raise DNR priority");`,
);

await replaceOnce(
  "docs/audit-2026-07-19-round-27.md",
  `- generated DNR priority increases with normalized domain depth;\n- a more-specific blocked subdomain therefore wins before its parent rule;\n- ordinary two-label domains retain priority \`1\`, preserving existing canonical rules;`,
  `- generated DNR priority equals normalized domain label depth;\n- a more-specific blocked subdomain therefore always wins before its parent rule, including one-label parents such as \`localhost\`;`,
);

console.log("Round 28 production and historical-contract patches applied");
