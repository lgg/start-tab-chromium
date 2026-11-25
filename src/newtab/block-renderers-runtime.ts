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
      void requestCompletion(clock.completionToken).catch(context.reportError);
    }
  };

  update();
  const timer = window.setInterval(update, 250);
  context.registerCleanup(() => {
    disposed = true;
    window.clearInterval(timer);
  });
}

export function renderNote(
  block: Extract<BlockInstance, { type: "note" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const textarea = element("textarea", "note");
  let persistedValue = ownValue(context.runtime.notes, block.id) ?? "";
  textarea.value = persistedValue;
  textarea.maxLength = MAX_NOTE_LENGTH;
  textarea.placeholder = block.config.placeholder || context.i18n.t("notePlaceholder");
  textarea.setAttribute("aria-label", blockUsesDefaultTitle(block) ? context.i18n.t(blockTitleKey(block.type)) : block.title);
  let saveTimer = 0;
  let saveJob: Promise<void> = Promise.resolve();

  const queueSave = (value: string): Promise<void> => {
    const nextValue = value.slice(0, MAX_NOTE_LENGTH);
    saveJob = saveJob.catch(() => undefined).then(async () => {
      await context.setRuntime({
        kind: "note",
        instanceId: block.id,
        value: nextValue,
        expectedValue: persistedValue,
      });
      persistedValue = nextValue;
    });
    return saveJob;
  };

  textarea.addEventListener("input", () => {
    window.clearTimeout(saveTimer);
    context.runtime.notes[block.id] = textarea.value;
    saveTimer = window.setTimeout(() => {
      saveTimer = 0;
      void queueSave(textarea.value).catch(() => undefined);
    }, 180);
  });
  context.registerCleanup(() => {
    const pending = saveTimer !== 0;
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    if (pending) void queueSave(textarea.value).catch(() => undefined);
  });
  container.append(textarea);
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
