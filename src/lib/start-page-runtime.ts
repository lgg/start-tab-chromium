import { markStartTabDataChanged } from "./data-revision.js";
import { withStorageLock } from "./storage-lock.js";
import { sendMessage } from "./messages.js";
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
import {
  START_PAGE_MIGRATION_REPORT_KEY,
  START_PAGE_SETTINGS_KEY,
  createDefaultStartPageSettings,
  getStartPageSettings,
  isRecord,
  readStartPageSettingsSnapshot,
} from "./start-page-settings.js";

export type { StartPageRuntimeState } from "./start-page-types.js";

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
      return { type: "timer", running: false, startedAt: null, accumulatedMs: 0, durationMs: block.config.durationSeconds * 1000, targetAt: null, phase: null, focusSessionStartedAt: null, completionToken: null, lastCompletedToken: null };
    case "stopwatch":
      return { type: "stopwatch", running: false, startedAt: null, accumulatedMs: 0, durationMs: 0, targetAt: null, phase: null, focusSessionStartedAt: null, completionToken: null, lastCompletedToken: null };
    case "pomodoro":
      return { type: "pomodoro", running: false, startedAt: null, accumulatedMs: 0, durationMs: block.config.workSeconds * 1000, targetAt: null, phase: "work", focusSessionStartedAt: null, completionToken: null, lastCompletedToken: null };
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
  const startedAt = timestamp(value.startedAt);
  const storedAccumulated = value.accumulatedMs ?? value.elapsedMs;
  const running = value.running === true && startedAt !== null;
  const storedDuration = block.type === "stopwatch" ? 0 : finiteInteger(value.durationMs, configuredDuration, 1000, MAX_CLOCK_MS);
  const hasProgress = typeof storedAccumulated === "number" && Number.isFinite(storedAccumulated) && storedAccumulated > 0;
  const durationMs = block.type === "stopwatch" ? 0 : running || hasProgress ? storedDuration : configuredDuration;
  const accumulatedMs = finiteInteger(storedAccumulated, 0, 0, block.type === "stopwatch" ? MAX_CLOCK_MS : durationMs);
  const targetAt = block.type === "stopwatch" ? null : running ? timestamp(value.targetAt, startedAt + Math.max(0, durationMs - accumulatedMs)) : null;
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

function legacyClockValue(block: Extract<BlockInstance, { type: ClockBlockType }>, primary: Record<string, unknown>, secondary: Record<string, unknown>): unknown {
  const primaryClocks = isRecord(primary.clocks) ? primary.clocks : {};
  const secondaryClocks = isRecord(secondary.clocks) ? secondary.clocks : {};
  return primaryClocks[block.id] ?? secondaryClocks[block.id] ?? primaryClocks[block.type] ?? secondaryClocks[block.type];
}

export function isFutureRuntimeSchema(value: unknown): boolean {
  return isRecord(value)
    && typeof value.version === "number"
    && Number.isInteger(value.version)
    && value.version > RUNTIME_SCHEMA_VERSION;
}

