import { ownValue } from "../lib/dictionary.js";
import { sendMessage, type ClockAction } from "../lib/messages.js";
import { MAX_LOCAL_TASKS_PER_INSTANCE, MAX_LOCAL_TASK_TITLE_LENGTH, MAX_NOTE_LENGTH } from "../lib/platform-limits.js";
import {
  defaultClockForBlock,
  elapsedClockMs,
  getStartPageRuntimeState,
  remainingClockMs,
} from "../lib/start-page-runtime.js";
import { blockTitleKey, blockUsesDefaultTitle, type BlockInstance, type LocalTask } from "../lib/start-page-settings.js";
import { actionButton, element, formatDuration } from "./block-renderer-common.js";
import type { BlockRenderContext } from "./block-renderer-types.js";
import { ClockRequestGate } from "./clock-request-gate.js";
import { TaskSubmissionGate } from "./task-submission-gate.js";
import { NoteDraft } from "./note-draft.js";

const clockRequests = new ClockRequestGate();

async function refreshClock(
  block: Extract<BlockInstance, { type: "timer" | "stopwatch" | "pomodoro" }>,
  context: BlockRenderContext,
): Promise<void> {
  context.runtime = await getStartPageRuntimeState(context.settings);
  if (!ownValue(context.runtime.clocks, block.id)) context.runtime.clocks[block.id] = defaultClockForBlock(block);
  context.requestRender();
}

