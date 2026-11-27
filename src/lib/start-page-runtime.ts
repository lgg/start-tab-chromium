import { commitStorageMutationWithRevision, DATA_REVISION_KEY, markStartTabDataChanged } from "./data-revision.js";
import { cloneDictionary, createDictionary, ownValue } from "./dictionary.js";
import { runIndependentEffects } from "./independent-effects.js";
import { jsonContentEqual } from "./json-content.js";
import { isStartPageOnboardingComplete, START_PAGE_ONBOARDING_KEY } from "../newtab/onboarding-state.js";
import { assertLocalePreference, localePreferenceFromStored, LOCALE_OVERRIDE_KEY, writeLocalePreferenceInExistingTransaction, type LocaleChange, type LocalePreference } from "./i18n.js";
import { withStorageLock } from "./storage-lock.js";
import { uniqueEntityId } from "./start-page-validation-primitives.js";
import { MAX_LOCAL_TASKS_PER_INSTANCE, MAX_NOTE_LENGTH } from "./platform-limits.js";
import { sendMessage } from "./messages.js";
import {
  FOCUS_STATS_KEY,
  applyFocusClockStatsPatchInExistingTransaction,
} from "./focus-stats.js";
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
  isFutureStartPageSchema,
  isRecord,
  normalizeStartPageSettings,
  prepareStartPageSettingsWrite,
} from "./start-page-settings.js";

export type { StartPageRuntimeState } from "./start-page-types.js";

export const START_PAGE_RUNTIME_KEY = "startPageRuntimeState";
export const LEGACY_INSTANCE_RUNTIME_KEY = "startTabInstanceState";
export const CLOCK_ALARM_PREFIX = "start-tab-clock:";

const ONBOARDING_KEY = START_PAGE_ONBOARDING_KEY;
const RUNTIME_STORAGE_KEYS = [
  START_PAGE_RUNTIME_KEY,
  LEGACY_INSTANCE_RUNTIME_KEY,
  DATA_REVISION_KEY,
] as const;

const RESET_STORAGE_KEYS = [
  START_PAGE_SETTINGS_KEY,
  START_PAGE_RUNTIME_KEY,
  LEGACY_INSTANCE_RUNTIME_KEY,
  START_PAGE_MIGRATION_REPORT_KEY,
  ONBOARDING_KEY,
  DATA_REVISION_KEY,
] as const;

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

function legacyClockToken(block: Extract<BlockInstance, { type: ClockBlockType }>, startedAt: number, targetAt: number, durationMs: number): string {
  return `legacy-${block.type}-${startedAt.toString(36)}-${targetAt.toString(36)}-${durationMs.toString(36)}`;
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
  const storedCompletionToken = typeof value.completionToken === "string" && value.completionToken ? value.completionToken : null;
  const completionToken = block.type === "stopwatch" || !running || targetAt === null
    ? null
    : storedCompletionToken ?? legacyClockToken(block, startedAt, targetAt, durationMs);
  return {
    type: block.type,
    running,
    startedAt: running ? startedAt : null,
    accumulatedMs,
    durationMs,
    targetAt,
    phase,
    focusSessionStartedAt: block.type === "pomodoro" ? timestamp(value.focusSessionStartedAt) : null,
    completionToken,
    lastCompletedToken: typeof value.lastCompletedToken === "string" && value.lastCompletedToken ? value.lastCompletedToken : null,
  };
}

function stableTaskHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    // A for-of iteration over a string always yields a nonempty code point.
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeTask(value: unknown, index: number): LocalTask | null {
  if (!isRecord(value)) return null;
  const title = stringValue(value.title, "").trim().slice(0, 500);
  if (!title) return null;
  const requestedId = typeof value.id === "string" ? value.id.trim().slice(0, 160) : "";
  return {
    id: requestedId || `task-${index + 1}-${stableTaskHash(title)}`,
    title,
    done: value.done === true,
    createdAt: finiteInteger(value.createdAt, 0, 0, Number.MAX_SAFE_INTEGER),
    updatedAt: finiteInteger(value.updatedAt, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

function normalizeTaskList(value: unknown): LocalTask[] {
  if (!Array.isArray(value)) return [];
  const candidates = value.slice(0, MAX_LOCAL_TASKS_PER_INSTANCE).flatMap((item, index) => {
    const task = normalizeTask(item, index);
    if (!task) return [];
    const explicit = isRecord(item) && typeof item.id === "string" && item.id.trim().length > 0;
    return [{ task, explicit }];
  });
  const seen = new Set<string>();
  const reserved = new Set(candidates.map(({ task }) => task.id));
  const explicitIds = new Set(candidates.filter(({ explicit }) => explicit).map(({ task }) => task.id));
  return candidates.map(({ task, explicit }) => {
    // A generated ID must not take an explicitly supplied later task ID.
    const occupied = !explicit && explicitIds.has(task.id)
      ? new Set([...seen, task.id]) : seen;
    const id = uniqueEntityId(task.id, occupied, reserved);
    seen.add(id);
    return { ...task, id };
  });
}

function firstBlockOfType(settings: StartPageSettings, type: BlockInstance["type"]): BlockInstance | null {
  return settings.layout.blocks.find((block) => block.type === type) ?? null;
}

/** A type-keyed legacy value belongs to one instance only. Prefer an
 * existing block whose actual ID is the legacy key, even if it occurs later. */
function ownsLegacyTypeValue(settings: StartPageSettings, block: BlockInstance): boolean {
  const owner = settings.layout.blocks.find((candidate) => candidate.type === block.type && candidate.id === block.type)
    ?? firstBlockOfType(settings, block.type);
  return owner?.id === block.id;
}

function legacyClockValue(block: Extract<BlockInstance, { type: ClockBlockType }>, settings: StartPageSettings, primary: Record<string, unknown>, secondary: Record<string, unknown>): unknown {
  const primaryClocks = isRecord(primary.clocks) ? primary.clocks : {};
  const secondaryClocks = isRecord(secondary.clocks) ? secondary.clocks : {};
  return ownValue(primaryClocks, block.id)
    ?? ownValue(secondaryClocks, block.id)
    ?? (ownsLegacyTypeValue(settings, block) ? ownValue(primaryClocks, block.type) ?? ownValue(secondaryClocks, block.type) : undefined);
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
  const clocks = createDictionary<ClockRuntimeState>();
  const notes = createDictionary<string>();
  const tasks = createDictionary<LocalTask[]>();
  const linkPages = createDictionary<number>();

  for (const block of settings.layout.blocks) {
    if (isClockBlock(block)) {
      const candidate = version === RUNTIME_SCHEMA_VERSION ? ownValue(sourceClocks, block.id) : legacyClockValue(block, settings, source, legacy);
      clocks[block.id] = normalizeClock(block, candidate);
    }
    if (block.type === "note") {
      const candidate = ownValue(sourceNotes, block.id)
        ?? (version !== RUNTIME_SCHEMA_VERSION && ownsLegacyTypeValue(settings, block) ? ownValue(sourceNotes, block.type) : undefined);
      if (typeof candidate === "string") notes[block.id] = candidate.slice(0, MAX_NOTE_LENGTH);
    }
    if (block.type === "localTasks") {
      const oldSharedTasks = Array.isArray(source.localTasks) && firstBlockOfType(settings, "localTasks")?.id === block.id ? source.localTasks : undefined;
      tasks[block.id] = normalizeTaskList(ownValue(sourceTasks, block.id) ?? ownValue(legacyTasks, block.id) ?? oldSharedTasks);
    }
    if (block.type === "links" || block.type === "startPinned") {
      const candidate = ownValue(sourceLinkPages, block.id)
        ?? ownValue(legacyLinkPages, block.id)
        ?? (version !== RUNTIME_SCHEMA_VERSION && ownsLegacyTypeValue(settings, block) ? ownValue(sourceLinkPages, block.type) : undefined);
      linkPages[block.id] = finiteInteger(candidate, 0, 0, 10_000);
    }
  }

  return { version: RUNTIME_SCHEMA_VERSION, updatedAt: finiteInteger(source.updatedAt, 0, 0, Number.MAX_SAFE_INTEGER), clocks, notes, tasks, linkPages };
}

async function readRuntimeSettingsSnapshot(requireCompatible: boolean): Promise<{ settings: StartPageSettings; future: boolean }> {
  const items = await chrome.storage.local.get(START_PAGE_SETTINGS_KEY);
  const raw = items[START_PAGE_SETTINGS_KEY];
  const future = isFutureStartPageSchema(raw);
  if (requireCompatible && future) {
    throw new Error("Start Tab settings were created by a newer extension version and runtime data cannot be modified safely");
  }
  return { settings: normalizeStartPageSettings(raw), future };
}

/** Only use valid numeric timestamps as revision floors, including during an
 * explicit reset of a future schema. The revision allocator rejects overflow. */
function rawRevisionFloor(value: unknown): number {
  return isRecord(value) && typeof value.updatedAt === "number" && Number.isSafeInteger(value.updatedAt)
    ? Math.max(0, value.updatedAt) : 0;
}

function nextRuntimeRevision(floor: number, now = Date.now()): number {
  const revision = Math.max(now, floor + 1);
  if (!Number.isSafeInteger(revision) || revision >= Number.MAX_SAFE_INTEGER || revision <= floor) {
    throw new Error("Start Tab runtime revision exceeds the safe integer range");
  }
  return revision;
}

async function persistRuntimeInTransaction(
  state: StartPageRuntimeState,
  settings: StartPageSettings,
  expectedUpdatedAt: number | null = null,
  removeLegacy = false,
): Promise<StartPageRuntimeState> {
  const items = await chrome.storage.local.get([START_PAGE_RUNTIME_KEY, DATA_REVISION_KEY]);
  const raw = items[START_PAGE_RUNTIME_KEY];
  if (isFutureRuntimeSchema(raw)) {
    throw new Error("Start Tab runtime data was created by a newer extension version and cannot be modified safely");
  }
  const currentUpdatedAt = normalizeRuntimeState(raw, settings).updatedAt;
  if (expectedUpdatedAt !== null
    && currentUpdatedAt !== expectedUpdatedAt) {
    throw new Error("Start Tab runtime changed in another extension context; reload before saving");
  }
  // A missing runtime is normal after a reset. Recreating it must not
  // resurrect an old CAS token even when the system clock moved backward.
  const floor = currentUpdatedAt === 0
    ? Math.max(settings.updatedAt, rawRevisionFloor(items[DATA_REVISION_KEY]))
    : currentUpdatedAt;
  const stamped: StartPageRuntimeState = {
    ...state,
    version: RUNTIME_SCHEMA_VERSION,
    updatedAt: nextRuntimeRevision(floor),
  };
  await commitStorageMutationWithRevision(
    removeLegacy ? [START_PAGE_RUNTIME_KEY, LEGACY_INSTANCE_RUNTIME_KEY] : [START_PAGE_RUNTIME_KEY],
    async () => {
      await chrome.storage.local.set({ [START_PAGE_RUNTIME_KEY]: stamped });
      if (removeLegacy) await chrome.storage.local.remove(LEGACY_INSTANCE_RUNTIME_KEY);
    },
    stamped.updatedAt,
  );
  return stamped;
}

/** Read a coherent committed page snapshot. Storage change events are only
 * hints: a multi-step mutation can publish intermediate values and roll back. */
export async function getStartPageViewSnapshot(): Promise<{ settings: StartPageSettings; runtime: StartPageRuntimeState; localePreference: LocalePreference }> {
  // Perform any settings migration before taking the non-reentrant lock.
  await getStartPageSettings();
  return withStorageLock("data-write", async () => {
    const stored = await chrome.storage.local.get([START_PAGE_SETTINGS_KEY, START_PAGE_RUNTIME_KEY, LEGACY_INSTANCE_RUNTIME_KEY, LOCALE_OVERRIDE_KEY]);
    const rawSettings = stored[START_PAGE_SETTINGS_KEY];
    const rawRuntime = stored[START_PAGE_RUNTIME_KEY];
    const settings = normalizeStartPageSettings(rawSettings);
    const normalized = normalizeRuntimeState(rawRuntime, settings, stored[LEGACY_INSTANCE_RUNTIME_KEY]);
    const runtime = isFutureStartPageSchema(rawSettings) || isFutureRuntimeSchema(rawRuntime)
      || jsonContentEqual(rawRuntime, normalized)
      ? normalized
      : await persistRuntimeInTransaction(normalized, settings, null, stored[LEGACY_INSTANCE_RUNTIME_KEY] !== undefined);
    return { settings, runtime, localePreference: localePreferenceFromStored(stored[LOCALE_OVERRIDE_KEY]) };
  });
}

export async function getStartPageRuntimeState(inputSettings?: StartPageSettings): Promise<StartPageRuntimeState> {
  return withStorageLock("data-write", async () => {
    // Even already-normalized storage can be a provisional transaction
    // write. Read settings and runtime together only after it has settled.
    const items = await chrome.storage.local.get([START_PAGE_SETTINGS_KEY, START_PAGE_RUNTIME_KEY, LEGACY_INSTANCE_RUNTIME_KEY]);
    const rawSettings = items[START_PAGE_SETTINGS_KEY];
    const raw = items[START_PAGE_RUNTIME_KEY];
    const settings = normalizeStartPageSettings(rawSettings);
    const normalized = normalizeRuntimeState(raw, settings, items[LEGACY_INSTANCE_RUNTIME_KEY]);
    const canonical = isFutureStartPageSchema(rawSettings) || isFutureRuntimeSchema(raw) || jsonContentEqual(raw, normalized)
      ? normalized
      : await persistRuntimeInTransaction(normalized, settings, null, items[LEGACY_INSTANCE_RUNTIME_KEY] !== undefined);
    // An editor layout is a projection, not authority to prune stored data.
    return inputSettings ? normalizeRuntimeState(canonical, inputSettings) : canonical;
  });
}

export async function setStartPageRuntimeState(state: StartPageRuntimeState): Promise<void> {
  await withStorageLock("data-write", async () => {
    const { settings } = await readRuntimeSettingsSnapshot(true);
    await persistRuntimeInTransaction(normalizeRuntimeState(state, settings), settings, state.updatedAt);
  });
}

interface RuntimeMutation<T> {
  state: StartPageRuntimeState | null;
  result: T;
}

function cloneRuntimeStateForMutation(state: StartPageRuntimeState): StartPageRuntimeState {
  return {
    ...state,
    clocks: cloneDictionary(state.clocks),
    notes: cloneDictionary(state.notes),
    tasks: cloneDictionary(state.tasks),
    linkPages: cloneDictionary(state.linkPages),
  };
}

interface RuntimeStorageEffect<T> {
  keys: readonly string[];
  apply: (result: T) => Promise<void>;
}

function uniqueStorageKeys(...groups: readonly (readonly string[])[]): string[] {
  return [...new Set(groups.flatMap((group) => [...group]))];
}

async function runRuntimeMutation<T>(
  mutator: (state: StartPageRuntimeState, settings: StartPageSettings) => RuntimeMutation<T>,
  reconcileAlarms = false,
  storageEffect: RuntimeStorageEffect<T> | null = null,
): Promise<{ result: T; state: StartPageRuntimeState }> {
  return withStorageLock("data-write", async () => {
    const { settings } = await readRuntimeSettingsSnapshot(true);
    const items = await chrome.storage.local.get([START_PAGE_RUNTIME_KEY, LEGACY_INSTANCE_RUNTIME_KEY]);
    const raw = items[START_PAGE_RUNTIME_KEY];
    if (isFutureRuntimeSchema(raw)) {
      throw new Error("Start Tab runtime data was created by a newer extension version and cannot be modified safely");
    }
    const current = normalizeRuntimeState(raw, settings, items[LEGACY_INSTANCE_RUNTIME_KEY]);
    const mutation = mutator(cloneRuntimeStateForMutation(current), settings);
    if (mutation.state === null) return { result: mutation.result, state: current };
    const next = normalizeRuntimeState(mutation.state, settings);
    const rollbackKeys = uniqueStorageKeys(
      RUNTIME_STORAGE_KEYS,
      storageEffect?.keys ?? [],
    );
    const needsRollbackSnapshot = reconcileAlarms || storageEffect !== null;
    const previousStorage = needsRollbackSnapshot
      ? await chrome.storage.local.get(rollbackKeys)
      : null;
    const previousAlarms = reconcileAlarms ? await readClockAlarmSnapshot() : null;
    const saved = await persistRuntimeInTransaction(
      next,
      settings,
      current.updatedAt,
      items[LEGACY_INSTANCE_RUNTIME_KEY] !== undefined,
    );
    if (needsRollbackSnapshot && previousStorage) {
      try {
        if (storageEffect) await storageEffect.apply(mutation.result);
        if (reconcileAlarms) await reconcileClockAlarmsForRuntime(saved);
      } catch (error) {
        try {
          const rollbackEffects: Array<() => Promise<void>> = [
            () => restoreStorageKeysSnapshot(previousStorage, rollbackKeys),
          ];
          if (previousAlarms) rollbackEffects.push(() => restoreClockAlarmSnapshot(previousAlarms));
          await runIndependentEffects(rollbackEffects, "Clock runtime storage/alarm rollback was incomplete");
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "Clock runtime mutation failed and its storage/alarm rollback was incomplete",
          );
        }
        throw error;
      }
    }
    return { result: mutation.result, state: saved };
  });
}

export async function mutateStartPageRuntimeState<T>(
  mutator: (state: StartPageRuntimeState, settings: StartPageSettings) => RuntimeMutation<T>,
): Promise<T> {
  return (await runRuntimeMutation(mutator)).result;
}

/** Commit a clock mutation and its complete durable-alarm set as one recoverable unit. */
export async function mutateStartPageRuntimeStateWithAlarms<T>(
  mutator: (state: StartPageRuntimeState, settings: StartPageSettings) => RuntimeMutation<T>,
): Promise<T> {
  return (await runRuntimeMutation(mutator, true)).result;
}

/**
 * Commit runtime, a related storage effect, the data revision, and the complete
 * durable alarm set as one rollback-safe transaction.
 */
export async function mutateStartPageRuntimeStateWithAlarmsAndStorageEffect<T>(
  mutator: (state: StartPageRuntimeState, settings: StartPageSettings) => RuntimeMutation<T>,
  storageKeys: readonly string[],
  storageEffect: (result: T) => Promise<void>,
): Promise<T> {
  return (await runRuntimeMutation(mutator, true, { keys: storageKeys, apply: storageEffect })).result;
}

export async function updateStartPageRuntimeState(
  updater: (state: StartPageRuntimeState, settings: StartPageSettings) => StartPageRuntimeState,
  _inputSettings?: StartPageSettings,
): Promise<StartPageRuntimeState> {
  return (await runRuntimeMutation((state, settings) => ({ state: updater(state, settings), result: undefined }))).state;
}

async function clearClockAlarms(): Promise<void> {
  const alarms = await chrome.alarms.getAll();
  await runIndependentEffects(
    alarms
      .filter((alarm) => alarm.name.startsWith(CLOCK_ALARM_PREFIX))
      .map((alarm) => async () => { await chrome.alarms.clear(alarm.name); }),
    "Clock alarm cleanup was incomplete",
  );
}

export interface ClockAlarmSnapshot {
  name: string;
  scheduledTime: number;
  periodInMinutes?: number;
}

export async function readClockAlarmSnapshot(): Promise<ClockAlarmSnapshot[]> {
  return (await chrome.alarms.getAll())
    .filter((alarm) => alarm.name.startsWith(CLOCK_ALARM_PREFIX))
    .map((alarm) => ({
      name: alarm.name,
      scheduledTime: alarm.scheduledTime,
      ...(typeof alarm.periodInMinutes === "number" ? { periodInMinutes: alarm.periodInMinutes } : {}),
    }));
}

export async function restoreClockAlarmSnapshot(snapshot: ClockAlarmSnapshot[]): Promise<void> {
  const errors: unknown[] = [];
  try {
    const existing = await chrome.alarms.getAll();
    try {
      await runIndependentEffects(
        existing
          .filter((alarm) => alarm.name.startsWith(CLOCK_ALARM_PREFIX))
          .map((alarm) => async () => { await chrome.alarms.clear(alarm.name); }),
        "Clock alarm snapshot cleanup was incomplete",
      );
    } catch (error) {
      errors.push(error);
    }
  } catch (error) {
    errors.push(error);
  }

  try {
    await runIndependentEffects(
      snapshot.map((alarm) => async () => {
        await chrome.alarms.create(alarm.name, {
          when: alarm.scheduledTime,
          ...(typeof alarm.periodInMinutes === "number" ? { periodInMinutes: alarm.periodInMinutes } : {}),
        });
      }),
      "Clock alarm snapshot recreation was incomplete",
    );
  } catch (error) {
    errors.push(error);
  }

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Clock alarm snapshot restoration was incomplete");
}

export async function reconcileClockAlarmsForRuntime(runtime: StartPageRuntimeState): Promise<void> {
  const previous = await readClockAlarmSnapshot();
  const desired = new Map<string, number>();
  for (const [instanceId, clock] of Object.entries(runtime.clocks)) {
    if (!clock.running || clock.type === "stopwatch" || clock.targetAt === null || !clock.completionToken) continue;
    desired.set(clockAlarmName(instanceId, clock.completionToken), Math.max(Date.now() + 100, clock.targetAt));
  }
  try {
    const existing = await chrome.alarms.getAll();
    await runIndependentEffects(
      existing
        .filter((alarm) => alarm.name.startsWith(CLOCK_ALARM_PREFIX) && !desired.has(alarm.name))
        .map((alarm) => async () => { await chrome.alarms.clear(alarm.name); }),
      "Clock alarm reconciliation cleanup was incomplete",
    );
    for (const [name, when] of desired) await chrome.alarms.create(name, { when });
  } catch (error) {
    try {
      await restoreClockAlarmSnapshot(previous);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Clock alarm reconciliation failed and the previous alarm set could not be restored",
      );
    }
    throw error;
  }
}

/** Reconcile durable alarms from one compatible storage snapshot under the data-write lock. */
export async function reconcileStoredClockAlarms(): Promise<void> {
  await withStorageLock("data-write", async () => {
    const items = await chrome.storage.local.get([
      START_PAGE_SETTINGS_KEY,
      START_PAGE_RUNTIME_KEY,
      LEGACY_INSTANCE_RUNTIME_KEY,
    ]);
    if (isFutureStartPageSchema(items[START_PAGE_SETTINGS_KEY])
      || isFutureRuntimeSchema(items[START_PAGE_RUNTIME_KEY])) return;
    const settings = normalizeStartPageSettings(items[START_PAGE_SETTINGS_KEY]);
    const runtime = normalizeRuntimeState(
      items[START_PAGE_RUNTIME_KEY],
      settings,
      items[LEGACY_INSTANCE_RUNTIME_KEY],
    );
    await reconcileClockAlarmsForRuntime(runtime);
  });
}

/**
 * Replace settings and normalize per-instance runtime/alarms as one recoverable
 * transaction. This is the only safe path for layout operations that can remove
 * or replace block IDs.
 */
export async function replaceStartPageSettingsWithRuntime(
  value: unknown,
  expectedSettingsUpdatedAt: number,
  expectedRuntimeUpdatedAt: number,
  localeChange?: LocaleChange,
  completeOnboarding = false,
): Promise<StartPageSettings> {
  return withStorageLock("data-write", async () => {
    const items = await chrome.storage.local.get([
      START_PAGE_SETTINGS_KEY,
      START_PAGE_RUNTIME_KEY,
      LEGACY_INSTANCE_RUNTIME_KEY,
      ...(localeChange ? [LOCALE_OVERRIDE_KEY] : []),
      ...(completeOnboarding ? [ONBOARDING_KEY] : []),
      DATA_REVISION_KEY,
    ]);
    if (completeOnboarding && isStartPageOnboardingComplete(items[ONBOARDING_KEY])) {
      throw new Error("Start Tab onboarding already completed in another extension context");
    }
    if (localeChange) assertLocalePreference(items[LOCALE_OVERRIDE_KEY], localeChange.expected);
    const prepared = prepareStartPageSettingsWrite(
      value,
      items[START_PAGE_SETTINGS_KEY],
      expectedSettingsUpdatedAt,
    );
    if (isFutureRuntimeSchema(items[START_PAGE_RUNTIME_KEY])) {
      throw new Error("Start Tab runtime data was created by a newer extension version and cannot be modified safely");
    }
    const previousSettings = normalizeStartPageSettings(items[START_PAGE_SETTINGS_KEY]);
    const previousRuntime = normalizeRuntimeState(
      items[START_PAGE_RUNTIME_KEY],
      previousSettings,
      items[LEGACY_INSTANCE_RUNTIME_KEY],
    );
    const retainedIds = new Set(prepared.settings.layout.blocks.map((block) => block.id));
    const removesBlockIds = previousSettings.layout.blocks.some((block) => !retainedIds.has(block.id));
    if (removesBlockIds
      && previousRuntime.updatedAt !== expectedRuntimeUpdatedAt) {
      throw new Error("Start Tab runtime changed in another extension context; reload before replacing the layout");
    }
    const prunedRuntime = normalizeRuntimeState(previousRuntime, prepared.settings);
    const runtime: StartPageRuntimeState = {
      ...prunedRuntime,
      updatedAt: nextRuntimeRevision(previousRuntime.updatedAt === 0
        ? Math.max(previousSettings.updatedAt, rawRevisionFloor(items[DATA_REVISION_KEY]))
        : previousRuntime.updatedAt),
    };
    const previousAlarms = await readClockAlarmSnapshot();
    try {
      await commitStorageMutationWithRevision(
        [START_PAGE_SETTINGS_KEY, START_PAGE_RUNTIME_KEY, LEGACY_INSTANCE_RUNTIME_KEY, ...(localeChange ? [LOCALE_OVERRIDE_KEY] : []), ...(completeOnboarding ? [ONBOARDING_KEY] : [])],
        async () => {
          await chrome.storage.local.set({
            [START_PAGE_SETTINGS_KEY]: prepared.settings,
            [START_PAGE_RUNTIME_KEY]: runtime,
          });
          await chrome.storage.local.remove(LEGACY_INSTANCE_RUNTIME_KEY);
          await reconcileClockAlarmsForRuntime(runtime);
          if (localeChange) await writeLocalePreferenceInExistingTransaction(localeChange.preference);
          if (completeOnboarding) await chrome.storage.local.set({ [ONBOARDING_KEY]: { onboarded: true } });
        },
        Math.max(prepared.settings.updatedAt, runtime.updatedAt),
      );
      return prepared.settings;
    } catch (error) {
      try {
        await restoreClockAlarmSnapshot(previousAlarms);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Start Tab settings/runtime replacement failed and its alarm rollback was incomplete",
        );
      }
      throw error;
    }
  });
}

