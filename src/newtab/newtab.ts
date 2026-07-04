import { backupFileName, exportBackup } from "../lib/backup.js";
import {
  getFocusStats,
  recordFocusSessionCompleted,
  recordFocusSessionInterrupted,
  recordFocusSessionStarted,
  resetFocusStats,
} from "../lib/focus-stats.js";
import {
  isGoogleIntegrationConfigured,
  listCalendarEvents,
  type GoogleCalendarEvent,
} from "../lib/google-integration.js";
import { loadI18n, type I18n } from "../lib/i18n.js";
import {
  getStartPageSettings,
  type LayoutBlock,
  type SearchProvider,
  type StartLink,
  type StartPageSettings,
} from "../lib/start-page-settings.js";

const STATE_KEY = "startPageRuntimeState";
const SWIPE_THRESHOLD = 44;
const CLOCK_IDS = ["timer", "stopwatch", "pomodoro"] as const;

type ClockId = typeof CLOCK_IDS[number];
type PomodoroPhase = "work" | "break";

interface ClockState {
  running: boolean;
  startedAt: number | null;
  elapsedMs: number;
  durationMs: number;
  pomodoroPhase?: PomodoroPhase;
  focusSessionStarted?: boolean;
}

interface LocalTask {
  id: string;
  title: string;
  done: boolean;
}

interface RuntimeState {
  clocks: Record<string, ClockState>;
  notes: Record<string, string>;
  linkPages: Record<string, number>;
  localTasks: LocalTask[];
}

interface UrlItem {
  title: string;
  url: string;
}

const gridEl = requireElement<HTMLDivElement>("grid");
const backgroundEl = requireElement<HTMLDivElement>("background");
const settingsEl = requireElement<HTMLButtonElement>("settings");

