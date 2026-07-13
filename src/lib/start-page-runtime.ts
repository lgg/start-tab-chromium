import {
  RUNTIME_SCHEMA_VERSION,
  type BlockInstance,
  type ClockBlockType,
  type ClockRuntimeState,
  type LocalTask,
  type PomodoroPhase,
  type StartPageRuntimeState,
  type StartPageSettings,
} from "./start-page-types.js";
import { getStartPageSettings, isRecord } from "./start-page-settings.js";

export const START_PAGE_RUNTIME_KEY = "startPageRuntimeState";
export const LEGACY_INSTANCE_RUNTIME_KEY = "startTabInstanceState";
export const CLOCK_ALARM_PREFIX = "start-tab-clock:";

const CLOCK_TYPES: readonly ClockBlockType[] = ["timer", "stopwatch", "pomodoro"];
const MAX_CLOCK_MS = 7 * 24 * 60 * 60 * 1000;

function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function finiteInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(finiteNumber(value, fallback, min, max));
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function timestamp(value: unknown, fallback: number | null = null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.round(value));
}

function isClockBlock(block: BlockInstance): block is Extract<BlockInstance, { type: ClockBlockType }> {
  return (CLOCK_TYPES as readonly string[]).includes(block.type);
}

export function defaultClockForBlock(block: Extract<BlockInstance, { type: ClockBlockType }>): ClockRuntimeState {
  switch (block.type) {
    case "timer":
      return {
        type: "timer",
        running: false,
        startedAt: null,
        accumulatedMs: 0,
        durationMs: block.config.durationSeconds * 1000,
        targetAt: null,
        phase: null,
        focusSessionStartedAt: null,
        completionToken: null,
        lastCompletedToken: null,
      };
    case "stopwatch":
      return {
        type: "stopwatch",
        running: false,
        startedAt: null,
        accumulatedMs: 0,
        durationMs: 0,
        targetAt: null,
        phase: null,
        focusSessionStartedAt: null,
        completionToken: null,
        lastCompletedToken: null,
      };
    case "pomodoro":
      return {
        type: "pomodoro",
        running: false,
        startedAt: null,
        accumulatedMs: 0,
        durationMs: block.config.workSeconds * 1000,
        targetAt: null,
        phase: "work",
        focusSessionStartedAt: null,
        completionToken: null,
        lastCompletedToken: null,
      };
  }
}

function normalizeClock(block: Extract<BlockInstance, { type: ClockBlockType }>, value: unknown): ClockRuntimeState {
  const fallback = defaultClockForBlock(block);
  if (!isRecord(value)) return fallback;
  const phase: PomodoroPhase | null = block.type === "pomodoro" && value.phase === "break" ? "break" : block.type === "pomodoro" ? "work" : null;
  const configuredDuration = block.type === "timer"
    ? block.config.durationSeconds * 1000
    : block.type === "pomodoro"
      ? (phase === "break" ? block.config.breakSeconds : block.config.workSeconds) * 1000
      : 0;
  const durationMs = block.type === "stopwatch"
    ? 0
    : finiteInteger(value.durationMs, configuredDuration, 1000, MAX_CLOCK_MS);
  const startedAt = timestamp(value.startedAt);
  const accumulatedMs = finiteInteger(value.accumulatedMs ?? value.elapsedMs, 0, 0, block.type === "stopwatch" ? MAX_CLOCK_MS : durationMs);
  const running = value.running === true && startedAt !== null;
  const targetAt = block.type === "stopwatch"
    ? null
    : running
      ? timestamp(value.targetAt, startedAt + Math.max(0, durationMs - accumulatedMs))
      : null;
  return {
    type: block.type,
    running,
    startedAt: running ? startedAt : null,
    accumulatedMs,
    durationMs,
    targetAt,
    phase,
    focusSessionStartedAt: block.type === "pomodoro" ? timestamp(value.focusSessionStartedAt) : null,
    completionToken: typeof value.completionToken === "string" && value.completionToken ? value.completionToken : null,
    lastCompletedToken: typeof value.lastCompletedToken === "string" && value.lastCompletedToken ? value.lastCompletedToken : null,
  };
}

