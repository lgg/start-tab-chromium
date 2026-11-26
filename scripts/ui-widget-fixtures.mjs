import assert from "node:assert/strict";
import { installDom, installChrome, installFetch, host, one, button, value, event, submit, until, delay, i18n } from "./ui-fixture-dom.mjs";
import { createBlockInstance, createDefaultStartPageSettings } from "../src/lib/start-page-settings.js";
import { normalizeRuntimeState, startClockState, pauseClockState, resetClockState } from "../src/lib/start-page-runtime.js";
import { renderBlockContent } from "../src/newtab/block-renderers.js";
import { renderHiddenTextDrafts } from "../src/newtab/hidden-text-drafts.js";
import { hiddenSearchDrafts, hasSearchDrafts, pruneLinkPages } from "../src/newtab/block-renderers-static.js";
import { renderHiddenNoteDrafts, hasUnsavedNoteDrafts, hiddenTaskDrafts, hasPendingTaskDrafts, pruneTaskForms } from "../src/newtab/block-renderers-runtime.js";
import { formatDuration, actionButton, downloadJson } from "../src/newtab/block-renderer-common.js";

const dom = await installDom();
const settings = createDefaultStartPageSettings(100);
const runtime = normalizeRuntimeState(undefined, settings);
const control = installChrome({ startPageSettings: settings, startPageRuntimeState: runtime });
const restoreFetch = installFetch();
const cleanups = [], writes = [], errors = [];
let renders = 0, fail = false, rev = Date.now();
const context = {
  i18n, settings, runtime,
  registerCleanup: f => cleanups.push(f), reportError: e => errors.push(e), requestRender: () => renders++,
  setRuntime: async m => {
    writes.push(structuredClone(m));
    if (fail) throw new Error("simulated write rejection");
    const r = context.runtime; r.updatedAt = ++rev;
    if (m.kind === "note") r.notes[m.instanceId] = m.value;
    if (m.kind === "tasks") r.tasks[m.instanceId] = structuredClone(m.tasks);
    if (m.kind === "linkPage") r.linkPages[m.instanceId] = m.page;
    control.state.startPageRuntimeState = structuredClone(r);
    return { ok: true, runtimeUpdatedAt: rev, ...(m.kind === "tasks" ? { savedTasks: m.tasks } : m.kind === "linkPage" ? { savedLinkPage: m.page } : {}) };
  },
};
function widget(type, config = {}, id = "widget-" + type) {
  const block = createBlockInstance(type, { id });
  Object.assign(block.config, config);
  if (!settings.layout.blocks.some(b => b.id === id)) settings.layout.blocks.push(block);
  control.state.startPageSettings = structuredClone(settings);
  control.state.startPageRuntimeState = structuredClone(context.runtime);
  const root = host();
  renderBlockContent(block, root, context);
  return { block, root };
}
try {
  assert.equal(formatDuration(3661000), "01:01:01");
  assert.equal(formatDuration(-1, false), "00:00");
  assert.equal(formatDuration(61000, false), "01:01");
  const failedAction = actionButton("Fail", async () => { throw new Error("action failed"); }, "button", e => errors.push(e));
  failedAction.click();
  await until(() => errors.some(e => e.message === "action failed"));
  const d = widget("dateTime");
  assert.ok(one(d.root, ".date-time__time").textContent);
  assert.ok(one(d.root, ".date-time__date").textContent);
  assert.equal(widget("dateTime", { mode: "time", locale: "not_a_locale" }, "time-only").root.querySelector(".date-time__date"), null);
  assert.equal(widget("dateTime", { mode: "date" }, "date-only").root.querySelector(".date-time__time"), null);
  const search = widget("search");
  const searchInput = one(search.root, "input");
  submit(one(search.root, "form"));
  value(searchInput, "private query");
  assert.equal(hasSearchDrafts(), true);
  const hidden = hiddenSearchDrafts(new Set());
  assert.equal(hidden[0].value, "private query");
  assert.deepEqual(hiddenSearchDrafts(new Set([search.block.id])), []);
  const hiddenHost = host();
  renderHiddenTextDrafts(hiddenHost, hidden, context);
  assert.equal(one(hiddenHost, "textarea").value, "private query");
  button(hiddenHost, "hiddenNoteSelect").click();
  await delay();
  assert.equal(document.activeElement, one(hiddenHost, "textarea"));
  window.confirm = () => false;
  button(hiddenHost, "hiddenNoteDiscard").click(); await delay();
  assert.equal(hasSearchDrafts(), true);
  window.confirm = () => true;
  button(hiddenHost, "hiddenNoteDiscard").click();
  await until(() => !hasSearchDrafts());
  renderHiddenTextDrafts(hiddenHost, [], context);
  assert.equal(hiddenHost.hidden, true);
  const invalidSearch = widget("search", { providers: [{ id: "bad", title: "Bad", urlTemplate: "javascript:{query}" }], provider: "bad" }, "invalid-search");
  value(one(invalidSearch.root, "input"), "query");
  submit(one(invalidSearch.root, "form"));
  assert.ok(errors.some(e => e.message === "validationInvalidSearchProvider"));
  const emptySearch = widget("search", { providers: [] }, "empty-search");
  value(one(emptySearch.root, "input"), "query");
  submit(one(emptySearch.root, "form"));
  const ip = widget("ip");
  await until(() => ip.root.textContent.includes("192.0.2.1"), "IP result");
  const badIp = widget("ip", { endpoint: "https://bad-ip.example/" }, "ip-fallback");
  await until(() => badIp.root.textContent.includes("192.0.2.1"), "IP fallback");
  const links = widget("links", { columns: 1, rows: 1, items: [{ id: "a", title: "First", url: "https://first.example/", icon: "" }, { id: "b", title: "Second", url: "https://second.example/", icon: "S" }] });
  assert.equal(one(links.root, "a").textContent, "FIFirst");
  button(links.root, "nextPage").click();
  await until(() => one(links.root, "a").href === "https://second.example/");
  assert.equal(writes.at(-1).page, 1);
  button(links.root, "nextPage").click();
  await until(() => one(links.root, "a").href === "https://first.example/");
  button(links.root, "previousPage").click();
  await until(() => one(links.root, "a").href === "https://second.example/");
  fail = true;
  button(links.root, "nextPage").click();
  await until(() => errors.some(e => e.message === "simulated write rejection"));
  fail = false;
  assert.equal(one(links.root, "a").href, "https://second.example/");
  const pinned = widget("startPinned", { items: [] });
  assert.equal(pinned.root.querySelector(".pager"), null);
  pruneLinkPages(new Set([links.block.id]));

  // Notes: debounce, failed writes, hidden drafts, retry/discard, canonical baseline.
  const note = widget("note");
  const textarea = one(note.root, "textarea");
  value(textarea, "first note");
  assert.equal(hasUnsavedNoteDrafts(), true);
  await until(() => context.runtime.notes[note.block.id] === "first note");
  await until(() => !hasUnsavedNoteDrafts());
  assert.equal(writes.at(-1).expectedValue, "");
  fail = true;
  value(textarea, "unsaved note");
  await until(() => !one(note.root, ".note-save-status").hidden, "note error");
  const hiddenNotes = host();
  renderHiddenNoteDrafts(hiddenNotes, new Set(), new Set([note.block.id]), context);
  assert.equal(one(hiddenNotes, "textarea").value, "unsaved note");
  button(hiddenNotes, "hiddenNoteSelect").click(); await delay();
  assert.equal(document.activeElement, one(hiddenNotes, "textarea"));
  fail = false;
  button(note.root, "noteDraftRetry").click();
  await until(() => context.runtime.notes[note.block.id] === "unsaved note");
  await until(() => one(note.root, ".note-save-status").hidden);
  fail = true;
  value(textarea, "discard me");
  await until(() => !one(note.root, ".note-save-status").hidden);
  fail = false;
  window.confirm = () => false;
  button(note.root, "noteDraftDiscard").click(); await delay(20);
  assert.equal(textarea.value, "discard me");
  window.confirm = () => true;
  button(note.root, "noteDraftDiscard").click();
  await until(() => textarea.value === "unsaved note");
  renderHiddenNoteDrafts(hiddenNotes, new Set(), new Set([note.block.id]), context);
  assert.equal(hiddenNotes.hidden, true);

  const tasks = widget("localTasks");
  const taskInput = one(tasks.root, "form input"), form = one(tasks.root, "form");
  submit(form);
  value(taskInput, "  task one  ");
  assert.equal(hasPendingTaskDrafts(), true);
  assert.equal(hiddenTaskDrafts(new Set())[0].value, "  task one  ");
  submit(form);
  await until(() => tasks.root.querySelector(".task__title")?.textContent === "task one");
  await until(() => taskInput.value === "");
  assert.equal(context.runtime.tasks[tasks.block.id].length, 1);
  const check = one(tasks.root, ".task__check");
  check.checked = true; event(check, "change");
  await until(() => !!tasks.root.querySelector(".task__title--done"));
  assert.equal(context.runtime.tasks[tasks.block.id][0].done, true);
  button(tasks.root, "removeTask").click();
  await until(() => tasks.root.querySelector(".empty-state") !== null);
  assert.equal(context.runtime.tasks[tasks.block.id].length, 0);
  fail = true;
  value(taskInput, "failed draft");
  const priorErrors = errors.length;
  submit(form);
  await until(() => errors.length > priorErrors);
  assert.equal(taskInput.value, "failed draft");
  fail = false;
  submit(form);
  await until(() => taskInput.value === "" && tasks.root.querySelector(".task__title"));
  pruneTaskForms(new Set([tasks.block.id]));

  // Clock controls send real message shapes and reconcile the mocked runtime.
  control.handler = async m => {
    if (m.type === "clock-action") {
      const b = settings.layout.blocks.find(b => b.id === m.instanceId);
      const previous = context.runtime.clocks[b.id];
      context.runtime.clocks[b.id] = m.action === "start" ? startClockState(previous) : m.action === "pause" ? pauseClockState(previous) : resetClockState(b);
      control.state.startPageRuntimeState = structuredClone(context.runtime);
    }
    return { ok: true };
  };
  for (const type of ["timer", "stopwatch", "pomodoro"]) {
    const clock = widget(type);
    assert.ok(one(clock.root, ".clock__display").textContent);
    button(clock.root, "clockStart").click();
    await until(() => !![...clock.root.querySelectorAll("button")].find(b => b.textContent === "clockPause" && !b.disabled), type + " started");
    assert.equal(control.messages.at(-1).action, "start");
    button(clock.root, "clockPause").click();
    await until(() => !![...clock.root.querySelectorAll("button")].find(b => b.textContent === "clockStart" && !b.disabled), type + " paused");
    button(clock.root, "clockReset").click();
    await until(() => control.messages.at(-1).action === "reset" && !button(clock.root, "clockReset").disabled);
    assert.equal(control.messages.at(-1).instanceId, clock.block.id);
    if (type === "pomodoro") assert.equal(one(clock.root, ".clock__phase").textContent, "pomodoroWork");
  }
  const recent = widget("recent");
  const browserPinned = widget("browserPinned");
  const stats = widget("stats");
  await until(() => recent.root.querySelector("a"));
  assert.equal(recent.root.querySelectorAll("a").length, 1);
  assert.equal(one(recent.root, "a").href, "https://history.example/");
  await until(() => browserPinned.root.querySelector("a"));
  assert.equal(one(browserPinned.root, "a").href, "https://pinned.example/");
  await until(() => stats.root.querySelector(".stats-list"));
  assert.equal(stats.root.querySelectorAll(".stats-list__item").length, 7);
  const calendarDisabled = widget("googleCalendar");
  assert.equal(calendarDisabled.root.textContent, "googleCalendarNotConfigured");
  control.oauth = true;
  const calendar = widget("googleCalendar", { accountLabel: "Work" }, "calendar-enabled");
  await until(() => calendar.root.querySelector(".calendar-event"));
  assert.match(calendar.root.textContent, /Meeting/);
  assert.match(calendar.root.textContent, /Work/);
  for (const mode of ["current", "day", "week"]) {
    const weather = widget("weather", { city: mode === "current" ? "Test city" : "", displayMode: mode }, "weather-" + mode);
    await until(() => weather.root.querySelector(".weather"), mode + " weather");
    assert.ok(weather.root.querySelector(mode === "current" ? ".weather__current" : ".weather__day"));
  }
  const commands = widget("commands");
  button(commands.root, "openSettings").click();
  await until(() => control.calls.includes("options"));
  window.confirm = () => false;
  const count = control.messages.length;
  button(commands.root, "commandResetClocks").click(); await delay();
  assert.equal(control.messages.length, count);
  window.confirm = () => true;
  button(commands.root, "commandResetClocks").click();
  await until(() => control.messages.at(-1)?.type === "reset-clocks");
  await until(() => !button(commands.root, "commandResetStats").disabled);
  button(commands.root, "commandResetStats").click();
  await until(() => control.messages.at(-1)?.type === "reset-stats");
  let download;
  const oldClick = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function () { download = { name: this.download, href: this.href }; };
  downloadJson("test.json", { data: 1 });
  assert.equal(download.name, "test.json");
  assert.match(download.href, /^blob:/);
  button(commands.root, "exportBackup").click();
  await until(() => download.name.startsWith("start-tab-backup-"));
  window.HTMLAnchorElement.prototype.click = oldClick;
  assert.ok(renders > 5);
  // Fresh cache keys force every real provider error and weather summary branch.
  const goodFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw Error("provider offline"); };
    const offlineIp = widget("ip", { endpoint: "https://offline.example/" }, "offline-ip");
    const offlineWeather = widget("weather", { city: "Offline", geocodingEndpoint: "https://offline.example/" }, "offline-weather");
    const offlineCalendar = widget("googleCalendar", { calendarId: "offline" }, "offline-calendar");
    await until(() => offlineIp.root.textContent === "ipUnavailable");
    await until(() => offlineWeather.root.textContent === "weatherUnavailable");
    await until(() => offlineCalendar.root.textContent === "googleCalendarUnavailable");
    globalThis.fetch = async () => Response.json({ results: [] });
    const missingCity = widget("weather", { city: "Unknown City", geocodingEndpoint: "https://unknown.example/" }, "unknown-city");
    await until(() => missingCity.root.textContent === "weatherUnavailable");
    for (const [code, expected] of [[0,"weatherClear"],[2,"weatherCloudy"],[45,"weatherFog"],[61,"weatherRain"],[71,"weatherSnow"],[81,"weatherShowers"],[95,"weatherThunderstorm"],[100,"weatherUnknown"],[null,"weatherUnknown"]]) {
      globalThis.fetch = async () => Response.json({ current: { temperature_2m: 14, weather_code: code }, current_units: { temperature_2m: "°C" }, daily: {time: [],temperature_2m_min:[],temperature_2m_max:[],weather_code:[]} });
      const w = widget("weather", { city: "", forecastEndpoint: "https://weather.example/" + code }, "weather-code-" + code);
      await until(() => w.root.querySelector(".weather__current"), "weather " + code);
      assert.match(w.root.textContent, new RegExp(expected));
    }
    globalThis.fetch = async () => Response.json({});
    for (const mode of ["current","week"]) {
      const empty=widget("weather",{city:"",displayMode:mode,forecastEndpoint:"https://empty.example/"+mode},"empty-weather-"+mode);
      await until(()=>empty.root.textContent==="weatherUnavailable");
    }
    globalThis.fetch = async () => Response.json({items:[]});
    const emptyCalendar=widget("googleCalendar",{calendarId:"empty"},"empty-calendar");
    await until(()=>emptyCalendar.root.textContent.includes("emptyList"));
    const oldHistory=control.chrome.history.search;
    control.chrome.history.search=async()=>[];
    const emptyRecent=widget("recent",{maxResults:7},"empty-recent");
    await until(()=>emptyRecent.root.textContent==="emptyList");
    control.chrome.history.search=async()=>{throw Error("history unavailable")};
    const failedRecent=widget("recent",{maxResults:8},"failed-recent");
    await until(()=>failedRecent.root.textContent==="recentUnavailable");
    control.chrome.history.search=oldHistory;
    const originalGet=control.chrome.storage.local.get;
    control.chrome.storage.local.get=async()=>{throw Error("stats unavailable")};
    const failedStats=widget("stats",{},"failed-stats");
    await until(()=>failedStats.root.textContent==="somethingWentWrong");
    control.chrome.storage.local.get=originalGet;
  } finally {globalThis.fetch=goodFetch}
  const integration = await import("../src/newtab/block-renderers-integrations.js");
  const eventLabel={id:"e",title:"",start:"",end:"",allDay:false};
  assert.equal(integration.calendarEventLabel(eventLabel,i18n),"calendarUntitledEvent");
  assert.equal(integration.calendarEventLabel({...eventLabel,start:"bad"},i18n),"calendarUntitledEvent");
  assert.equal(integration.calendarEventLabel({...eventLabel,start:"2027-02-30",allDay:true},i18n),"calendarUntitledEvent · calendarAllDay");
  assert.match(integration.calendarEventLabel({...eventLabel,start:"2027-02-01",allDay:true},i18n),/calendarAllDay/);
  const limits=await import("../src/lib/platform-limits.js");
  const fullId="full-tasks";
  context.runtime.tasks[fullId]=Array.from({length:limits.MAX_LOCAL_TASKS_PER_INSTANCE},(_,i)=>({id:"task-"+i,title:"task "+i,done:true,createdAt:100,updatedAt:100}));
  const full=widget("localTasks",{showCompleted:false},fullId);
  assert.equal(one(full.root,"input").disabled,true);
  assert.equal(one(full.root,"button").disabled,true);
  assert.equal(full.root.querySelectorAll(".task").length,0);
  const countBefore=writes.length;
  submit(one(full.root,"form"));
  assert.equal(writes.length,countBefore);

  // Detached asynchronous results must not mutate obsolete DOM nodes.
  const baseFetch=globalThis.fetch;
  let rejectCalendar,finishWeather;
  try{
    globalThis.fetch=async url=>{
      const parsed=new URL(String(url));
      if(parsed.host==="www.googleapis.com")return new Promise((_,reject)=>{rejectCalendar=reject});
      return new Promise(resolve=>{finishWeather=resolve});
    };
    const staleCalendar=widget("googleCalendar",{calendarId:"detached-error"},"detached-calendar");
    await until(()=>rejectCalendar);
    staleCalendar.root.remove();rejectCalendar(Error("obsolete calendar request"));
    await delay(20);assert.equal(staleCalendar.root.textContent,"googleCalendarLoading");
    const staleWeather=widget("weather",{city:"",forecastEndpoint:"https://detached.example/"},"detached-weather");
    await until(()=>finishWeather);
    staleWeather.root.remove();
    finishWeather(Response.json({current:{temperature_2m:14,weather_code:0}}));
    await delay(20);assert.equal(staleWeather.root.textContent,"weatherLoading");
    const staleCommandRoot=widget("commands",{},"detached-command").root;
    const staleCommand=button(staleCommandRoot,"commandResetClocks");
    const priorMessages=control.messages.length;
    staleCommandRoot.remove();staleCommand.click();await delay(20);
    assert.equal(control.messages.length,priorMessages);
  }finally{globalThis.fetch=baseFetch}
  console.log("Widget failure and boundary matrix passed");
  console.log("Widgets: dates, search, hidden drafts, IP, pagination, notes, tasks, clocks, history, pinned, stats, calendar, weather and commands");
} finally {
  for (const cleanup of cleanups.reverse()) cleanup();
  restoreFetch();
  dom.window.close();
}