let i18n: I18n;
let settings: StartPageSettings;
let state: RuntimeState;
let saveTimer: number | undefined;
let calendarEventsCache: Promise<GoogleCalendarEvent[]> | null = null;
let recentItemsCache: Promise<UrlItem[]> | null = null;
let browserPinnedItemsCache: Promise<UrlItem[]> | null = null;

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: ${id}`);
  return element as T;
}

function secondsToMs(seconds: number): number {
  return Math.max(1, seconds) * 1000;
}

function defaultClock(id: ClockId): ClockState {
  const durationMs = id === "timer"
    ? secondsToMs(settings.timers.timerSeconds)
    : secondsToMs(settings.timers.pomodoroWorkSeconds);
  return {
    running: false,
    startedAt: null,
    elapsedMs: 0,
    durationMs,
    pomodoroPhase: id === "pomodoro" ? "work" : undefined,
    focusSessionStarted: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown, fallback: number, min = 0, max = 86_400_000): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function finiteInteger(value: unknown, fallback: number, min = 0, max = 1000): number {
  return Math.round(finiteNumber(value, fallback, min, max));
}

function normalizeClock(id: ClockId, value: unknown): ClockState {
  const fallback = defaultClock(id);
  if (!isRecord(value)) return fallback;

  const startedAt = finiteNumber(value.startedAt, 0, 0, Date.now() + 86_400_000) || null;
  const durationMs = finiteNumber(value.durationMs, fallback.durationMs, 1, 86_400_000);
  const elapsedMs = finiteNumber(value.elapsedMs, fallback.elapsedMs, 0, durationMs);
  const running = value.running === true && startedAt !== null;
  const pomodoroPhase = id === "pomodoro"
    ? value.pomodoroPhase === "break" ? "break" : "work"
    : undefined;

  return {
    running,
    startedAt,
    elapsedMs,
    durationMs,
    pomodoroPhase,
    focusSessionStarted: value.focusSessionStarted === true,
  };
}

function normalizeNotes(value: unknown): Record<string, string> {
  const notes: Record<string, string> = {};
  if (!isRecord(value)) return notes;
  for (const [key, note] of Object.entries(value)) {
    if (typeof note === "string") notes[key] = note;
  }
  return notes;
}

function normalizeLinkPages(value: unknown): Record<string, number> {
  const pages: Record<string, number> = {};
  if (!isRecord(value)) return pages;
  for (const [key, page] of Object.entries(value)) {
    pages[key] = finiteInteger(page, 0, 0, 10_000);
  }
  return pages;
}

function normalizeLocalTasks(value: unknown): LocalTask[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((task) => {
    if (typeof task.id !== "string" || typeof task.title !== "string") return [];
    return [{ id: task.id, title: task.title, done: task.done === true }];
  });
}

async function loadRuntimeState(): Promise<RuntimeState> {
  const items = await chrome.storage.local.get(STATE_KEY);
  const stored = items[STATE_KEY];
  const storedClocks = isRecord(stored) ? stored.clocks : undefined;
  const clocks: Record<string, ClockState> = {};

  for (const id of CLOCK_IDS) {
    clocks[id] = normalizeClock(id, isRecord(storedClocks) ? storedClocks[id] : undefined);
  }

  return {
    clocks,
    notes: normalizeNotes(isRecord(stored) ? stored.notes : undefined),
    linkPages: normalizeLinkPages(isRecord(stored) ? stored.linkPages : undefined),
    localTasks: normalizeLocalTasks(isRecord(stored) ? stored.localTasks : undefined),
  };
}

function saveStateNow(): void {
  window.clearTimeout(saveTimer);
  void chrome.storage.local.set({ [STATE_KEY]: state });
}

function queueSaveState(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveStateNow, 120);
}

function cached<T>(
  current: Promise<T> | null,
  assign: (next: Promise<T> | null) => void,
  factory: () => Promise<T>,
): Promise<T> {
  if (current) return current;
  const next = factory().catch((error: unknown) => {
    assign(null);
    throw error;
  });
  assign(next);
  return next;
}

function applyAppearance(): void {
  document.body.style.setProperty("--text-color", settings.appearance.textColor);
  document.body.style.setProperty("--base-font-size", `${settings.appearance.baseFontSize}px`);
  document.body.style.setProperty("--font-family", settings.appearance.fontFamily);
  document.body.style.setProperty("--background-color", settings.appearance.backgroundColor);
  backgroundEl.style.backgroundImage = settings.appearance.backgroundImage
    ? `url("${settings.appearance.backgroundImage}")`
    : "";
  document.body.className = `effect-${settings.appearance.backgroundEffect}`;
  if (settings.settingsButton.visibility === "hover") {
    document.body.classList.add("settings-hover", `settings-hover-${settings.settingsButton.hoverArea}`);
  }
}

function titleFor(block: LayoutBlock): string {
  const key = `blockTitle${block.type[0]?.toUpperCase() ?? ""}${block.type.slice(1)}`;
  const translated = i18n.t(key);
  return translated === key ? block.title : translated;
}

function card(block: LayoutBlock): HTMLElement {
  const element = document.createElement("section");
  element.className = `card card--${block.type}`;
  element.style.gridColumn = `${block.column} / span ${block.width}`;
  element.style.gridRow = `${block.row} / span ${block.height}`;

  const title = document.createElement("h2");
  title.className = "card__title";
  title.textContent = titleFor(block);
  element.append(title);
  return element;
}

function render(): void {
  gridEl.innerHTML = "";
  gridEl.style.setProperty("--grid-columns", String(settings.layout.columns));

  for (const block of settings.layout.blocks.filter((item) => item.enabled)) {
    const element = card(block);
    renderBlock(block, element);
    gridEl.append(element);
  }

  updateDynamicBlocks();
}

function renderBlock(block: LayoutBlock, element: HTMLElement): void {
  switch (block.type) {
    case "dateTime":
      element.append(el("div", "date-time__time", "", { id: "dateTimeTime" }));
      element.append(el("div", "date-time__date", "", { id: "dateTimeDate" }));
      break;
    case "search":
      renderSearch(element);
      break;
    case "ip":
      element.append(el("div", "ip__detail", i18n.t("ipLoading"), { id: "ipDetail" }));
      break;
    case "links":
      renderLinks(element);
      break;
    case "timer":
    case "stopwatch":
    case "pomodoro":
      renderClock(block.type, element);
      break;
    case "note":
      renderNote(block.id, element);
      break;
    case "localTasks":
      renderLocalTasks(element);
      break;
    case "googleCalendar":
      void renderGoogleCalendar(element);
      break;
    case "weather":
      renderWeatherPlaceholder(element);
      break;
    case "commands":
      renderCommands(element);
      break;
    case "recent":
      void renderRecent(element);
      break;
    case "browserPinned":
      void renderBrowserPinned(element);
      break;
    case "startPinned":
      renderStartPinned(element);
      break;
    case "stats":
      void renderStats(element);
      break;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = "",
  attributes: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function renderSearch(container: HTMLElement): void {
  const form = document.createElement("form");
  form.className = "search";
  const input = el("input", "input") as HTMLInputElement;
  input.type = "search";
  input.placeholder = i18n.t("searchPlaceholder");
  input.autocomplete = "off";
  const button = el("button", "button", i18n.t("searchButton")) as HTMLButtonElement;
  button.type = "submit";
  form.append(input, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    const provider = activeSearchProvider();
    location.href = provider.urlTemplate.split("{query}").join(encodeURIComponent(query));
  });
  container.append(form);
}

function activeSearchProvider(): SearchProvider {
  return settings.search.providers.find((provider) => provider.id === settings.search.provider)
    ?? settings.search.providers[0]
    ?? { id: "google", title: "Google", urlTemplate: "https://www.google.com/search?q={query}" };
}

function renderLinks(container: HTMLElement): void {
  container.style.setProperty("--link-columns", String(settings.links.columns));
  container.style.setProperty("--link-font-family", settings.links.fontFamily);
  container.style.setProperty("--link-font-size", `${settings.links.fontSize}px`);
  container.style.setProperty("--link-icon-size", `${settings.links.iconSize}px`);
  const list = document.createElement("div");
  list.className = `links links--${settings.links.pageDirection}`;
  const perPage = Math.max(1, settings.links.columns * settings.links.rows);
  const totalPages = Math.max(1, Math.ceil(settings.links.items.length / perPage));
  const page = Math.min(state.linkPages.links ?? 0, totalPages - 1);
  state.linkPages.links = page;
  appendLinkTiles(list, settings.links.items.slice(page * perPage, (page + 1) * perPage));
  if (totalPages > 1) attachLinkSwipe(list, totalPages);
  container.append(list);

  if (totalPages > 1) {
    const pager = el("div", "pager");
    const previous = el("button", "button", i18n.t("previousPage")) as HTMLButtonElement;
    const next = el("button", "button", i18n.t("nextPage")) as HTMLButtonElement;
    const label = el("span", "pager__label", i18n.t("pageCounter", { page: page + 1, pages: totalPages }));
    previous.type = "button";
    next.type = "button";
    previous.addEventListener("click", () => changeLinkPage(totalPages, -1));
    next.addEventListener("click", () => changeLinkPage(totalPages, 1));
    pager.append(previous, label, next);
    container.append(pager);
  }
}

function appendLinkTiles(container: HTMLElement, links: StartLink[]): void {
  for (const link of links) {
    const anchor = document.createElement("a");
    anchor.className = "link-tile";
    anchor.href = link.url;
    anchor.innerHTML = `<span class="link-tile__icon"></span><span class="link-tile__title"></span>`;
    const icon = anchor.querySelector(".link-tile__icon");
    const title = anchor.querySelector(".link-tile__title");
    if (icon) icon.textContent = link.icon;
    if (title) title.textContent = link.title;
    container.append(anchor);
  }
}

function attachLinkSwipe(element: HTMLElement, totalPages: number): void {
  let startX = 0;
  let startY = 0;
  element.addEventListener("pointerdown", (event) => {
    startX = event.clientX;
    startY = event.clientY;
  });
  element.addEventListener("pointerup", (event) => {
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    const primaryDelta = settings.links.pageDirection === "vertical" ? deltaY : deltaX;
    if (Math.abs(primaryDelta) < SWIPE_THRESHOLD) return;
    changeLinkPage(totalPages, primaryDelta < 0 ? 1 : -1);
  });
}

function changeLinkPage(totalPages: number, delta: number): void {
  const current = state.linkPages.links ?? 0;
  state.linkPages.links = (current + delta + totalPages) % totalPages;
  queueSaveState();
  render();
}

function renderClock(id: ClockId, container: HTMLElement): void {
  ensureClock(id);
  const value = el("div", "clock-value", "", { id: `${id}Value` });
  const actions = el("div", "clock-actions");
  const start = el("button", "button", i18n.t("clockStart")) as HTMLButtonElement;
  const pause = el("button", "button", i18n.t("clockPause")) as HTMLButtonElement;
  const reset = el("button", "button", i18n.t("clockReset")) as HTMLButtonElement;
  start.type = "button";
  pause.type = "button";
  reset.type = "button";
  start.addEventListener("click", () => startClock(id));
  pause.addEventListener("click", () => pauseClock(id));
  reset.addEventListener("click", () => resetClock(id));
  actions.append(start, pause, reset);
  container.append(value, actions);
}

function ensureClock(id: ClockId): ClockState {
  const clock = state.clocks[id];
  if (clock) return clock;
  const created = defaultClock(id);
  state.clocks[id] = created;
  return created;
}

function clockElapsed(clock: ClockState): number {
  return clock.running && clock.startedAt ? clock.elapsedMs + Date.now() - clock.startedAt : clock.elapsedMs;
}

function startClock(id: ClockId): void {
  const clock = ensureClock(id);
  const elapsedBeforeStart = clockElapsed(clock);
  if (id !== "stopwatch" && elapsedBeforeStart >= clock.durationMs) clock.elapsedMs = 0;
  if (id === "pomodoro" && clock.pomodoroPhase !== "break" && !clock.focusSessionStarted && elapsedBeforeStart === 0) {
    clock.focusSessionStarted = true;
    void recordFocusSessionStarted();
  }
  clock.running = true;
  clock.startedAt = Date.now();
  saveStateNow();
  updateDynamicBlocks();
}

function pauseClock(id: ClockId): void {
  const clock = ensureClock(id);
  clock.elapsedMs = clockElapsed(clock);
  clock.running = false;
  clock.startedAt = null;
  saveStateNow();
  updateDynamicBlocks();
}

function resetClock(id: ClockId): void {
  const clock = ensureClock(id);
  const elapsedMs = clockElapsed(clock);
  if (id === "pomodoro" && clock.focusSessionStarted && clock.pomodoroPhase !== "break" && elapsedMs > 0 && elapsedMs < clock.durationMs) {
    void recordFocusSessionInterrupted(elapsedMs);
  }
  const fresh = defaultClock(id);
  if (id === "pomodoro") fresh.pomodoroPhase = clock.pomodoroPhase ?? "work";
  state.clocks[id] = fresh;
  saveStateNow();
  updateDynamicBlocks();
}

function resetAllClocks(): void {
  for (const id of CLOCK_IDS) {
    state.clocks[id] = defaultClock(id);
  }
  saveStateNow();
  updateDynamicBlocks();
}

function updateDynamicBlocks(): void {
  updateDateTime();
  updateClocks();
}

function isClockBlockType(type: LayoutBlock["type"]): type is ClockId {
  return CLOCK_IDS.some((id) => id === type);
}

function hasDynamicBlocks(): boolean {
  return settings.layout.blocks.some((block) => block.enabled && (block.type === "dateTime" || isClockBlockType(block.type)));
}

function updateDateTime(): void {
  const now = new Date();
  const timeEl = document.getElementById("dateTimeTime");
  const dateEl = document.getElementById("dateTimeDate");
  if (timeEl) {
    timeEl.textContent = settings.dateTime.mode === "date" ? "" : formatTime(now, settings.dateTime.timeFormat);
  }
  if (dateEl) {
    dateEl.textContent = settings.dateTime.mode === "time" ? "" : formatDate(now, settings.dateTime.dateFormat);
  }
}

function updateClocks(): void {
  for (const id of CLOCK_IDS) {
    const target = document.getElementById(`${id}Value`);
    if (!target) continue;
    const clock = ensureClock(id);
    const elapsedMs = clockElapsed(clock);
    if (id === "stopwatch") {
      target.textContent = formatDuration(elapsedMs);
      continue;
    }
    const remainingMs = Math.max(0, clock.durationMs - elapsedMs);
    target.textContent = id === "pomodoro"
      ? `${i18n.t(clock.pomodoroPhase === "break" ? "pomodoroBreak" : "pomodoroWork")} ${formatDuration(remainingMs)}`
      : formatDuration(remainingMs);
    if (clock.running && remainingMs <= 0) finishClock(id, clock);
  }
}

function finishClock(id: ClockId, clock: ClockState): void {
  const completedFocus = id === "pomodoro" && clock.focusSessionStarted && clock.pomodoroPhase !== "break";
  clock.running = false;
  clock.startedAt = null;
  clock.elapsedMs = clock.durationMs;
  if (completedFocus) void recordFocusSessionCompleted(clock.durationMs);
  if (id === "pomodoro") {
    const nextPhase: PomodoroPhase = clock.pomodoroPhase === "break" ? "work" : "break";
    clock.pomodoroPhase = nextPhase;
    clock.focusSessionStarted = false;
    clock.durationMs = secondsToMs(nextPhase === "work"
      ? settings.timers.pomodoroWorkSeconds
      : settings.timers.pomodoroBreakSeconds);
    clock.elapsedMs = 0;
  }
  saveStateNow();
  if (settings.timers.notifyOnComplete) void notify(i18n.t(`${id}Done`));
  void refreshStats();
}

async function notify(message: string): Promise<void> {
  if (!chrome.notifications) return;
  await chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon.128.png",
    title: i18n.t("appName"),
    message,
  });
}

function renderNote(id: string, container: HTMLElement): void {
  const textarea = el("textarea", "textarea") as HTMLTextAreaElement;
  textarea.placeholder = i18n.t("notePlaceholder");
  textarea.value = state.notes[id] ?? "";
  textarea.addEventListener("input", () => {
    state.notes[id] = textarea.value;
    queueSaveState();
  });
  container.append(textarea);
}

function renderLocalTasks(container: HTMLElement): void {
  const form = document.createElement("form");
  form.className = "inline-form";
  const input = el("input", "input") as HTMLInputElement;
  input.placeholder = i18n.t("localTaskPlaceholder");
  const add = el("button", "button", i18n.t("addTask")) as HTMLButtonElement;
  add.type = "submit";
  form.append(input, add);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    state.localTasks.unshift({ id: taskId(), title, done: false });
    queueSaveState();
    render();
  });

  const list = el("div", "task-list");
  for (const task of state.localTasks.slice(0, 8)) {
    const label = document.createElement("label");
    label.className = "task-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.addEventListener("change", () => {
      task.done = checkbox.checked;
      queueSaveState();
    });
    const title = el("span", "task-item__title", task.title);
    const remove = el("button", "button button--tiny", "×") as HTMLButtonElement;
    remove.type = "button";
    remove.title = i18n.t("removeTask");
    remove.addEventListener("click", () => {
      state.localTasks = state.localTasks.filter((item) => item.id !== task.id);
      queueSaveState();
      render();
    });
    label.append(checkbox, title, remove);
    list.append(label);
  }

  container.append(form, list);
}

function taskId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function renderGoogleCalendar(container: HTMLElement): Promise<void> {
  const list = el("div", "compact-list", i18n.t("googleCalendarLoading"));
  container.append(list);

  if (!isGoogleIntegrationConfigured()) {
    list.textContent = i18n.t("googleCalendarNotConfigured");
    appendSettingsButton(container);
    return;
  }

  try {
    const events = await cached(
      calendarEventsCache,
      (next) => { calendarEventsCache = next; },
      () => listCalendarEvents(settings.googleCalendar.calendarId, settings.googleCalendar.maxResults),
    );
    renderCalendarEvents(list, events);
  } catch {
    list.textContent = i18n.t("googleCalendarUnavailable");
    appendSettingsButton(container);
  }
}

function renderCalendarEvents(container: HTMLElement, events: GoogleCalendarEvent[]): void {
  container.textContent = "";
  if (events.length === 0) {
    container.textContent = i18n.t("emptyList");
    return;
  }
  for (const event of events) {
    const item = el("div", "compact-list__item", `${formatEventTime(event.start)} · ${event.title}`);
    container.append(item);
  }
}

function appendSettingsButton(container: HTMLElement): void {
  const button = el("button", "button", i18n.t("openSettings")) as HTMLButtonElement;
  button.type = "button";
  button.addEventListener("click", () => void chrome.runtime.openOptionsPage());
  container.append(button);
}

function renderWeatherPlaceholder(container: HTMLElement): void {
  container.append(el("div", "compact-list", i18n.t("weatherLoading")));
}

function formatEventTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || i18n.t("calendarAllDay");
  return new Intl.DateTimeFormat(i18n.locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function renderRecent(container: HTMLElement): Promise<void> {
  const list = el("div", "compact-list", i18n.t("recentLoading"));
  container.append(list);
  try {
    const results = await cached(
      recentItemsCache,
      (next) => { recentItemsCache = next; },
      async () => {
        const items = await chrome.history.search({ text: "", maxResults: 6, startTime: Date.now() - 1000 * 60 * 60 * 24 * 14 });
        return items.map((item) => ({ title: item.title || item.url || "", url: item.url || "" }));
      },
    );
    renderUrlItems(list, results);
  } catch {
    list.textContent = i18n.t("recentUnavailable");
  }
}

async function renderBrowserPinned(container: HTMLElement): Promise<void> {
  const list = el("div", "compact-list", i18n.t("browserPinnedLoading"));
  container.append(list);
  try {
    const tabs = await cached(
      browserPinnedItemsCache,
      (next) => { browserPinnedItemsCache = next; },
      async () => {
        const pinnedTabs = await chrome.tabs.query({ pinned: true });
        return pinnedTabs.map((tab) => ({ title: tab.title || tab.url || "", url: tab.url || "" }));
      },
    );
    renderUrlItems(list, tabs);
  } catch {
    list.textContent = i18n.t("browserPinnedUnavailable");
  }
}

function renderStartPinned(container: HTMLElement): void {
  const list = el("div", "compact-list");
  renderUrlItems(list, settings.startPinned.items);
  container.append(list);
}

function normalizedWebUrl(value: string): string | null {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

function renderUrlItems(container: HTMLElement, items: UrlItem[]): void {
  container.textContent = "";
  const valid = items.flatMap((item) => {
    const url = normalizedWebUrl(item.url);
    return url ? [{ ...item, url }] : [];
  });
  if (valid.length === 0) {
    container.textContent = i18n.t("emptyList");
    return;
  }
  for (const item of valid) {
    const anchor = document.createElement("a");
    anchor.className = "compact-list__item";
    anchor.href = item.url;
    anchor.textContent = item.title || item.url;
    container.append(anchor);
  }
}

function commandButton(label: string, handler: () => void | Promise<void>): HTMLButtonElement {
  const button = el("button", "button", label) as HTMLButtonElement;
  button.type = "button";
  button.addEventListener("click", () => void handler());
  return button;
}

async function downloadBackup(): Promise<void> {
  const bundle = await exportBackup();
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = backupFileName();
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function handleResetStats(): Promise<void> {
  await resetFocusStats();
  await refreshStats();
}

function renderCommands(container: HTMLElement): void {
  const actions = el("div", "clock-actions");
  actions.append(
    commandButton(i18n.t("openSettings"), () => chrome.runtime.openOptionsPage()),
    commandButton(i18n.t("exportBackup"), downloadBackup),
    commandButton(i18n.t("commandResetClocks"), resetAllClocks),
    commandButton(i18n.t("commandResetStats"), handleResetStats),
  );
  container.append(el("p", "placeholder", i18n.t("commandsPlaceholder")), actions);
}

async function renderStats(container: HTMLElement): Promise<void> {
  const stats = el("div", "stats", "", { id: "statsContent" });
  container.append(stats);
  await refreshStats();
}

async function refreshStats(): Promise<void> {
  const target = document.getElementById("statsContent");
  if (!target) return;
  const { totals } = await getFocusStats();
  target.textContent = [
    i18n.t("statsBlockHits", { value: totals.blockHits }),
    i18n.t("statsAvoidedVisits", { value: totals.avoidedVisits }),
    i18n.t("statsTimeSaved", { value: totals.estimatedMinutesSaved }),
    i18n.t("statsPomodoros", { value: totals.focusSessionsCompleted }),
    i18n.t("statsInterrupted", { value: totals.focusSessionsInterrupted }),
    i18n.t("statsFocusTime", { value: formatDuration(totals.focusTimeMs) }),
    i18n.t("statsUnblocks", { value: totals.unblocksAfterCountdown }),
  ].join("\n");
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTime(date: Date, format: string): string {
  const hours = date.getHours();
  return replaceTokens(format, {
    HH: String(hours).padStart(2, "0"),
    H: String(hours),
    mm: String(date.getMinutes()).padStart(2, "0"),
    ss: String(date.getSeconds()).padStart(2, "0"),
  });
}

function formatDate(date: Date, format: string): string {
  const monthLong = new Intl.DateTimeFormat(i18n.locale, { month: "long" }).format(date);
  const monthShort = new Intl.DateTimeFormat(i18n.locale, { month: "short" }).format(date);
  const weekdayLong = new Intl.DateTimeFormat(i18n.locale, { weekday: "long" }).format(date);
  const weekdayShort = new Intl.DateTimeFormat(i18n.locale, { weekday: "short" }).format(date);
  return replaceTokens(format, {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MMMM: monthLong,
    MMM: monthShort,
    MM: String(date.getMonth() + 1).padStart(2, "0"),
    DD: String(date.getDate()).padStart(2, "0"),
    D: String(date.getDate()),
    dddd: weekdayLong,
    ddd: weekdayShort,
  });
}

function replaceTokens(format: string, tokens: Record<string, string>): string {
  return Object.keys(tokens)
    .sort((left, right) => right.length - left.length)
    .reduce((result, token) => result.split(token).join(tokens[token] ?? ""), format);
}

settingsEl.title = "";
settingsEl.addEventListener("click", () => void chrome.runtime.openOptionsPage());

void (async () => {
  [i18n, settings] = await Promise.all([
    loadI18n(),
    getStartPageSettings(),
  ]);
  state = await loadRuntimeState();
  document.title = i18n.t("appName");
  settingsEl.title = i18n.t("openSettings");
  applyAppearance();
  render();
  window.addEventListener("pagehide", saveStateNow);
  if (hasDynamicBlocks()) window.setInterval(updateDynamicBlocks, 1000);
})();