function resetSettings(raw: unknown, runtime: unknown, dataRevision: unknown, now: number): StartPageSettings {
  const previous = isFutureStartPageSchema(raw) ? null : normalizeStartPageSettings(raw);
  const floor = Math.max(
    rawRevisionFloor(raw), rawRevisionFloor(runtime), rawRevisionFloor(dataRevision),
    previous?.updatedAt ?? 0,
    ...(previous?.layout.blocks.map((block) => block.updatedAt) ?? []),
    ...(previous?.themes.customThemes.map((theme) => theme.updatedAt) ?? []),
  );
  return createDefaultStartPageSettings(nextRuntimeRevision(floor, now));
}

function absentStorageKeys(storage: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.filter((key) => !Object.prototype.hasOwnProperty.call(storage, key));
}

async function restoreStorageKeysSnapshot(snapshot: Record<string, unknown>, keys: readonly string[]): Promise<void> {
  const absent = absentStorageKeys(snapshot, keys);
  const effects: Array<() => Promise<void>> = [];
  if (absent.length > 0) effects.push(() => chrome.storage.local.remove(absent));
  if (Object.keys(snapshot).length > 0) effects.push(() => chrome.storage.local.set(snapshot));
  await runIndependentEffects(effects, "Start Tab runtime storage rollback was incomplete");
}

