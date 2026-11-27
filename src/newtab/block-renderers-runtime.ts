import { ownValue } from "../lib/dictionary.js";
import { sendMessage, type ClockAction } from "../lib/messages.js";
import { MAX_LOCAL_TASKS_PER_INSTANCE, MAX_LOCAL_TASK_TITLE_LENGTH, MAX_NOTE_LENGTH } from "../lib/platform-limits.js";
import {
  defaultClockForBlock,
  elapsedClockMs,
  getStartPageRuntimeState,
  getStartPageViewSnapshot,
  remainingClockMs,
} from "../lib/start-page-runtime.js";
import { blockTitleKey, blockUsesDefaultTitle, type BlockInstance, type LocalTask } from "../lib/start-page-settings.js";
import { actionButton, element, formatDuration } from "./block-renderer-common.js";
import type { BlockRenderContext } from "./block-renderer-types.js";
import { ClockRequestGate } from "./clock-request-gate.js";
import { TaskFormSessions, type TaskFormSession } from "./task-submission-gate.js";
import { NoteDraft } from "./note-draft.js";
import { hiddenDraftIds } from "./protected-page-drafts.js";
import type { HiddenTextDraft } from "./hidden-text-drafts.js";
import { refreshAfterAcknowledgedRuntimeWrite, settleClockMutation } from "./runtime-mutation-recovery.js";

const clockRequests = new ClockRequestGate();

