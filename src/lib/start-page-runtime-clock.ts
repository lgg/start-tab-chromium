import { markStartTabDataChanged } from "./data-revision.js";
import { sendMessage } from "./messages.js";
import { withStorageLock } from "./storage-lock.js";
import {
  type BlockInstance,
  type ClockBlockType,
  type ClockRuntimeState,
  type PomodoroPhase,
  type StartPageRuntimeState,
} from "./start-page-types.js";
import {
  CLOCK_ALARM_PREFIX,
  LEGACY_INSTANCE_RUNTIME_KEY,
  MAX_CLOCK_MS,
  START_PAGE_RUNTIME_KEY,
  defaultClockForBlock,
  isClockBlock,
  updateStartPageRuntimeState,
} from "./start-page-runtime.js";

export async function resetStartPageRuntimeState(): Promise<void> {
  await withStorageLock("data-write", async () => {
    await chrome.storage.local.remove([START_PAGE_RUNTIME_KEY, LEGACY_INSTANCE_RUNTIME_KEY]);
    const alarms = await chrome.alarms.getAll();
    await Promise.all(alarms
      .filter((alarm) => alarm.name.startsWith(CLOCK_ALARM_PREFIX))
      .map((alarm) => chrome.alarms.clear(alarm.name)));
    await markStartTabDataChanged();
  });
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

/** Make durable browser alarms exactly match a normalized runtime snapshot. */
export async function reconcileClockAlarmsForRuntime(runtime: StartPageRuntimeState): Promise<void> {
  const desired = new Map<string, number>();
  for (const [instanceId, clock] of Object.entries(runtime.clocks)) {
    if (!clock.running || clock.type === "stopwatch" || clock.targetAt === null || !clock.completionToken) continue;
    desired.set(clockAlarmName(instanceId, clock.completionToken), Math.max(Date.now() + 100, clock.targetAt));
  }

  const existing = await chrome.alarms.getAll();
  await Promise.all(existing
    .filter((alarm) => alarm.name.startsWith(CLOCK_ALARM_PREFIX) && !desired.has(alarm.name))
    .map((alarm) => chrome.alarms.clear(alarm.name)));
  for (const [name, when] of desired) chrome.alarms.create(name, { when });
}

export interface ClockCompletionResult {
  completed: boolean;
  block: Extract<BlockInstance, { type: ClockBlockType }> | null;
  clock: ClockRuntimeState | null;
  notify: boolean;
  focusTimeMs: number;
}

export async function completeClockInstance(instanceId: string, expectedToken: string | null, now = Date.now()): Promise<ClockCompletionResult> {
  let result: ClockCompletionResult = { completed: false, block: null, clock: null, notify: false, focusTimeMs: 0 };

  await updateStartPageRuntimeState((runtime, settings) => {
    const block = settings.layout.blocks.find(
      (candidate): candidate is Extract<BlockInstance, { type: ClockBlockType }> => candidate.id === instanceId && isClockBlock(candidate),
    ) ?? null;
    if (!block) return runtime;
    const current = runtime.clocks[instanceId] ?? defaultClockForBlock(block);
    const token = current.completionToken;
    result = { completed: false, block, clock: current, notify: false, focusTimeMs: 0 };
    if (!current.running || current.type === "stopwatch" || current.targetAt === null || current.targetAt > now + 1000) return runtime;
    if (expectedToken && token !== expectedToken) return runtime;
    if (token && current.lastCompletedToken === token) return runtime;
    if (block.type !== "timer" && block.type !== "pomodoro") return runtime;

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
    result = { completed: true, block, clock: next, notify: block.config.notifyOnComplete, focusTimeMs };
    return runtime;
  }, undefined, async () => {
    if (result.completed && result.clock) await scheduleClockAlarm(instanceId, result.clock);
  });

  return result;
}

export async function deleteInstanceRuntime(instanceId: string, onlyIfMissing = false): Promise<void> {
  if (typeof document !== "undefined") {
    await sendMessage({ type: "delete-instance-runtime", instanceId, onlyIfMissing });
    return;
  }
  let cleanupAllowed = false;
  await updateStartPageRuntimeState((runtime, settings) => {
    if (onlyIfMissing && settings.layout.blocks.some((block) => block.id === instanceId)) return runtime;
    cleanupAllowed = true;
    delete runtime.clocks[instanceId];
    delete runtime.notes[instanceId];
    delete runtime.tasks[instanceId];
    delete runtime.linkPages[instanceId];
    return runtime;
  }, undefined, async () => {
    if (cleanupAllowed) await clearClockAlarm(instanceId);
  });
}

export function instanceRuntimeHasUserData(instanceId: string, runtime: StartPageRuntimeState): boolean {
  return Boolean(runtime.notes[instanceId]?.trim()) || (runtime.tasks[instanceId]?.length ?? 0) > 0;
}