export async function resetStartPageRuntimeState(): Promise<void> {
  await withStorageLock("data-write", async () => {
    const previous = await chrome.storage.local.get([...RUNTIME_STORAGE_KEYS]);
    const previousAlarms = await readClockAlarmSnapshot();
    try {
      await chrome.storage.local.remove([START_PAGE_RUNTIME_KEY, LEGACY_INSTANCE_RUNTIME_KEY]);
      await clearClockAlarms();
      await markStartTabDataChanged(nextRuntimeRevision(rawRevisionFloor(previous[START_PAGE_RUNTIME_KEY])));
    } catch (error) {
      try {
        await runIndependentEffects([
          () => restoreStorageKeysSnapshot(previous, RUNTIME_STORAGE_KEYS),
          () => restoreClockAlarmSnapshot(previousAlarms),
        ], "Start Tab runtime reset rollback was incomplete");
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Failed to reset Start Tab runtime and restore the previous state");
      }
      throw error;
    }
  });
}

/** Reset settings, onboarding, migrations, runtime, and durable alarms as one recoverable operation. */
export async function resetStartPageData(): Promise<StartPageSettings> {
  return withStorageLock("data-write", async () => {
    const previous = await chrome.storage.local.get([...RESET_STORAGE_KEYS]);
    const previousAlarms = await readClockAlarmSnapshot();
    const settings = resetSettings(
      previous[START_PAGE_SETTINGS_KEY], previous[START_PAGE_RUNTIME_KEY], previous[DATA_REVISION_KEY], Date.now(),
    );

    try {
      await chrome.storage.local.set({ [START_PAGE_SETTINGS_KEY]: settings });
      await chrome.storage.local.remove([
        START_PAGE_MIGRATION_REPORT_KEY,
        START_PAGE_RUNTIME_KEY,
        LEGACY_INSTANCE_RUNTIME_KEY,
        ONBOARDING_KEY,
      ]);
      await clearClockAlarms();
      await markStartTabDataChanged(settings.updatedAt, { allowFutureOverwrite: true });
      return settings;
    } catch (error) {
      try {
        await runIndependentEffects([
          () => restoreStorageKeysSnapshot(previous, RESET_STORAGE_KEYS),
          () => restoreClockAlarmSnapshot(previousAlarms),
        ], "Start Tab data reset rollback was incomplete");
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Failed to reset Start Tab data and restore the previous state");
      }
      throw error;
    }
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

/** Return active Pomodoro work time without counting alarm/suspend delay past its deadline. */
export function pomodoroFocusElapsedMs(clock: ClockRuntimeState, now = Date.now()): number {
  if (clock.type !== "pomodoro"
    || !clock.running
    || clock.phase !== "work"
    || clock.focusSessionStartedAt === null) return 0;
  const effectiveEnd = clock.targetAt === null ? now : Math.min(now, clock.targetAt);
  return Math.max(0, effectiveEnd - clock.focusSessionStartedAt);
}

/** Reset every configured clock and its complete alarm set as one recoverable transaction. */
export async function resetAllClockRuntimeWithAlarms(at?: number): Promise<number[]> {
  const outcome = await mutateStartPageRuntimeStateWithAlarmsAndStorageEffect<{ interruptedFocusTimes: number[]; occurredAt: number }>(
    (runtime, settings) => {
      const now = at ?? Date.now();
      const interruptedFocusTimes: number[] = [];
      for (const block of settings.layout.blocks) {
        if (!isClockBlock(block)) continue;
        const current = ownValue(runtime.clocks, block.id) ?? defaultClockForBlock(block);
        const interruptedMs = pomodoroFocusElapsedMs(current, now);
        if (interruptedMs > 0) interruptedFocusTimes.push(interruptedMs);
        runtime.clocks[block.id] = resetClockState(block);
      }
      return { state: runtime, result: { interruptedFocusTimes, occurredAt: now } };
    },
    [FOCUS_STATS_KEY],
    async ({ interruptedFocusTimes, occurredAt }) => {
      if (interruptedFocusTimes.length === 0) return;
      await applyFocusClockStatsPatchInExistingTransaction({
        interruptedFocusTimesMs: interruptedFocusTimes,
        occurredAt,
      });
    },
  );
  return outcome.interruptedFocusTimes;
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
  await runIndependentEffects(
    alarms
      .filter((alarm) => parseClockAlarmName(alarm.name)?.instanceId === instanceId)
      .map((alarm) => async () => { await chrome.alarms.clear(alarm.name); }),
    "Clock instance alarm cleanup was incomplete",
  );
}

export async function scheduleClockAlarm(instanceId: string, _clock: ClockRuntimeState): Promise<void> {
  await withStorageLock("data-write", async () => {
    const items = await chrome.storage.local.get([
      START_PAGE_SETTINGS_KEY,
      START_PAGE_RUNTIME_KEY,
      LEGACY_INSTANCE_RUNTIME_KEY,
    ]);
    if (isFutureStartPageSchema(items[START_PAGE_SETTINGS_KEY])
      || isFutureRuntimeSchema(items[START_PAGE_RUNTIME_KEY])) return;
    const settings = normalizeStartPageSettings(items[START_PAGE_SETTINGS_KEY]);
    const runtime = normalizeRuntimeState(
      items[START_PAGE_RUNTIME_KEY],
      settings,
      items[LEGACY_INSTANCE_RUNTIME_KEY],
    );
    void instanceId;
    await reconcileClockAlarmsForRuntime(runtime);
  });
}

/** A one-shot Chrome alarm is consumed before its handler runs. Re-arm only
 * the still-current countdown after an early wake-up or failed transaction.
 * Recheck under data-write so a later pause, reset or phase change wins. */
export async function rearmClockAlarmIfPending(
  instanceId: string,
  token: string,
  delayMs: number,
): Promise<void> {
  await withStorageLock("data-write", async () => {
    const items = await chrome.storage.local.get([
      START_PAGE_SETTINGS_KEY,
      START_PAGE_RUNTIME_KEY,
      LEGACY_INSTANCE_RUNTIME_KEY,
    ]);
    if (isFutureStartPageSchema(items[START_PAGE_SETTINGS_KEY])
      || isFutureRuntimeSchema(items[START_PAGE_RUNTIME_KEY])) return;
    const settings = normalizeStartPageSettings(items[START_PAGE_SETTINGS_KEY]);
    const runtime = normalizeRuntimeState(items[START_PAGE_RUNTIME_KEY], settings, items[LEGACY_INSTANCE_RUNTIME_KEY]);
    const clock = ownValue(runtime.clocks, instanceId);
    if (!clock?.running || clock.type === "stopwatch" || clock.targetAt === null
      || clock.completionToken !== token || clock.lastCompletedToken === token) return;
    await chrome.alarms.create(clockAlarmName(instanceId, token), {
      when: Math.max(clock.targetAt, Date.now() + Math.max(100, delayMs)),
    });
  });
}

export interface ClockCompletionResult {
  completed: boolean;
  block: Extract<BlockInstance, { type: ClockBlockType }> | null;
  clock: ClockRuntimeState | null;
  notify: boolean;
  focusTimeMs: number;
  startedWork: boolean;
  completedToken: string | null;
}

export async function completeClockInstance(instanceId: string, expectedToken: string | null, at?: number): Promise<ClockCompletionResult> {
  // The mutation callback runs after acquiring data-write. Do not start the
  // next phase or attribute focus time using the earlier queued request time.
  let now: number;
  return mutateStartPageRuntimeStateWithAlarmsAndStorageEffect<ClockCompletionResult>((runtime, settings) => {
    now = at ?? Date.now();
    const block = settings.layout.blocks.find(
      (candidate): candidate is Extract<BlockInstance, { type: ClockBlockType }> => candidate.id === instanceId && isClockBlock(candidate),
    ) ?? null;
    if (!block) {
      return { state: null, result: { completed: false, block: null, clock: null, notify: false, focusTimeMs: 0, startedWork: false, completedToken: null } };
    }
    const current = ownValue(runtime.clocks, instanceId) ?? defaultClockForBlock(block);
    const token = current.completionToken;
    if (!current.running || block.type === "stopwatch" || current.targetAt === null || current.targetAt > now + 1000) {
      return { state: null, result: { completed: false, block, clock: current, notify: false, focusTimeMs: 0, startedWork: false, completedToken: null } };
    }
    if (expectedToken && token !== expectedToken) {
      return { state: null, result: { completed: false, block, clock: current, notify: false, focusTimeMs: 0, startedWork: false, completedToken: null } };
    }
    if (token && current.lastCompletedToken === token) {
      return { state: null, result: { completed: false, block, clock: current, notify: false, focusTimeMs: 0, startedWork: false, completedToken: null } };
    }

    let next: ClockRuntimeState;
    let focusTimeMs = 0;
    if (block.type === "timer") {
      next = { ...current, running: false, startedAt: null, accumulatedMs: current.durationMs, targetAt: null, lastCompletedToken: token, completionToken: null };
    } else {
      const completedPhase = current.phase ?? "work";
      if (completedPhase === "work" && current.focusSessionStartedAt !== null) {
        focusTimeMs = pomodoroFocusElapsedMs(current, now);
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
    return {
      state: runtime,
      result: {
        completed: true,
        block,
        clock: next,
        notify: block.config.notifyOnComplete,
        focusTimeMs,
        startedWork: block.type === "pomodoro" && next.running && next.phase === "work",
        completedToken: token,
      },
    };
  }, [FOCUS_STATS_KEY], async (result) => {
    if (!result.completed || (!result.startedWork && result.focusTimeMs <= 0)) return;
    await applyFocusClockStatsPatchInExistingTransaction({
      startedSessions: result.startedWork ? 1 : 0,
      completedFocusTimeMs: result.focusTimeMs > 0 ? result.focusTimeMs : undefined,
      completionId: result.completedToken ? `${instanceId}:${result.completedToken}` : undefined,
      occurredAt: now,
    });
  });
}

// completeClockInstance reconciles any auto-started next phase through the same durable scheduleClockAlarm path.
function rawRuntimeHasInstance(value: unknown, instanceId: string): boolean {
  if (!isRecord(value)) return false;
  return ["clocks", "notes", "tasks", "linkPages", "localTasks"].some((key) => {
    const collection = value[key];
    return isRecord(collection) && Object.prototype.hasOwnProperty.call(collection, instanceId);
  });
}

export async function deleteInstanceRuntime(instanceId: string): Promise<void>;
export async function deleteInstanceRuntime(
  instanceId: string,
  expectedBlockUpdatedAt: number,
  expectedRuntimeUpdatedAt: number,
): Promise<void>;
export async function deleteInstanceRuntime(
  instanceId: string,
  expectedBlockUpdatedAt?: number,
  expectedRuntimeUpdatedAt?: number,
): Promise<void> {
  if (typeof document !== "undefined") {
    if (expectedBlockUpdatedAt === undefined || expectedRuntimeUpdatedAt === undefined) {
      throw new Error("Clearing instance runtime requires the current block and runtime revisions");
    }
    await sendMessage({
      type: "delete-instance-runtime",
      instanceId,
      expectedBlockUpdatedAt,
      expectedRuntimeUpdatedAt,
    });
    return;
  }
  await withStorageLock("data-write", async () => {
    const stored = await chrome.storage.local.get([
      START_PAGE_SETTINGS_KEY,
      ...RUNTIME_STORAGE_KEYS,
    ]);
    const previous = Object.fromEntries(RUNTIME_STORAGE_KEYS
      .filter((key) => Object.prototype.hasOwnProperty.call(stored, key))
      .map((key) => [key, stored[key]]));
    const previousAlarms = await readClockAlarmSnapshot();
    const rawSettings = stored[START_PAGE_SETTINGS_KEY];
    const rawRuntime = stored[START_PAGE_RUNTIME_KEY];
    const rawLegacy = stored[LEGACY_INSTANCE_RUNTIME_KEY];
    if (isFutureStartPageSchema(rawSettings) || isFutureRuntimeSchema(rawRuntime)) {
      throw new Error("Start Tab data was created by a newer extension version and instance runtime cannot be modified safely");
    }
    const settings = normalizeStartPageSettings(rawSettings);
    const runtime = normalizeRuntimeState(rawRuntime, settings, rawLegacy);
    if (expectedBlockUpdatedAt !== undefined || expectedRuntimeUpdatedAt !== undefined) {
      if (expectedBlockUpdatedAt === undefined || expectedRuntimeUpdatedAt === undefined) {
        throw new Error("Instance runtime revision validation is incomplete");
      }
      const block = settings.layout.blocks.find((candidate) => candidate.id === instanceId);
      if (!block || block.updatedAt !== expectedBlockUpdatedAt) {
        throw new Error("Start Tab block changed or was removed in another extension context; reload before clearing runtime data");
      }
      if (runtime.updatedAt !== expectedRuntimeUpdatedAt) {
        throw new Error("Start Tab runtime changed in another extension context; reload before clearing runtime data");
      }
    }
    const normalizedHasInstance = Object.prototype.hasOwnProperty.call(runtime.clocks, instanceId)
      || Object.prototype.hasOwnProperty.call(runtime.notes, instanceId)
      || Object.prototype.hasOwnProperty.call(runtime.tasks, instanceId)
      || Object.prototype.hasOwnProperty.call(runtime.linkPages, instanceId);
    const storedHasInstance = rawRuntimeHasInstance(rawRuntime, instanceId) || rawRuntimeHasInstance(rawLegacy, instanceId);
    const alarmHasInstance = previousAlarms.some((alarm) => parseClockAlarmName(alarm.name)?.instanceId === instanceId);
    if (!normalizedHasInstance && !storedHasInstance && !alarmHasInstance) return;

    delete runtime.clocks[instanceId];
    delete runtime.notes[instanceId];
    delete runtime.tasks[instanceId];
    delete runtime.linkPages[instanceId];

    try {
      if (normalizedHasInstance || storedHasInstance) {
        await persistRuntimeInTransaction(runtime, settings, runtime.updatedAt, rawLegacy !== undefined);
      }
      await clearClockAlarm(instanceId);
    } catch (error) {
      try {
        await runIndependentEffects([
          () => restoreStorageKeysSnapshot(previous, RUNTIME_STORAGE_KEYS),
          () => restoreClockAlarmSnapshot(previousAlarms),
        ], "Instance runtime storage/alarm rollback was incomplete");
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Failed to delete instance runtime and restore the previous state");
      }
      throw error;
    }
  });
}

export function instanceRuntimeHasUserData(instanceId: string, runtime: StartPageRuntimeState): boolean {
  return Boolean(ownValue(runtime.notes, instanceId)?.trim()) || (ownValue(runtime.tasks, instanceId)?.length ?? 0) > 0;
}