function normalizeTask(value: unknown, index: number): LocalTask | null {
  if (!isRecord(value)) return null;
  const title = stringValue(value.title, "").trim().slice(0, 500);
  if (!title) return null;
  const now = Date.now();
  return {
    id: stringValue(value.id, `task-${index + 1}-${now.toString(36)}`).slice(0, 160),
    title,
    done: value.done === true,
    createdAt: finiteInteger(value.createdAt, now, 0, Number.MAX_SAFE_INTEGER),
    updatedAt: finiteInteger(value.updatedAt, now, 0, Number.MAX_SAFE_INTEGER),
  };
}

function normalizeTaskList(value: unknown): LocalTask[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const task = normalizeTask(item, index);
    return task ? [task] : [];
  });
}

function firstBlockOfType(settings: StartPageSettings, type: BlockInstance["type"]): BlockInstance | null {
  return settings.layout.blocks.find((block) => block.type === type) ?? null;
}

function legacyClockValue(
  block: Extract<BlockInstance, { type: ClockBlockType }>,
  primary: Record<string, unknown>,
  secondary: Record<string, unknown>,
): unknown {
  const primaryClocks = isRecord(primary.clocks) ? primary.clocks : {};
  const secondaryClocks = isRecord(secondary.clocks) ? secondary.clocks : {};
  return primaryClocks[block.id]
    ?? secondaryClocks[block.id]
    ?? primaryClocks[block.type]
    ?? secondaryClocks[block.type];
}

