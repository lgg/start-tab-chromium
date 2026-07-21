import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path, before, after) {
  const source = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Round 28 alarm patch source not found in ${path}: ${before.slice(0, 120)}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Round 28 alarm patch source is ambiguous in ${path}`);
  await writeFile(path, source.slice(0, first) + after + source.slice(first + before.length), "utf8");
}

await replaceOnce(
  "src/lib/start-page-runtime.ts",
  `async function clearClockAlarms(): Promise<void> {\n  const alarms = await chrome.alarms.getAll();\n  await Promise.all(alarms\n    .filter((alarm) => alarm.name.startsWith(CLOCK_ALARM_PREFIX))\n    .map((alarm) => chrome.alarms.clear(alarm.name)));\n}`,
  `async function clearClockAlarms(): Promise<void> {\n  const alarms = await chrome.alarms.getAll();\n  await runIndependentEffects(\n    alarms\n      .filter((alarm) => alarm.name.startsWith(CLOCK_ALARM_PREFIX))\n      .map((alarm) => async () => { await chrome.alarms.clear(alarm.name); }),\n    "Clock alarm cleanup was incomplete",\n  );\n}`,
);

await replaceOnce(
  "src/lib/start-page-runtime.ts",
  `    const existing = await chrome.alarms.getAll();\n    await Promise.all(existing\n      .filter((alarm) => alarm.name.startsWith(CLOCK_ALARM_PREFIX) && !desired.has(alarm.name))\n      .map((alarm) => chrome.alarms.clear(alarm.name)));`,
  `    const existing = await chrome.alarms.getAll();\n    await runIndependentEffects(\n      existing\n        .filter((alarm) => alarm.name.startsWith(CLOCK_ALARM_PREFIX) && !desired.has(alarm.name))\n        .map((alarm) => async () => { await chrome.alarms.clear(alarm.name); }),\n      "Clock alarm reconciliation cleanup was incomplete",\n    );`,
);

await replaceOnce(
  "src/lib/start-page-runtime.ts",
  `export async function clearClockAlarm(instanceId: string): Promise<void> {\n  const alarms = await chrome.alarms.getAll();\n  await Promise.all(alarms.filter((alarm) => parseClockAlarmName(alarm.name)?.instanceId === instanceId).map((alarm) => chrome.alarms.clear(alarm.name)));\n}`,
  `export async function clearClockAlarm(instanceId: string): Promise<void> {\n  const alarms = await chrome.alarms.getAll();\n  await runIndependentEffects(\n    alarms\n      .filter((alarm) => parseClockAlarmName(alarm.name)?.instanceId === instanceId)\n      .map((alarm) => async () => { await chrome.alarms.clear(alarm.name); }),\n    "Clock instance alarm cleanup was incomplete",\n  );\n}`,
);

console.log("Round 28 alarm-settlement patches applied");