async function refreshClock(context: BlockRenderContext): Promise<void> {
  context.runtime = await getStartPageRuntimeState(context.settings);
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
      await settleClockMutation(
        async () => { await sendMessage({ type: "clock-action", instanceId: block.id, action }); },
        async () => { await refreshClock(context); },
        (error) => context.reportError(new Error(context.i18n.t("runtimeSavedRefreshFailed"), { cause: error })),
      );
    } finally {
      clockRequests.finish(lease);
      context.requestRender();
      if (!disposed) update();
    }
  };

  const startPause = actionButton("", () => runAction(clock.running ? "pause" : "start"), "button", context.reportError);
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
      await settleClockMutation(
        async () => {
          const ack = await sendMessage({ type: "complete-clock", instanceId: block.id, token });
          if (ack.notificationFailed) context.reportError(new Error(context.i18n.t("clockCompletedNotificationFailed")));
        },
        async () => { await refreshClock(context); },
        (error) => context.reportError(new Error(context.i18n.t("runtimeSavedRefreshFailed"), { cause: error })),
      );
    } finally {
      clockRequests.finish(lease);
      context.requestRender();
      if (!disposed) update();
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
  save: (value: string, expectedValue: string) => Promise<number | undefined>;
  requestRefresh: () => void;
  reportError: (error: unknown) => void;
  title: string;
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
    const revision = await session.save(attempt.value, attempt.expectedValue);
    session.draft.succeed(attempt, revision);
    session.requestRefresh();
  } catch (error) {
    session.draft.fail(attempt);
    session.reportError(error);
  } finally {
    session.view?.();
    if (!session.view) session.requestRefresh();
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
  const save = async (value: string, expectedValue: string): Promise<number | undefined> => (await context.setRuntime({
    kind: "note",
    instanceId: block.id,
    value,
    expectedValue,
  })).runtimeUpdatedAt;
  const session: NoteSession = noteSessions.get(block.id) ?? {
    draft: new NoteDraft(canonicalValue, context.runtime.updatedAt),
    timer: undefined,
    save,
    requestRefresh: context.requestRender,
    reportError: context.reportError,
    title: block.title,
    resolving: false,
  };
  noteSessions.set(block.id, session);
  session.draft.observeCanonical(canonicalValue, context.runtime.updatedAt);
  session.save = save;
  session.requestRefresh = context.requestRender;
  session.reportError = context.reportError;
  session.title = blockUsesDefaultTitle(block) ? context.i18n.t(blockTitleKey(block.type)) : block.title;

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
    if (session.view !== update || session.resolving || session.draft.saving || !session.draft.failed) return;
    session.resolving = true;
    session.view?.();
    try {
      // Read the actual stored state, not this render's optimistic runtime.
      const { runtime: currentRuntime } = await getStartPageViewSnapshot();
      const current = ownValue(currentRuntime.notes, block.id) ?? "";
      if (discard) {
        if (!window.confirm(context.i18n.t("noteDraftDiscardConfirm"))) return;
        session.draft.discard(current, currentRuntime.updatedAt);
        session.requestRefresh();
      } else {
        if (current !== session.draft.expectedValue
          && !window.confirm(context.i18n.t("noteDraftOverwriteConfirm"))) return;
        session.draft.rebaseForRetry(current, currentRuntime.updatedAt);
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
    // The textarea is a draft, not the canonical runtime used to compare
    // storage events. Freeze editing while an explicit resolution is pending.
    textarea.readOnly = session.resolving;
  };
  session.view = update;
  update();

  textarea.addEventListener("input", () => {
    if (session.resolving || session.view !== update) return;
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

/** Keep inaccessible unsaved text available without writing it to another
 * widget or storing private drafts in the backup/sync payload. */
export function renderHiddenNoteDrafts(
  host: HTMLElement,
  visible: ReadonlySet<string>,
  retained: ReadonlySet<string>,
  context: BlockRenderContext,
): void {
  for (const [id, session] of noteSessions) {
    if (!retained.has(id) && !visible.has(id) && !session.draft.hasUnsaved && !session.resolving) {
      clearNoteTimer(session);
      noteSessions.delete(id);
    }
  }
  const hidden = hiddenDraftIds(Array.from(noteSessions, ([id, session]) => [id, { hasUnsaved: session.draft.hasUnsaved || session.resolving }] as const), visible);
  host.hidden = hidden.length === 0;
  if (hidden.length === 0) { host.replaceChildren(); return; }
  const heading = element("h2", "", context.i18n.t("hiddenNoteDrafts"));
  const description = element("p", "", context.i18n.t("hiddenNoteDraftsDescription"));
  const entries = hidden.map((id) => {
    // The IDs were selected synchronously from this same map.
    const session = noteSessions.get(id)!;
    const row = element("div", "hidden-note-draft");
    const title = element("strong", "", session.title);
    const text = element("textarea", "note");
    text.readOnly = true;
    text.value = session.draft.value;
    text.setAttribute("aria-label", session.title);
    const select = actionButton(context.i18n.t("hiddenNoteSelect"), () => {
      if (!row.isConnected) return;
      text.focus();
      text.select();
    }, "button button--secondary", context.reportError);
    const discard = actionButton(context.i18n.t("hiddenNoteDiscard"), () => {
      if (!row.isConnected || noteSessions.get(id) !== session || session.draft.saving || session.resolving) return;
      if (!window.confirm(context.i18n.t("noteDraftDiscardConfirm"))) return;
      clearNoteTimer(session);
      noteSessions.delete(id);
      context.requestRender();
    }, "button button--secondary", context.reportError);
    discard.disabled = session.draft.saving || session.resolving;
    const actions = element("div", "note-save-status__controls");
    actions.append(select, discard);
    row.append(title, text, actions);
    return row;
  });
  host.replaceChildren(heading, description, ...entries);
}

const taskForms = new TaskFormSessions();

export function hasPendingTaskDrafts(): boolean {
  return taskForms.hasPendingDrafts();
}

export function pruneTaskForms(retained: ReadonlySet<string>): void {
  taskForms.prune(retained);
}

export function hiddenTaskDrafts(visible: ReadonlySet<string>): HiddenTextDraft[] {
  return taskForms.hidden(visible).map(([id, session]) => {
    const snapshot = session.snapshotDraft();
    return { kind: "task", title: session.title, value: snapshot.value, pending: session.pending,
      discard: () => taskForms.discard(id, session, snapshot) };
  });
}

function cloneTasks(tasks: readonly LocalTask[]): LocalTask[] {
  return tasks.map((task) => ({ ...task }));
}

async function saveTasks(
  block: Extract<BlockInstance, { type: "localTasks" }>,
  context: BlockRenderContext,
  submissions: TaskFormSession,
  nextTasks: LocalTask[],
  expectedTasks: LocalTask[],
): Promise<void> {
  const ack = await context.setRuntime({
    kind: "tasks",
    instanceId: block.id,
    tasks: cloneTasks(nextTasks),
    expectedTasks: cloneTasks(expectedTasks),
  });
  if (ack.runtimeUpdatedAt !== undefined && Array.isArray(ack.savedTasks)) {
    submissions.committed.observe(ack.savedTasks, ack.runtimeUpdatedAt);
  } else {
    await refreshAfterAcknowledgedRuntimeWrite(async () => {
      const { runtime } = await getStartPageViewSnapshot();
      submissions.committed.observe(ownValue(runtime.tasks, block.id) ?? [], runtime.updatedAt);
    }, (error) => context.reportError(new Error(context.i18n.t("runtimeSavedRefreshFailed"), { cause: error })));
  }
}

function taskRow(
  task: LocalTask,
  context: BlockRenderContext,
  pending: boolean,
  mutate: (change: (tasks: LocalTask[]) => LocalTask[]) => void,
): HTMLElement {
  const row = element("div", "task");
  const checkbox = element("input", "task__check");
  checkbox.type = "checkbox";
  checkbox.checked = task.done;
  checkbox.disabled = pending;
  checkbox.setAttribute("aria-label", context.i18n.t("toggleTask", { title: task.title }));
  const title = element("span", task.done ? "task__title task__title--done" : "task__title", task.title);
  const remove = actionButton("×", () => {
    mutate((tasks) => tasks.filter((candidate) => candidate.id !== task.id));
  }, "icon-button", context.reportError);
  remove.disabled = pending;
  remove.title = context.i18n.t("removeTask");
  remove.setAttribute("aria-label", context.i18n.t("removeTask"));
  checkbox.addEventListener("change", () => {
    const done = checkbox.checked;
    mutate((tasks) => tasks.map((candidate) => candidate.id === task.id
      ? { ...candidate, done, updatedAt: Math.max(Date.now(), candidate.updatedAt) }
      : candidate));
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
  const submissions = taskForms.get(block.id);
  submissions.title = blockUsesDefaultTitle(block) ? context.i18n.t(blockTitleKey(block.type)) : block.title;
  submissions.committed.observe(ownValue(context.runtime.tasks, block.id) ?? [], context.runtime.updatedAt);
  input.dataset.widgetDraft = `task:${block.id}`;
  input.value = submissions.draft;
  input.addEventListener("input", () => {
    if (submissions.view === redraw) submissions.draft = input.value;
  });
  const settle = (): void => {
    submissions.finish();
    submissions.view?.();
    context.requestRender();
  };
  const mutate = (change: (tasks: LocalTask[]) => LocalTask[]): void => {
    if (submissions.view !== redraw || !submissions.begin()) return;
    const current = submissions.committed.get([]);
    const next = change(cloneTasks(current));
    redraw();
    void saveTasks(block, context, submissions, next, current)
      .catch(context.reportError).finally(settle);
  };
  const redraw = (): void => {
    if (input.value !== submissions.draft) input.value = submissions.draft;
    const allTasks = submissions.committed.get([]);
    const atCapacity = allTasks.length >= MAX_LOCAL_TASKS_PER_INSTANCE;
    input.disabled = atCapacity;
    add.disabled = atCapacity || submissions.pending;
    const tasks = allTasks.filter((task) => block.config.showCompleted || !task.done);
    list.replaceChildren(...tasks.map((task) => taskRow(task, context, submissions.pending, mutate)));
    if (tasks.length === 0) list.append(element("p", "empty-state", context.i18n.t("emptyList")));
  };
  submissions.view = redraw;
  context.registerCleanup(() => {
    if (submissions.view === redraw) submissions.view = undefined;
  });
  form.append(input, add);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submissions.view !== redraw) return;
    const currentTasks = submissions.committed.get([]);
    if (currentTasks.length >= MAX_LOCAL_TASKS_PER_INSTANCE) {
      redraw();
      return;
    }
    submissions.draft = input.value;
    const title = submissions.draft.trim().slice(0, MAX_LOCAL_TASK_TITLE_LENGTH);
    if (!title || !submissions.begin()) return;
    const submittedDraft = submissions.snapshotDraft();
    const now = Date.now();
    const task: LocalTask = {
      id: globalThis.crypto?.randomUUID?.() ?? `task-${now.toString(36)}-${Math.random().toString(36).slice(2)}`,
      title,
      done: false,
      createdAt: now,
      updatedAt: now,
    };
    const nextTasks = [...currentTasks, task];
    redraw();
    void saveTasks(block, context, submissions, nextTasks, currentTasks).then(() => {
      submissions.acknowledge(submittedDraft);
    }).catch(context.reportError).finally(() => {
      settle();
    });
  });
  container.append(form, list);
  redraw();
}