export function normalizeRuntimeState(
  value: unknown,
  settings: StartPageSettings,
  legacyInstanceValue: unknown = undefined,
): StartPageRuntimeState {
  const source = isRecord(value) ? value : {};
  const legacy = isRecord(legacyInstanceValue) ? legacyInstanceValue : {};
  const version = source.version === RUNTIME_SCHEMA_VERSION ? RUNTIME_SCHEMA_VERSION : 1;
  const sourceClocks = isRecord(source.clocks) ? source.clocks : {};
  const sourceNotes = isRecord(source.notes) ? source.notes : {};
  const sourceTasks = isRecord(source.tasks) ? source.tasks : {};
  const sourceLinkPages = isRecord(source.linkPages) ? source.linkPages : {};
  const legacyTasks = isRecord(legacy.localTasks) ? legacy.localTasks : {};
  const legacyLinkPages = isRecord(legacy.linkPages) ? legacy.linkPages : {};
  const clocks: Record<string, ClockRuntimeState> = {};
  const notes: Record<string, string> = {};
  const tasks: Record<string, LocalTask[]> = {};
  const linkPages: Record<string, number> = {};

  for (const block of settings.layout.blocks) {
    if (isClockBlock(block)) {
      const candidate = version === RUNTIME_SCHEMA_VERSION
        ? sourceClocks[block.id]
        : legacyClockValue(block, source, legacy);
      clocks[block.id] = normalizeClock(block, candidate);
    }
    if (block.type === "note") {
      const candidate = sourceNotes[block.id] ?? sourceNotes[block.type];
      if (typeof candidate === "string") notes[block.id] = candidate.slice(0, 200_000);
    }
    if (block.type === "localTasks") {
      const oldSharedTasks = Array.isArray(source.localTasks) && firstBlockOfType(settings, "localTasks")?.id === block.id
        ? source.localTasks
        : undefined;
      tasks[block.id] = normalizeTaskList(sourceTasks[block.id] ?? legacyTasks[block.id] ?? oldSharedTasks);
    }
    if (block.type === "links" || block.type === "startPinned") {
      const candidate = sourceLinkPages[block.id]
        ?? legacyLinkPages[block.id]
        ?? (firstBlockOfType(settings, block.type)?.id === block.id ? sourceLinkPages[block.type] : undefined)
        ?? (block.type === "links" && firstBlockOfType(settings, "links")?.id === block.id ? sourceLinkPages.links : undefined);
      linkPages[block.id] = finiteInteger(candidate, 0, 0, 10_000);
    }
  }

  return {
    version: RUNTIME_SCHEMA_VERSION,
    updatedAt: finiteInteger(source.updatedAt, 0, 0, Number.MAX_SAFE_INTEGER),
    clocks,
    notes,
    tasks,
    linkPages,
  };
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function getStartPageRuntimeState(settings = await getStartPageSettings()): Promise<StartPageRuntimeState> {
  const items = await chrome.storage.local.get([START_PAGE_RUNTIME_KEY, LEGACY_INSTANCE_RUNTIME_KEY]);
  const normalized = normalizeRuntimeState(items[START_PAGE_RUNTIME_KEY], settings, items[LEGACY_INSTANCE_RUNTIME_KEY]);
  if (!jsonEqual(items[START_PAGE_RUNTIME_KEY], normalized)) {
    const migrated = { ...normalized, updatedAt: Date.now() };
    await chrome.storage.local.set({ [START_PAGE_RUNTIME_KEY]: migrated });
    if (items[LEGACY_INSTANCE_RUNTIME_KEY] !== undefined) await chrome.storage.local.remove(LEGACY_INSTANCE_RUNTIME_KEY);
    return migrated;
  }
  return normalized;
}

export async function setStartPageRuntimeState(state: StartPageRuntimeState): Promise<void> {
  await chrome.storage.local.set({
    [START_PAGE_RUNTIME_KEY]: {
      ...state,
      version: RUNTIME_SCHEMA_VERSION,
      updatedAt: Date.now(),
    },
  });
}

export async function updateStartPageRuntimeState(
  updater: (state: StartPageRuntimeState) => StartPageRuntimeState,
  settings = await getStartPageSettings(),
): Promise<StartPageRuntimeState> {
  const current = await getStartPageRuntimeState(settings);
  const next = normalizeRuntimeState(updater(structuredClone(current)), settings);
  const stamped = { ...next, updatedAt: Date.now() };
  await chrome.storage.local.set({ [START_PAGE_RUNTIME_KEY]: stamped });
  return stamped;
}

function clockToken(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function elapsedClockMs(clock: ClockRuntimeState, now = Date.now()): number {
  if (!clock.running || clock.startedAt === null) return clock.accumulatedMs;
  const delta = Math.max(0, now - clock.startedAt);
  if (clock.type === "stopwatch") return Math.min(MAX_CLOCK_MS, clock.accumulatedMs + delta);
  return Math.min(clock.durationMs, clock.accumulatedMs + delta);
}

export function remainingClockMs(clock: ClockRuntimeState, now = Date.now()): number {
  if (clock.type === "stopwatch") return 0;
  if (clock.running && clock.targetAt !== null) return Math.max(0, clock.targetAt - now);
  return Math.max(0, clock.durationMs - clock.accumulatedMs);
}

export function startClockState(clock: ClockRuntimeState, now = Date.now()): ClockRuntimeState {
  if (clock.running) return clock;
  const accumulatedMs = clock.type === "stopwatch"
    ? Math.min(clock.accumulatedMs, MAX_CLOCK_MS)
    : clock.accumulatedMs >= clock.durationMs ? 0 : clock.accumulatedMs;
  const remaining = clock.type === "stopwatch" ? null : Math.max(1, clock.durationMs - accumulatedMs);
  return {
    ...clock,
    running: true,
    startedAt: now,
    accumulatedMs,
    targetAt: remaining === null ? null : now + remaining,
    completionToken: clock.type === "stopwatch" ? null : clockToken(),
    focusSessionStartedAt: clock.type === "pomodoro" && clock.phase === "work" && clock.focusSessionStartedAt === null
      ? now
      : clock.focusSessionStartedAt,
  };
}

export function pauseClockState(clock: ClockRuntimeState, now = Date.now()): ClockRuntimeState {
  if (!clock.running) return clock;
  return {
    ...clock,
    running: false,
    startedAt: null,
    accumulatedMs: elapsedClockMs(clock, now),
    targetAt: null,
    completionToken: null,
  };
}

export function resetClockState(
  block: Extract<BlockInstance, { type: ClockBlockType }>,
  phase: PomodoroPhase = "work",
): ClockRuntimeState {
  const fallback = defaultClockForBlock(block);
  if (block.type !== "pomodoro") return fallback;
  return {
    ...fallback,
    phase,
    durationMs: (phase === "break" ? block.config.breakSeconds : block.config.workSeconds) * 1000,
  };
}

export function clockAlarmName(instanceId: string, token: string): string {
  return `${CLOCK_ALARM_PREFIX}${encodeURIComponent(instanceId)}:${encodeURIComponent(token)}`;
}

export function parseClockAlarmName(name: string): { instanceId: string; token: string } | null {
  if (!name.startsWith(CLOCK_ALARM_PREFIX)) return null;
  const parts = name.slice(CLOCK_ALARM_PREFIX.length).split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    return { instanceId: decodeURIComponent(parts[0]), token: decodeURIComponent(parts[1]) };
  } catch {
    return null;
  }
}

export async function clearClockAlarm(instanceId: string): Promise<void> {
  const alarms = await chrome.alarms.getAll();
  await Promise.all(alarms
    .filter((alarm) => parseClockAlarmName(alarm.name)?.instanceId === instanceId)
    .map((alarm) => chrome.alarms.clear(alarm.name)));
}

export async function scheduleClockAlarm(instanceId: string, clock: ClockRuntimeState): Promise<void> {
  await clearClockAlarm(instanceId);
  if (!clock.running || clock.targetAt === null || !clock.completionToken) return;
  chrome.alarms.create(clockAlarmName(instanceId, clock.completionToken), { when: Math.max(Date.now() + 100, clock.targetAt) });
}

export interface ClockCompletionResult {
  completed: boolean;
  block: Extract<BlockInstance, { type: ClockBlockType }> | null;
  clock: ClockRuntimeState | null;
  notify: boolean;
  focusTimeMs: number;
}

export async function completeClockInstance(
  instanceId: string,
  expectedToken: string | null,
  now = Date.now(),
): Promise<ClockCompletionResult> {
  const settings = await getStartPageSettings();
  const block = settings.layout.blocks.find((candidate): candidate is Extract<BlockInstance, { type: ClockBlockType }> => candidate.id === instanceId && isClockBlock(candidate)) ?? null;
  if (!block) return { completed: false, block: null, clock: null, notify: false, focusTimeMs: 0 };
  const runtime = await getStartPageRuntimeState(settings);
  const current = runtime.clocks[instanceId] ?? defaultClockForBlock(block);
  const token = current.completionToken;
  if (!current.running || current.type === "stopwatch" || current.targetAt === null || current.targetAt > now + 1000) {
    return { completed: false, block, clock: current, notify: false, focusTimeMs: 0 };
  }
  if (expectedToken && token !== expectedToken) return { completed: false, block, clock: current, notify: false, focusTimeMs: 0 };
  if (token && current.lastCompletedToken === token) return { completed: false, block, clock: current, notify: false, focusTimeMs: 0 };

  let next: ClockRuntimeState;
  let focusTimeMs = 0;
  if (block.type === "timer") {
    next = {
      ...current,
      running: false,
      startedAt: null,
      accumulatedMs: current.durationMs,
      targetAt: null,
      lastCompletedToken: token,
      completionToken: null,
    };
  } else {
    const completedPhase = current.phase ?? "work";
    if (completedPhase === "work" && current.focusSessionStartedAt !== null) {
      focusTimeMs = Math.max(0, now - current.focusSessionStartedAt);
    }
    const nextPhase: PomodoroPhase = completedPhase === "work" ? "break" : "work";
    const nextDuration = (nextPhase === "work" ? block.config.workSeconds : block.config.breakSeconds) * 1000;
    const autoStart = block.config.autoStartNextPhase;
    next = {
      ...current,
      running: autoStart,
      startedAt: autoStart ? now : null,
      accumulatedMs: 0,
      durationMs: nextDuration,
      targetAt: autoStart ? now + nextDuration : null,
      phase: nextPhase,
      focusSessionStartedAt: autoStart && nextPhase === "work" ? now : null,
      lastCompletedToken: token,
      completionToken: autoStart ? clockToken() : null,
    };
  }
  runtime.clocks[instanceId] = next;
  await setStartPageRuntimeState(runtime);
  await scheduleClockAlarm(instanceId, next);
  const notify = block.type === "timer" ? block.config.notifyOnComplete : block.type === "pomodoro" ? block.config.notifyOnComplete : false;
  return { completed: true, block, clock: next, notify, focusTimeMs };
}

export async function deleteInstanceRuntime(instanceId: string): Promise<void> {
  const settings = await getStartPageSettings();
  const runtime = await getStartPageRuntimeState(settings);
  delete runtime.clocks[instanceId];
  delete runtime.notes[instanceId];
  delete runtime.tasks[instanceId];
  delete runtime.linkPages[instanceId];
  await setStartPageRuntimeState(runtime);
  await clearClockAlarm(instanceId);
}

export function instanceRuntimeHasUserData(instanceId: string, runtime: StartPageRuntimeState): boolean {
  return Boolean(runtime.notes[instanceId]?.trim()) || (runtime.tasks[instanceId]?.length ?? 0) > 0;
}