export function renderClock(
  block: Extract<BlockInstance, { type: "timer" | "stopwatch" | "pomodoro" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  let clock = ownValue(context.runtime.clocks, block.id) ?? defaultClockForBlock(block);
  context.runtime.clocks[block.id] = clock;
  const phase = element("div", "clock__phase");
  const display = element("div", "clock__display");
  const actions = element("div", "clock__actions");
  let disposed = false;

  const runAction = async (action: ClockAction): Promise<void> => {
    if (disposed) return;
    const lease = clockRequests.begin(block.id);
    if (!lease) return;
    update();
    try {
      await sendMessage({ type: "clock-action", instanceId: block.id, action });
    } finally {
      try {
        await refreshClock(block, context);
      } finally {
        clockRequests.finish(lease);
        if (!disposed) update();
      }
    }
  };

  const startPause = actionButton("", () => runAction("toggle"), "button", context.reportError);
  const reset = actionButton(context.i18n.t("clockReset"), () => runAction("reset"), "button button--secondary", context.reportError);
  actions.append(startPause, reset);
  if (block.type === "pomodoro") container.append(phase);
  container.append(display, actions);

  const requestCompletion = async (token: string): Promise<void> => {
    if (disposed) return;
    const lease = clockRequests.begin(block.id, token);
    if (!lease) return;
    update();
    try {
      await sendMessage({ type: "complete-clock", instanceId: block.id, token });
    } finally {
      try {
        await refreshClock(block, context);
      } finally {
        clockRequests.finish(lease);
        if (!disposed) update();
      }
    }
  };

  const update = (): void => {
    if (disposed) return;
    clock = ownValue(context.runtime.clocks, block.id) ?? clock;
    const now = Date.now();
    const value = block.type === "stopwatch" ? elapsedClockMs(clock, now) : remainingClockMs(clock, now);
    // A countdown must not show zero before its actual deadline.
    display.textContent = formatDuration(block.type === "stopwatch" ? value : Math.ceil(value / 1000) * 1000, block.type === "stopwatch");
    startPause.textContent = context.i18n.t(clock.running ? "clockPause" : "clockStart");
    startPause.disabled = clockRequests.isPending(block.id);
    reset.disabled = clockRequests.isPending(block.id);
    if (block.type === "pomodoro") phase.textContent = context.i18n.t(clock.phase === "break" ? "pomodoroBreak" : "pomodoroWork");
    if (clock.running && block.type !== "stopwatch" && value <= 0 && clock.completionToken
      && clockRequests.canComplete(block.id, clock.completionToken)) {
      void requestCompletion(clock.completionToken).catch((error: unknown) => context.reportError(error));
    }
  };

  update();
  const timer = window.setInterval(update, 250);
  context.registerCleanup(() => {
    disposed = true;
    window.clearInterval(timer);
  });
}

interface NoteSession {
  draft: NoteDraft;
  timer: number | undefined;
  save: (value: string, expectedValue: string) => Promise<void>;
  reportError: (error: unknown) => void;
  view?: () => void;
  resolving: boolean;
}

const noteSessions = new Map<string, NoteSession>();

export function hasUnsavedNoteDrafts(): boolean {
  return [...noteSessions.values()].some((session) => session.draft.hasUnsaved || session.resolving);
}

function clearNoteTimer(session: NoteSession): void {
  if (session.timer !== undefined) window.clearTimeout(session.timer);
  session.timer = undefined;
}

function scheduleNoteSave(session: NoteSession, delay = 180): void {
  clearNoteTimer(session);
  if (session.draft.saving || session.draft.failed || !session.draft.hasUnsaved) return;
  session.timer = window.setTimeout(() => {
    session.timer = undefined;
    void flushNoteSave(session);
  }, delay);
}

async function flushNoteSave(session: NoteSession): Promise<void> {
  clearNoteTimer(session);
  const attempt = session.draft.beginSave();
  if (!attempt) return;
  session.view?.();
  try {
    await session.save(attempt.value, attempt.expectedValue);
    session.draft.succeed(attempt);
  } catch (error) {
    session.draft.fail(attempt);
    session.reportError(error);
  } finally {
    session.view?.();
    // A new draft may have been entered while the older write was in flight.
    // It uses the acknowledged baseline, not a newly constructed renderer's.
    scheduleNoteSave(session, 0);
  }
}

export function renderNote(
  block: Extract<BlockInstance, { type: "note" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const canonicalValue = ownValue(context.runtime.notes, block.id) ?? "";
  const save = (value: string, expectedValue: string): Promise<void> => context.setRuntime({
    kind: "note",
    instanceId: block.id,
    value,
    expectedValue,
  });
  const session: NoteSession = noteSessions.get(block.id) ?? {
    draft: new NoteDraft(canonicalValue),
    timer: undefined,
    save,
    reportError: context.reportError,
    resolving: false,
  };
  noteSessions.set(block.id, session);
  session.draft.observeCanonical(canonicalValue);
  session.save = save;
  session.reportError = context.reportError;

  const textarea = element("textarea", "note");
  textarea.dataset.noteId = block.id;
  textarea.maxLength = MAX_NOTE_LENGTH;
  textarea.placeholder = block.config.placeholder || context.i18n.t("notePlaceholder");
  textarea.setAttribute("aria-label", blockUsesDefaultTitle(block) ? context.i18n.t(blockTitleKey(block.type)) : block.title);
  const status = element("div", "note-save-status");
  const message = element("p", "note-save-status__message", context.i18n.t("noteDraftSaveFailed"));
  message.setAttribute("role", "alert");
  const controls = element("div", "note-save-status__controls");

  const resolveDraft = async (discard: boolean): Promise<void> => {
    if (session.resolving || session.draft.saving || !session.draft.failed) return;
    session.resolving = true;
    session.view?.();
    try {
      // Read the actual stored state, not this render's optimistic runtime.
      const currentRuntime = await getStartPageRuntimeState();
      const current = ownValue(currentRuntime.notes, block.id) ?? "";
      if (discard) {
        if (!window.confirm(context.i18n.t("noteDraftDiscardConfirm"))) return;
        session.draft.discard(current);
      } else {
        if (current !== session.draft.expectedValue
          && !window.confirm(context.i18n.t("noteDraftOverwriteConfirm"))) return;
        session.draft.rebaseForRetry(current);
      }
      session.view?.();
      if (!discard) await flushNoteSave(session);
    } finally {
      session.resolving = false;
      session.view?.();
    }
  };

  const retry = actionButton(context.i18n.t("noteDraftRetry"), () => resolveDraft(false), "button button--secondary", context.reportError);
  const discard = actionButton(context.i18n.t("noteDraftDiscard"), () => resolveDraft(true), "button button--secondary", context.reportError);
  controls.append(retry, discard);
  status.append(message, controls);
  const wrapper = element("div", "note-editor");
  wrapper.append(textarea, status);
  container.append(wrapper);

  const update = (): void => {
    if (textarea.value !== session.draft.value) textarea.value = session.draft.value;
    status.hidden = !session.draft.failed;
    retry.disabled = session.resolving;
    discard.disabled = session.resolving;
    // Failed drafts remain visible but must not masquerade as canonical state
    // or hide subsequent external storage events.
    if (!session.draft.failed) context.runtime.notes[block.id] = session.draft.value;
  };
  session.view = update;
  update();

  textarea.addEventListener("input", () => {
    session.draft.edit(textarea.value.slice(0, MAX_NOTE_LENGTH));
    update();
    scheduleNoteSave(session);
  });
  context.registerCleanup(() => {
    if (session.view === update) session.view = undefined;
    // Rendering no longer owns the save queue. Start any pending edit now,
    // but let a currently running save finish before sending its successor.
    void flushNoteSave(session);
  });
}

function cloneTasks(tasks: readonly LocalTask[]): LocalTask[] {
  return tasks.map((task) => ({ ...task }));
}

async function saveTasks(
  block: Extract<BlockInstance, { type: "localTasks" }>,
  context: BlockRenderContext,
  nextTasks: LocalTask[],
): Promise<void> {
  const expectedTasks = cloneTasks(ownValue(context.runtime.tasks, block.id) ?? []);
  context.runtime.tasks[block.id] = cloneTasks(nextTasks);
  await context.setRuntime({
    kind: "tasks",
    instanceId: block.id,
    tasks: cloneTasks(nextTasks),
    expectedTasks,
  });
}

function taskRow(
  block: Extract<BlockInstance, { type: "localTasks" }>,
  task: LocalTask,
  context: BlockRenderContext,
  redraw: () => void,
): HTMLElement {
  const row = element("div", "task");
  const checkbox = element("input", "task__check");
  checkbox.type = "checkbox";
  checkbox.checked = task.done;
  checkbox.setAttribute("aria-label", context.i18n.t("toggleTask", { title: task.title }));
  const title = element("span", task.done ? "task__title task__title--done" : "task__title", task.title);
  const remove = actionButton("×", async () => {
    const nextTasks = (ownValue(context.runtime.tasks, block.id) ?? []).filter((candidate) => candidate.id !== task.id);
    await saveTasks(block, context, nextTasks);
    redraw();
  }, "icon-button");
  remove.title = context.i18n.t("removeTask");
  remove.setAttribute("aria-label", context.i18n.t("removeTask"));
  checkbox.addEventListener("change", () => {
    const now = Date.now();
    const nextTasks = (ownValue(context.runtime.tasks, block.id) ?? []).map((candidate) => candidate.id === task.id
      ? { ...candidate, done: checkbox.checked, updatedAt: now }
      : { ...candidate });
    void saveTasks(block, context, nextTasks).then(redraw).catch(() => undefined);
  });
  row.append(checkbox, title, remove);
  return row;
}

export function renderLocalTasks(
  block: Extract<BlockInstance, { type: "localTasks" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const form = element("form", "task-form");
  const input = element("input", "input");
  input.maxLength = MAX_LOCAL_TASK_TITLE_LENGTH;
  input.placeholder = block.config.placeholder || context.i18n.t("localTaskPlaceholder");
  input.setAttribute("aria-label", context.i18n.t("localTaskPlaceholder"));
  const add = element("button", "button button--primary", context.i18n.t("addTask"));
  add.type = "submit";
  const list = element("div", "task-list");
  const submissions = new TaskSubmissionGate();
  const redraw = (): void => {
    const allTasks = ownValue(context.runtime.tasks, block.id) ?? [];
    const atCapacity = allTasks.length >= MAX_LOCAL_TASKS_PER_INSTANCE;
    input.disabled = atCapacity;
    add.disabled = atCapacity || submissions.pending;
    const tasks = allTasks.filter((task) => block.config.showCompleted || !task.done);
    list.replaceChildren(...tasks.map((task) => taskRow(block, task, context, redraw)));
    if (tasks.length === 0) list.append(element("p", "empty-state", context.i18n.t("emptyList")));
  };
  form.append(input, add);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const currentTasks = ownValue(context.runtime.tasks, block.id) ?? [];
    if (currentTasks.length >= MAX_LOCAL_TASKS_PER_INSTANCE) {
      redraw();
      return;
    }
    const submittedDraft = input.value;
    const title = submittedDraft.trim().slice(0, MAX_LOCAL_TASK_TITLE_LENGTH);
    if (!title || !submissions.begin()) return;
    add.disabled = true;
    const now = Date.now();
    const task: LocalTask = {
      id: globalThis.crypto?.randomUUID?.() ?? `task-${now.toString(36)}-${Math.random().toString(36).slice(2)}`,
      title,
      done: false,
      createdAt: now,
      updatedAt: now,
    };
    const nextTasks = [...currentTasks.map((item) => ({ ...item })), task];
    void saveTasks(block, context, nextTasks).then(() => {
      input.value = submissions.afterSuccess(input.value, submittedDraft);
    }).catch(() => undefined).finally(() => {
      submissions.finish();
      if (list.isConnected) redraw();
    });
  });
  container.append(form, list);
  redraw();
}
