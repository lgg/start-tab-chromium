import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [runtimeSource, serviceWorkerSource, round14Fixtures, newtabSource, recoverySource, effectsSource, packageJson] = await Promise.all([
  readFile(new URL("../src/lib/start-page-runtime.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/service-worker.ts", import.meta.url), "utf8"),
  readFile(new URL("./round14-fixtures.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/newtab/newtab.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/newtab/runtime-mutation-recovery.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/independent-effects.ts", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

const alarmCreates = [...runtimeSource.matchAll(/chrome\.alarms\.create\(/g)];
assert.equal(alarmCreates.length, 2, "Every low-level durable-alarm creation path must remain audited");
assert.equal(
  [...runtimeSource.matchAll(/await chrome\.alarms\.create\(/g)].length,
  alarmCreates.length,
  "Every chrome.alarms.create Promise must be awaited",
);
assert.match(round14Fixtures, /async create\([^)]*\): Promise<void>/,
  "Alarm failure fixtures must model the asynchronous MV3 API");
assert.match(round14Fixtures, /forced asynchronous alarm rejection/,
  "The fixture suite must inject an asynchronously rejected alarm creation");
assert.match(newtabSource, /recoverRuntimeMutation\(error/,
  "Runtime mutations must use failure-safe canonical state recovery");
assert.match(serviceWorkerSource, /runIndependentEffects\(effects/,
  "Clock completion effects must fail independently");
assert.match(effectsSource, /for \(const effect of effects\)/,
  "Every independent completion effect must be attempted");
assert.match(effectsSource, /new AggregateError/,
  "Multiple completion-effect errors must remain observable");
assert.match(recoverySource, /options\.announceConflict\(\)/,
  "A recovery failure must not suppress the visible conflict announcement");
assert.match(recoverySource, /options\.queueRefresh\(\)/,
  "A failed canonical refresh must schedule a retry");
assert.match(recoverySource, /new AggregateError/,
  "Mutation and recovery errors must both remain observable");
const parsedPackage = JSON.parse(packageJson);
assert.match(parsedPackage.scripts.test, /run-round14-fixtures/);
assert.match(parsedPackage.scripts.test, /validate-round14-static/);

console.log("Round 14 static validation passed");