export function normalizeRuntimeState(value: unknown, settings: StartPageSettings, legacyInstanceValue: unknown = undefined): StartPageRuntimeState {
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
      const candidate = version === RUNTIME_SCHEMA_VERSION ? sourceClocks[block.id] : legacyClockValue(block, source, legacy);
      clocks[block.id] = normalizeClock(block, candidate);
    }
    if (block.type === "note") {
      const candidate = sourceNotes[block.id] ?? sourceNotes[block.type];
      if (typeof candidate === "string") notes[block.id] = candidate.slice(0, 200_000);
    }
    if (block.type === "localTasks") {
      const oldSharedTasks = Array.isArray(source.localTasks) && firstBlockOfType(settings, "localTasks")?.id === block.id ? source.localTasks : undefined;
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

  return { version: RUNTIME_SCHEMA_VERSION, updatedAt: finiteInteger(source.updatedAt, 0, 0, Number.MAX_SAFE_INTEGER), clocks, notes, tasks, linkPages };
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function persistRuntimeInTransaction(
  state: StartPageRuntimeState,
  settings: StartPageSettings,
  allowFutureOverwrite = false,
  expectedUpdatedAt: number | null = null,
): Promise<StartPageRuntimeState> {
  const items = await chrome.storage.local.get(START_PAGE_RUNTIME_KEY);
  const raw = items[START_PAGE_RUNTIME_KEY];
  if (!allowFutureOverwrite && isFutureRuntimeSchema(raw)) {
    throw new Error("Start Tab runtime data was created by a newer extension version and cannot be modified safely");
  }
  const currentUpdatedAt = isFutureRuntimeSchema(raw) ? 0 : normalizeRuntimeState(raw, settings).updatedAt;
  if (!allowFutureOverwrite && expectedUpdatedAt !== null
    && currentUpdatedAt > 0 && currentUpdatedAt !== expectedUpdatedAt) {
    throw new Error("Start Tab runtime changed in another extension context; reload before saving");
  }
  const stamped: StartPageRuntimeState = {
    ...state,
    version: RUNTIME_SCHEMA_VERSION,
    updatedAt: Math.max(Date.now(), currentUpdatedAt + 1),
  };
  await chrome.storage.local.set({ [START_PAGE_RUNTIME_KEY]: stamped });
  await markStartTabDataChanged(stamped.updatedAt);
  return stamped;
}

export async function getStartPageRuntimeState(inputSettings?: StartPageSettings): Promise<StartPageRuntimeState> {
  const settings = inputSettings ?? await getStartPageSettings();
  const items = await chrome.storage.local.get([START_PAGE_RUNTIME_KEY, LEGACY_INSTANCE_RUNTIME_KEY]);
  const raw = items[START_PAGE_RUNTIME_KEY];
  const normalized = normalizeRuntimeState(raw, settings, items[LEGACY_INSTANCE_RUNTIME_KEY]);
  if (isFutureRuntimeSchema(raw) || jsonEqual(raw, normalized)) return normalized;

  return withStorageLock("data-write", async () => {
    const freshSettings = await readStartPageSettingsSnapshot();
    const freshItems = await chrome.storage.local.get([START_PAGE_RUNTIME_KEY, LEGACY_INSTANCE_RUNTIME_KEY]);
    const freshRaw = freshItems[START_PAGE_RUNTIME_KEY];
    const freshNormalized = normalizeRuntimeState(freshRaw, freshSettings, freshItems[LEGACY_INSTANCE_RUNTIME_KEY]);
    if (isFutureRuntimeSchema(freshRaw) || jsonEqual(freshRaw, freshNormalized)) return freshNormalized;
    const migrated = await persistRuntimeInTransaction(freshNormalized, freshSettings, true);
    if (freshItems[LEGACY_INSTANCE_RUNTIME_KEY] !== undefined) {
      await chrome.storage.local.remove(LEGACY_INSTANCE_RUNTIME_KEY);
    }
    return migrated;
  });
}

export async function setStartPageRuntimeState(state: StartPageRuntimeState): Promise<void> {
  await withStorageLock("data-write", async () => {
    const settings = await readStartPageSettingsSnapshot();
    await persistRuntimeInTransaction(normalizeRuntimeState(state, settings), settings, false, state.updatedAt);
  });
}

interface RuntimeMutation<T> {
  state: StartPageRuntimeState | null;
  result: T;
}

async function runRuntimeMutation<T>(
  mutator: (state: StartPageRuntimeState, settings: StartPageSettings) => RuntimeMutation<T>,
): Promise<{ result: T; state: StartPageRuntimeState }> {
  return withStorageLock("data-write", async () => {
    const settings = await readStartPageSettingsSnapshot();
    const items = await chrome.storage.local.get([START_PAGE_RUNTIME_KEY, LEGACY_INSTANCE_RUNTIME_KEY]);
    const raw = items[START_PAGE_RUNTIME_KEY];
    if (isFutureRuntimeSchema(raw)) {
      throw new Error("Start Tab runtime data was created by a newer extension version and cannot be modified safely");
    }
    const current = normalizeRuntimeState(raw, settings, items[LEGACY_INSTANCE_RUNTIME_KEY]);
    const mutation = mutator(structuredClone(current), settings);
    if (mutation.state === null) return { result: mutation.result, state: current };
    const next = normalizeRuntimeState(mutation.state, settings);
    const saved = await persistRuntimeInTransaction(next, settings, false, current.updatedAt);
    if (items[LEGACY_INSTANCE_RUNTIME_KEY] !== undefined) {
      await chrome.storage.local.remove(LEGACY_INSTANCE_RUNTIME_KEY);
    }
    return { result: mutation.result, state: saved };
  });
}

export async function mutateStartPageRuntimeState<T>(
  mutator: (state: StartPageRuntimeState, settings: StartPageSettings) => RuntimeMutation<T>,
): Promise<T> {
  return (await runRuntimeMutation(mutator)).result;
}

export async function updateStartPageRuntimeState(
  updater: (state: StartPageRuntimeState, settings: StartPageSettings) => StartPageRuntimeState,
  _inputSettings?: StartPageSettings,
): Promise<StartPageRuntimeState> {
  return (await runRuntimeMutation((state, settings) => ({ state: updater(state, settings), result: undefined }))).state;
}

async function clearClockAlarms(): Promise<void> {
  const alarms = await chrome.alarms.getAll();
  await Promise.all(alarms
    .filter((alarm) => alarm.name.startsWith(CLOCK_ALARM_PREFIX))
    .map((alarm) => chrome.alarms.clear(alarm.name)));
}

export async function resetStartPageRuntimeState(): Promise<void> {
  await withStorageLock("data-write", async () => {
    await chrome.storage.local.remove([START_PAGE_RUNTIME_KEY, LEGACY_INSTANCE_RUNTIME_KEY]);
    await markStartTabDataChanged();
  });
  await clearClockAlarms();
}

export async function resetStartPageData(): Promise<StartPageSettings> {
  const settings = createDefaultStartPageSettings();
  await withStorageLock("data-write", async () => {
    await chrome.storage.local.set({ [START_PAGE_SETTINGS_KEY]: settings });
    await chrome.storage.local.remove([
      START_PAGE_MIGRATION_REPORT_KEY,
      START_PAGE_RUNTIME_KEY,
      LEGACY_INSTANCE_RUNTIME_KEY,
    ]);
    await markStartTabDataChanged(settings.updatedAt);
  });
  await clearClockAlarms();
  return settings;
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
  const accumulatedMs = clock.type === "stopwatch" ? Math.min(clock.accumulatedMs, MAX_CLOCK_MS) : clock.accumulatedMs >= clock.durationMs ? 0 : clock.accumulatedMs;
  const remaining = clock.type === "stopwatch" ? null : Math.max(1, clock.durationMs - accumulatedMs);
  return {
    ...clock,
    running: true,
    startedAt: now,
    accumulatedMs,
    targetAt: remaining === null ? null : now + remaining,
    completionToken: clock.type === "stopwatch" ? null : clockToken(),
    focusSessionStartedAt: clock.type === "pomodoro" && clock.phase === "work" && clock.focusSessionStartedAt === null ? now : clock.focusSessionStartedAt,
  };
}

export function pauseClockState(clock: ClockRuntimeState, now = Date.now()): ClockRuntimeState {
  if (!clock.running) return clock;
  return { ...clock, running: false, startedAt: null, accumulatedMs: elapsedClockMs(clock, now), targetAt: null, completionToken: null };
}

export function resetClockState(block: Extract<BlockInstance, { type: ClockBlockType }>, phase: PomodoroPhase = "work"): ClockRuntimeState {
  const fallback = defaultClockForBlock(block);
  if (block.type !== "pomodoro") return fallback;
  return { ...fallback, phase, durationMs: (phase === "break" ? block.config.breakSeconds : block.config.workSeconds) * 1000 };
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
  await Promise.all(alarms.filter((alarm) => parseClockAlarmName(alarm.name)?.instanceId === instanceId).map((alarm) => chrome.alarms.clear(alarm.name)));
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

export async function completeClockInstance(instanceId: string, expectedToken: string | null, now = Date.now()): Promise<ClockCompletionResult> {
  return mutateStartPageRuntimeState<ClockCompletionResult>((runtime, settings) => {
    const block = settings.layout.blocks.find(
      (candidate): candidate is Extract<BlockInstance, { type: ClockBlockType }> => candidate.id === instanceId && isClockBlock(candidate),
    ) ?? null;
    if (!block) {
      return { state: null, result: { completed: false, block: null, clock: null, notify: false, focusTimeMs: 0 } };
    }
    const current = runtime.clocks[instanceId] ?? defaultClockForBlock(block);
    const token = current.completionToken;
    if (!current.running || current.type === "stopwatch" || current.targetAt === null || current.targetAt > now + 1000) {
      return { state: null, result: { completed: false, block, clock: current, notify: false, focusTimeMs: 0 } };
    }
    if (expectedToken && token !== expectedToken) {
      return { state: null, result: { completed: false, block, clock: current, notify: false, focusTimeMs: 0 } };
    }
    if (token && current.lastCompletedToken === token) {
      return { state: null, result: { completed: false, block, clock: current, notify: false, focusTimeMs: 0 } };
    }

    let next: ClockRuntimeState;
    let focusTimeMs = 0;
    if (block.type === "timer") {
      next = { ...current, running: false, startedAt: null, accumulatedMs: current.durationMs, targetAt: null, lastCompletedToken: token, completionToken: null };
    } else if (block.type === "pomodoro") {
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
    } else {
      return { state: null, result: { completed: false, block, clock: current, notify: false, focusTimeMs: 0 } };
    }

    runtime.clocks[instanceId] = next;
    return {
      state: runtime,
      result: { completed: true, block, clock: next, notify: block.config.notifyOnComplete, focusTimeMs },
    };
  });
}

export async function deleteInstanceRuntime(instanceId: string): Promise<void> {
  if (typeof document !== "undefined") {
    await sendMessage({ type: "delete-instance-runtime", instanceId });
    return;
  }
  await mutateStartPageRuntimeState((runtime) => {
    const existed = Object.prototype.hasOwnProperty.call(runtime.clocks, instanceId)
      || Object.prototype.hasOwnProperty.call(runtime.notes, instanceId)
      || Object.prototype.hasOwnProperty.call(runtime.tasks, instanceId)
      || Object.prototype.hasOwnProperty.call(runtime.linkPages, instanceId);
    if (!existed) return { state: null, result: undefined };
    delete runtime.clocks[instanceId];
    delete runtime.notes[instanceId];
    delete runtime.tasks[instanceId];
    delete runtime.linkPages[instanceId];
    return { state: runtime, result: undefined };
  });
  await clearClockAlarm(instanceId);
}

export function instanceRuntimeHasUserData(instanceId: string, runtime: StartPageRuntimeState): boolean {
  return Boolean(runtime.notes[instanceId]?.trim()) || (runtime.tasks[instanceId]?.length ?? 0) > 0;
}
