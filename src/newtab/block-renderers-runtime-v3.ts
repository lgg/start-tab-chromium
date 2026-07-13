import { recordFocusSessionCompleted, recordFocusSessionInterrupted, recordFocusSessionStarted } from "../lib/focus-stats.js";
import {
  clearClockAlarm,
  clockAlarmName,
  completeClockInstance,
  defaultClockForBlock,
  elapsedClockMs,
  getStartPageRuntimeState,
  pauseClockState,
  remainingClockMs,
  resetClockState,
  scheduleClockAlarm,
  startClockState,
  type ClockCompletionResult,
} from "../lib/start-page-runtime.js";
import type { BlockInstance, ClockRuntimeState, LocalTask } from "../lib/start-page-settings.js";
import { actionButton, element, formatDuration } from "./block-renderer-common.js";
import type { BlockRenderContext } from "./block-renderer-types.js";

function notificationMessage(block: Extract<BlockInstance, { type: "timer" | "pomodoro" }>, context: BlockRenderContext): string {
  return block.type === "pomodoro" ? context.i18n.t("pomodoroDone") : context.i18n.t("timerDone");
}

async function applyCompletion(result: ClockCompletionResult, context: BlockRenderContext): Promise<void> {
  if (!result.completed || !result.block) return;
  if (result.focusTimeMs > 0) await recordFocusSessionCompleted(result.focusTimeMs);
  if (result.notify && (result.block.type === "timer" || result.block.type === "pomodoro")) {
    await chrome.notifications.create(`start-tab-clock-${result.block.id}-${result.clock?.lastCompletedToken ?? Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon.128.png",
      title: result.block.title,
      message: notificationMessage(result.block, context),
    });
  }
  context.runtime = await getStartPageRuntimeState(context.settings);
  context.requestRender();
}

async function restoreMissingAlarm(instanceId: string, token: string, clock: ClockRuntimeState | undefined): Promise<void> {
  if (!clock?.running || clock.type === "stopwatch" || clock.completionToken !== token || clock.targetAt === null) return;
  const name = clockAlarmName(instanceId, token);
  if (!await chrome.alarms.get(name)) await scheduleClockAlarm(instanceId, clock);
}

async function claimAndCompleteClock(
  block: Extract<BlockInstance, { type: "timer" | "pomodoro" }>,
  token: string | null,
  context: BlockRenderContext,
): Promise<void> {
  if (!token) return;
  const name = clockAlarmName(block.id, token);
  const claimed = await chrome.alarms.clear(name);
  if (!claimed) {
    context.runtime = await getStartPageRuntimeState(context.settings);
    await restoreMissingAlarm(block.id, token, context.runtime.clocks[block.id]);
    context.requestRender();
    return;
  }
  try {
    await applyCompletion(await completeClockInstance(block.id, token), context);
  } catch {
    context.runtime = await getStartPageRuntimeState(context.settings);
    await restoreMissingAlarm(block.id, token, context.runtime.clocks[block.id]);
    context.requestRender();
  }
}

export function renderClock(
  block: Extract<BlockInstance, { type: "timer" | "stopwatch" | "pomodoro" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  let clock = context.runtime.clocks[block.id] ?? defaultClockForBlock(block);
  context.runtime.clocks[block.id] = clock;
  const phase = element("div", "clock__phase");
  const display = element("div", "clock__display");
  const actions = element("div", "clock__actions");
  const startPause = actionButton("", async () => {
    const now = Date.now();
    if (clock.running) {
      const wasWork = block.type === "pomodoro" && clock.phase === "work" && clock.focusSessionStartedAt !== null;
      const focusElapsed = wasWork ? Math.max(0, now - (clock.focusSessionStartedAt ?? now)) : 0;
      clock = pauseClockState(clock, now);
      if (wasWork && focusElapsed > 0) {
        await recordFocusSessionInterrupted(focusElapsed);
        clock.focusSessionStartedAt = null;
      }
      await clearClockAlarm(block.id);
    } else {
      const startingWork = block.type === "pomodoro" && (clock.phase ?? "work") === "work";
      clock = startClockState(clock, now);
      if (startingWork) await recordFocusSessionStarted();
      await scheduleClockAlarm(block.id, clock);
    }
    context.runtime.clocks[block.id] = clock;
    await context.setRuntime(context.runtime);
    update();
  });
  const reset = actionButton(context.i18n.t("clockReset"), async () => {
    if (block.type === "pomodoro" && clock.running && clock.phase === "work" && clock.focusSessionStartedAt !== null) {
      await recordFocusSessionInterrupted(Math.max(0, Date.now() - clock.focusSessionStartedAt));
    }
    clock = resetClockState(block);
    context.runtime.clocks[block.id] = clock;
    await clearClockAlarm(block.id);
    await context.setRuntime(context.runtime);
    update();
  }, "button button--secondary");
  actions.append(startPause, reset);
  if (block.type === "pomodoro") container.append(phase);
  container.append(display, actions);

  let completionPending = false;
  const update = (): void => {
    const now = Date.now();
    const value = block.type === "stopwatch" ? elapsedClockMs(clock, now) : remainingClockMs(clock, now);
    display.textContent = formatDuration(value, block.type === "stopwatch");
    startPause.textContent = context.i18n.t(clock.running ? "clockPause" : "clockStart");
    if (block.type === "pomodoro") phase.textContent = context.i18n.t(clock.phase === "break" ? "pomodoroBreak" : "pomodoroWork");
    if (clock.running && block.type !== "stopwatch" && value <= 0 && !completionPending) {
      completionPending = true;
      void claimAndCompleteClock(block, clock.completionToken, context)
        .finally(() => { completionPending = false; });
    }
  };
  update();
  const timer = window.setInterval(update, 250);
  context.registerCleanup(() => window.clearInterval(timer));
}

export function renderNote(
  block: Extract<BlockInstance, { type: "note" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const textarea = element("textarea", "note");
  textarea.value = context.runtime.notes[block.id] ?? "";
  textarea.placeholder = block.config.placeholder || context.i18n.t("notePlaceholder");
  textarea.setAttribute("aria-label", block.title);
  let saveTimer = 0;
  textarea.addEventListener("input", () => {
    window.clearTimeout(saveTimer);
    context.runtime.notes[block.id] = textarea.value;
    saveTimer = window.setTimeout(() => {
      saveTimer = 0;
      void context.setRuntime(context.runtime);
    }, 180);
  });
  context.registerCleanup(() => {
    const pending = saveTimer !== 0;
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    if (pending) void context.setRuntime(context.runtime);
  });
  container.append(textarea);
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
    context.runtime.tasks[block.id] = (context.runtime.tasks[block.id] ?? []).filter((candidate) => candidate.id !== task.id);
    await context.setRuntime(context.runtime);
    redraw();
  }, "icon-button");
  remove.title = context.i18n.t("removeTask");
  remove.setAttribute("aria-label", context.i18n.t("removeTask"));
  checkbox.addEventListener("change", () => {
    task.done = checkbox.checked;
    task.updatedAt = Date.now();
    void context.setRuntime(context.runtime).then(redraw);
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
  input.placeholder = block.config.placeholder || context.i18n.t("localTaskPlaceholder");
  input.setAttribute("aria-label", context.i18n.t("localTaskPlaceholder"));
  const add = element("button", "button button--primary", context.i18n.t("addTask"));
  add.type = "submit";
  const list = element("div", "task-list");
  const redraw = (): void => {
    const tasks = (context.runtime.tasks[block.id] ?? []).filter((task) => block.config.showCompleted || !task.done);
    list.replaceChildren(...tasks.map((task) => taskRow(block, task, context, redraw)));
    if (tasks.length === 0) list.append(element("p", "empty-state", context.i18n.t("emptyList")));
  };
  form.append(input, add);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    const now = Date.now();
    const task: LocalTask = {
      id: globalThis.crypto?.randomUUID?.() ?? `task-${now.toString(36)}-${Math.random().toString(36).slice(2)}`,
      title,
      done: false,
      createdAt: now,
      updatedAt: now,
    };
    context.runtime.tasks[block.id] = [...(context.runtime.tasks[block.id] ?? []), task];
    input.value = "";
    void context.setRuntime(context.runtime).then(redraw);
  });
  container.append(form, list);
  redraw();
}
