import { loadI18n, type I18n } from "../lib/i18n.js";
import {
  getStartPageSettings,
  type LayoutBlock,
  type SearchProvider,
  type StartPageSettings,
} from "../lib/start-page-settings.js";

const STATE_KEY = "startPageRuntimeState";
const SWIPE_THRESHOLD = 44;

type ClockId = "timer" | "stopwatch" | "pomodoro";
type PomodoroPhase = "work" | "break";

interface ClockState {
  running: boolean;
  startedAt: number | null;
  elapsedMs: number;
  durationMs: number;
  pomodoroPhase?: PomodoroPhase;
}

interface RuntimeState {
  clocks: Record<string, ClockState>;
  notes: Record<string, string>;
  linkPages: Record<string, number>;
}

const gridEl = requireElement<HTMLDivElement>("grid");
const backgroundEl = requireElement<HTMLDivElement>("background");
const settingsEl = requireElement<HTMLButtonElement>("settings");

let i18n: I18n;
let settings: StartPageSettings;
let state: RuntimeState;
let saveTimer: number | undefined;

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
  };
}

async function loadRuntimeState(): Promise<RuntimeState> {
  const items = await chrome.storage.local.get(STATE_KEY);
  const stored = items[STATE_KEY] as Partial<RuntimeState> | undefined;
  return {
    clocks: stored?.clocks ?? {},
    notes: stored?.notes ?? {},
    linkPages: stored?.linkPages ?? {},
  };
}

function queueSaveState(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void chrome.storage.local.set({ [STATE_KEY]: state }), 120);
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
  if (settings.settingsButton.visibility === "hover") document.body.classList.add("settings-hover");
}

function titleFor(block: LayoutBlock): string {
  const key = `blockTitle${block.type[0]?.toUpperCase() ?? ""}${block.type.slice(1)}`;
  const translated = i18n.t(key);
  return translated === key ? block.title : translated;
}

function card(block: LayoutBlock): HTMLDivElement {
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
  void loadIp();
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
    case "agenda":
      element.append(el("p", "placeholder", i18n.t("agendaPlaceholder")));
      break;
    case "weather":
      element.append(el("p", "placeholder", i18n.t("weatherPlaceholder")));
      break;
    case "commands":
      renderCommands(element);
      break;
    case "recent":
      element.append(el("p", "placeholder", i18n.t("recentPlaceholder")));
      break;
    case "stats":
      element.append(el("p", "stats", i18n.t("statsPlaceholder")));
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
    location.href = provider.urlTemplate.replace("{query}", encodeURIComponent(query));
  });
  container.append(form);
}

function activeSearchProvider(): SearchProvider {
  return settings.search.providers.find((provider) => provider.id === settings.search.provider)
    ?? settings.search.providers[0]
    ?? { id: "google", title: "Google", urlTemplate: "https://www.google.com/search?q={query}" };
}

async function loadIp(): Promise<void> {
  const target = document.getElementById("ipDetail");
  if (!target) return;
  try {
    const response = await fetch(settings.ip.endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error(`IP endpoint failed: ${response.status}`);
    const payload = await response.json() as { ip?: string; country_name?: string; country?: string };
    const ip = payload.ip ?? i18n.t("ipUnknown");
    const country = payload.country_name ?? payload.country ?? i18n.t("ipUnknownCountry");
    target.textContent = i18n.t("ipResult", { ip, country });
  } catch {
    target.textContent = i18n.t("ipUnavailable");
  }
}

function renderLinks(container: HTMLElement): void {
  container.style.setProperty("--link-columns", String(settings.links.columns));
  container.style.setProperty("--link-font-size", `${settings.links.fontSize}px`);
  container.style.setProperty("--link-icon-size", `${settings.links.iconSize}px`);
  const list = document.createElement("div");
  list.className = `links links--${settings.links.pageDirection}`;
  const perPage = Math.max(1, settings.links.columns * settings.links.rows);
  const totalPages = Math.max(1, Math.ceil(settings.links.items.length / perPage));
  const page = Math.min(state.linkPages.links ?? 0, totalPages - 1);
  state.linkPages.links = page;
  const items = settings.links.items.slice(page * perPage, (page + 1) * perPage);
  for (const link of items) {
    const anchor = document.createElement("a");
    anchor.className = "link-tile";
    anchor.href = link.url;
    anchor.innerHTML = `<span class="link-tile__icon"></span><span class="link-tile__title"></span>`;
    const icon = anchor.querySelector(".link-tile__icon");
    const title = anchor.querySelector(".link-tile__title");
    if (icon) icon.textContent = link.icon;
    if (title) title.textContent = link.title;
    list.append(anchor);
  }
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
  if (id !== "stopwatch" && clockElapsed(clock) >= clock.durationMs) clock.elapsedMs = 0;
  clock.running = true;
  clock.startedAt = Date.now();
  queueSaveState();
  updateDynamicBlocks();
}

function pauseClock(id: ClockId): void {
  const clock = ensureClock(id);
  clock.elapsedMs = clockElapsed(clock);
  clock.running = false;
  clock.startedAt = null;
  queueSaveState();
  updateDynamicBlocks();
}

function resetClock(id: ClockId): void {
  const clock = ensureClock(id);
  const fresh = defaultClock(id);
  if (id === "pomodoro") fresh.pomodoroPhase = clock.pomodoroPhase ?? "work";
  state.clocks[id] = fresh;
  queueSaveState();
  updateDynamicBlocks();
}

function updateDynamicBlocks(): void {
  updateDateTime();
  updateClocks();
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
  for (const id of ["timer", "stopwatch", "pomodoro"] as const) {
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
  clock.running = false;
  clock.startedAt = null;
  clock.elapsedMs = clock.durationMs;
  if (id === "pomodoro") {
    const nextPhase: PomodoroPhase = clock.pomodoroPhase === "break" ? "work" : "break";
    clock.pomodoroPhase = nextPhase;
    clock.durationMs = secondsToMs(nextPhase === "work"
      ? settings.timers.pomodoroWorkSeconds
      : settings.timers.pomodoroBreakSeconds);
    clock.elapsedMs = 0;
  }
  queueSaveState();
  if (settings.timers.notifyOnComplete) void notify(i18n.t(`${id}Done`));
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

function renderCommands(container: HTMLElement): void {
  const button = el("button", "button", i18n.t("openSettings")) as HTMLButtonElement;
  button.type = "button";
  button.addEventListener("click", () => void chrome.runtime.openOptionsPage());
  container.append(el("p", "placeholder", i18n.t("commandsPlaceholder")), button);
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

settingsEl.title = "Settings";
settingsEl.addEventListener("click", () => void chrome.runtime.openOptionsPage());

void (async () => {
  [i18n, settings, state] = await Promise.all([
    loadI18n(),
    getStartPageSettings(),
    loadRuntimeState(),
  ]);
  document.title = i18n.t("appName");
  settingsEl.title = i18n.t("openSettings");
  applyAppearance();
  render();
  window.setInterval(updateDynamicBlocks, 1000);
})();
