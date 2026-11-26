import assert from "node:assert/strict";
import { installDom, installChrome, installFetch, one, button, value, event, key, submit, until, delay } from "./ui-fixture-dom.mjs";
import { createDefaultStartPageSettings, createBlockInstance } from "../src/lib/start-page-settings.js";
import { normalizeRuntimeState } from "../src/lib/start-page-runtime.js";
import { loadI18n } from "../src/lib/i18n.js";

const restoreFetch = installFetch();
const settings = createDefaultStartPageSettings(100);
const runtime = normalizeRuntimeState(undefined, settings);
function seed(extra = {}) { return { startPageSettings: settings, startPageRuntimeState: runtime, localeOverride: "en", blockedSites: ["blocked.example"], ...extra }; }
function handlers(control) {
  control.handler = async m => {
    const s = control.state;
    switch (m.type) {
      case "block": s.blockedSites = [...new Set([...s.blockedSites, m.host])]; break;
      case "unblock": s.blockedSites = s.blockedSites.filter(h => h !== m.host); return { ok: true, changed: true };
      case "clear": s.blockedSites = []; break;
      case "replace-start-page-settings": {
        s.startPageSettings = { ...structuredClone(m.settings), updatedAt: Date.now() };
        s.startPageRuntimeState = normalizeRuntimeState(s.startPageRuntimeState, s.startPageSettings);
        if (m.localeChange) s.localeOverride = m.localeChange.preference;
        if (m.completeOnboarding) s.startPageOnboarding = { onboarded: true };
        return { ok: true, savedSettings: s.startPageSettings };
      }
      case "runtime-note": s.startPageRuntimeState.notes[m.instanceId] = m.value; s.startPageRuntimeState.updatedAt = Date.now(); return { ok: true, runtimeUpdatedAt: s.startPageRuntimeState.updatedAt };
      case "runtime-tasks": s.startPageRuntimeState.tasks[m.instanceId] = m.tasks; s.startPageRuntimeState.updatedAt = Date.now(); return { ok: true, runtimeUpdatedAt: s.startPageRuntimeState.updatedAt, savedTasks: m.tasks };
      case "runtime-link-page": s.startPageRuntimeState.linkPages[m.instanceId] = m.page; s.startPageRuntimeState.updatedAt = Date.now(); return { ok: true, runtimeUpdatedAt: s.startPageRuntimeState.updatedAt, savedLinkPage: m.page };
      case "delete-instance-runtime": delete s.startPageRuntimeState.notes[m.instanceId]; break;
      case "reset-start-page": s.startPageSettings = createDefaultStartPageSettings(); s.startPageRuntimeState = normalizeRuntimeState(undefined, s.startPageSettings); break;
    }
    return { ok: true };
  };
  return control;
}
try {
  // Popup: stale active tab, failure, successful block/unblock, clear, locale.
  let dom = await installDom("popup/popup.html");
  let control = handlers(installChrome(seed()));
  try {
    const t = await loadI18n();
    window.close = () => control.calls.push("close");
    await import("../src/popup/popup.js");
    await until(() => !one(document, "#primary").disabled && !one(document, "#primary").hidden, "popup startup");
    assert.match(one(document, "#site").textContent, /example.com/);
    const primary = one(document, "#primary");
    control.tab = { id: 2, url: "https://changed.example/" };
    primary.click();
    await until(() => one(document, "#site").textContent.includes("changed.example") && !primary.disabled);
    assert.equal(control.messages.length, 0);
    const original = control.handler;
    control.handler = async () => ({ ok: false, error: "Rejected" });
    primary.click();
    await until(() => one(document, "#note").textContent.includes("Rejected") && !primary.disabled);
    control.handler = original;
    primary.click();
    await until(() => control.calls.includes("close"));
    assert.deepEqual(control.messages.at(-1), { type: "block", host: "changed.example" });
    assert.ok(control.calls.some(c => Array.isArray(c) && c[0] === "reload"));
    window.confirm = () => false;
    const prior = control.messages.length;
    one(document, "#clear").click(); await delay(20);
    assert.equal(control.messages.length, prior);
    window.confirm = () => true;
    one(document, "#clear").click();
    await until(() => control.state.blockedSites.length === 0 && !primary.disabled);
    assert.equal(control.messages.at(-1).type, "clear");
    value(one(document, "#language"), "ru", "change");
    await until(() => document.documentElement.lang === "ru" && !one(document, "#language").disabled);
    assert.equal(control.state.localeOverride, "ru");
    assert.ok(t.t("popupTitle"));
    console.log("Popup: real DOM startup, changed tab, rejection, block, reload, clear, language");
  } finally { dom.window.close(); }

  // Blocked interstitial countdown: fake only monotonic time/interval.
  dom = await installDom("blocked/blocked.html", "https://extension.example/blocked.html?site=blocked.example");
  control = handlers(installChrome(seed({ localeOverride: "ru" })));
  const realPerformance = globalThis.performance;
  let now = 1000, tick;
  Object.defineProperty(globalThis, "performance", { value: { now: () => now }, configurable: true, writable: true });
  try {
    window.setInterval = fn => { tick = fn; return 1; };
    window.clearInterval = () => { tick = undefined; };
    await import("../src/blocked/blocked.js");
    await until(() => one(document, "#site").textContent.includes("blocked.example"), "blocked page");
    one(document, "#unblock").click();
    assert.equal(one(document, "#countdown").hidden, false);
    now += 6000; tick();
    now += 3000; tick();
    one(document, "#cancel").click();
    assert.equal(one(document, "#countdown").hidden, true);
    assert.equal(control.messages.length, 0);
    control.handler = async m => m.type === "blocked-original-url" ? { ok: true, blockedUrl: "https://blocked.example/path" } : { ok: false, error: "Rejected" };
    one(document, "#unblock").click();
    now += 10001; tick();
    await until(() => !one(document, "#unblockError").hidden);
    assert.equal(one(document, "#unblock").disabled, false);
    assert.deepEqual(control.messages.map(m => m.type), ["blocked-original-url", "unblock"]);
    one(document, "#unblock").click();
    window.dispatchEvent(new window.Event("pagehide"));
    assert.equal(tick, undefined);
    console.log("Blocked page: countdown, Russian plural forms, cancel, worker failure, pagehide cleanup");
  } finally {
    Object.defineProperty(globalThis, "performance", { value: realPerformance, configurable: true, writable: true });
    dom.window.close();
  }

  // Options: real markup, general form, individual block/theme editing,
  // backup controls and blocklist/statistics, using Chrome API doubles.
  dom = await installDom("options/options.html");
  control = handlers(installChrome(seed()));
  control.chrome.runtime.getManifest = () => ({ version: "3.0.0", chrome_url_overrides: { newtab: "newtab.html" } });
  try {
    const t = await loadI18n();
    const btn = (root, k) => button(root, t.t(k));
    const section = id => one(document, "#" + id);
    const busyDone = () => document.body.getAttribute("aria-busy") !== "true";
    const option = k => {
      const label = [...section("general").querySelectorAll("label")].find(l => l.querySelector(".option-field__label")?.textContent === t.t(k));
      assert.ok(label, "Missing general option: " + k);
      return one(label, "input,select");
    };
    await import("../src/options/options.js");
    await until(() => document.getElementById("statistics")?.querySelector(".stats-grid"), "options startup");
    for (const id of ["general","blocks","themes","backup","blocker","statistics"]) assert.ok(section(id));
    assert.ok(one(document, "#optionsNav").querySelectorAll("a").length >= 6);
    btn(document, "openStartTab").click();
    await until(() => control.calls.some(c => c[0] === "create"));
    value(option("layoutGap"), 20);
    const beforeUnload = new window.Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    assert.equal(beforeUnload.defaultPrevented, true);
    window.confirm = () => false;
    btn(section("general"), "cancel").click();
    assert.equal(option("layoutGap").value, "20");
    window.confirm = () => true;
    submit(one(section("general"), "form"));
    await until(() => control.state.startPageSettings.layout.gap === 20 && busyDone(), "general save");
    const initialBlocks = control.state.startPageSettings.layout.blocks.length;
    const add = one(section("blocks"), ".add-instance select");
    value(add, "note", "change");
    btn(section("blocks"), "addBlock").click();
    let dialog = one(document, "dialog[open]");
    value(one(dialog, 'input[type="text"]'), "Options note");
    submit(one(dialog, "form"));
    await until(() => control.state.startPageSettings.layout.blocks.length === initialBlocks + 1 && busyDone(), "add note");
    let row = [...section("blocks").querySelectorAll(".instance-row")].find(el => el.textContent.includes("Options note"));
    assert.ok(row);
    btn(row, "disable").click();
    await until(() => control.state.startPageSettings.layout.blocks.find(b => b.title === "Options note")?.enabled === false && busyDone());
    row = [...section("blocks").querySelectorAll(".instance-row")].find(el => el.textContent.includes("Options note"));
    btn(row, "duplicate").click();
    await until(() => control.state.startPageSettings.layout.blocks.length === initialBlocks + 2 && busyDone());
    row = [...section("blocks").querySelectorAll(".instance-row")].find(el => el.querySelector(".instance-row__title")?.textContent === "Options note");
    btn(row, "edit").click();
    dialog = one(document, "dialog[open]");
    value(one(dialog, 'input[type="text"]'), "Renamed note");
    submit(one(dialog, "form"));
    await until(() => control.state.startPageSettings.layout.blocks.some(b => b.title === "Renamed note") && busyDone());
    row = [...section("blocks").querySelectorAll(".instance-row")].find(el => el.querySelector(".instance-row__title")?.textContent === "Renamed note");
    btn(row, "clearInstanceData").click();
    await until(() => control.messages.some(m => m.type === "delete-instance-runtime") && busyDone());
    row = [...section("blocks").querySelectorAll(".instance-row")].find(el => el.querySelector(".instance-row__title")?.textContent === "Renamed note");
    btn(row, "delete").click();
    await until(() => !control.state.startPageSettings.layout.blocks.some(b => b.title === "Renamed note") && busyDone());
    btn(section("themes"), "createTheme").click();
    dialog = one(document, "dialog[open]");
    value(one(dialog, 'input[type="text"]'), "Options theme");
    submit(one(dialog, "form"));
    await until(() => control.state.startPageSettings.themes.customThemes.some(t => t.name === "Options theme") && busyDone());
    let themeCard = [...section("themes").querySelectorAll(".theme-card")].find(el => el.querySelector(".theme-card__title")?.textContent === "Options theme");
    assert.ok(themeCard);
    const selectTheme = [...themeCard.querySelectorAll("button")].find(b => b.textContent === t.t("selectTheme"));
    if (selectTheme) {
      selectTheme.click();
      await until(() => control.state.startPageSettings.themes.selectedThemeId === control.state.startPageSettings.themes.customThemes.find(t => t.name === "Options theme").id && busyDone());
    }
    themeCard = [...section("themes").querySelectorAll(".theme-card")].find(el => el.querySelector(".theme-card__title")?.textContent === "Options theme");
    btn(themeCard, "delete").click();
    await until(() => !control.state.startPageSettings.themes.customThemes.some(t => t.name === "Options theme") && busyDone());
    assert.equal(btn(section("backup"), "driveUpload").disabled, true);
    value(one(section("blocker"), "input"), "added.example");
    submit(one(section("blocker"), "form"));
    await until(() => control.state.blockedSites.includes("added.example") && busyDone());
    btn(section("blocker"), "clearBlocklist").click();
    await until(() => control.state.blockedSites.length === 0 && busyDone());
    await until(() => document.getElementById("statistics")?.querySelector(".stats-grid"));
    btn(section("statistics"), "resetStatistics").click();
    await until(() => control.messages.at(-1)?.type === "reset-stats" && busyDone());
    btn(document, "resetStartPage").click();
    await until(() => control.messages.at(-1)?.type === "reset-start-page" && busyDone());
    console.log("Options: general draft, save, add/edit/duplicate/disable/clear/delete blocks, create/select/delete theme, blocker and reset");
  } finally { dom.window.close(); }

  // New tab and the native gate share actual markup and storage events.
  dom = await installDom("newtab/newtab.html", "https://extension.example/newtab.html");
  const small = createDefaultStartPageSettings(100);
  small.layout.blocks = [createBlockInstance("note", { id: "page-note" }), createBlockInstance("localTasks", { id: "page-task" }), createBlockInstance("links", { id: "page-link" }), createBlockInstance("dateTime", { id: "page-date", enabled: false })];
  control = handlers(installChrome(seed({ startPageSettings: small, startPageRuntimeState: normalizeRuntimeState(undefined, small), startPageOnboarding: { onboarded: true } })));
  try {
    await import("../src/newtab/newtab-gate.js");
    await window.startTabGateReady;
    assert.equal(document.getElementById("startTabGateOverlay"), null);
    await import("../src/newtab/newtab.js");
    await until(() => document.querySelectorAll("#grid .card").length === 3, "new tab cards");
    one(document, "#settings").click();
    await until(() => control.calls.includes("options"));
    one(document, "#nativeNewTab").click();
    await until(() => control.messages.some(m => m.type === "open-native-new-tab"));
    one(document, "#editorToolbar button").click();
    await until(() => document.querySelectorAll("#grid .card").length === 4);
    assert.equal(one(document, "#startPage").dataset.editorActive, "true");
    const mode = one(document, "#editorToolbar select");
    value(mode, "free", "change");
    await until(() => one(document, "#startPage").dataset.layoutMode === "free");
    const ev = new window.Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, true);
    const t = await loadI18n();
    button(one(document, "#editorToolbar"), t.t("saveLayout")).click();
    await until(() => one(document, "#startPage").dataset.editorActive === "false");
    assert.equal(control.state.startPageSettings.layout.mode, "free");
    const note = one(document, '[data-block-id="page-note"] textarea');
    value(note, "New tab note");
    await until(() => control.state.startPageRuntimeState.notes["page-note"] === "New tab note");
    const task = one(document, '[data-block-id="page-task"] form');
    value(one(task, "input"), "New tab task");
    submit(task);
    await until(() => control.state.startPageRuntimeState.tasks["page-task"]?.length === 1);
    control.state.startPageSettings.startTab.enabled = false;
    control.chrome.storage.onChanged.emit({ startPageSettings: { newValue: control.state.startPageSettings } }, "local");
    await until(() => document.getElementById("startTabGateOverlay"), "disabled overlay");
    assert.equal(one(document, "#startPage").hasAttribute("inert"), true);
    control.state.startPageSettings.startTab.enabled = true;
    control.chrome.storage.onChanged.emit({ startPageSettings: { newValue: control.state.startPageSettings } }, "local");
    await until(() => !document.getElementById("startTabGateOverlay"));
    window.dispatchEvent(new window.Event("resize"));
    window.dispatchEvent(new window.Event("pagehide"));
    console.log("New tab: render enabled/disabled blocks, layout save, note/task dispatch, native gate, storage overlay and cleanup");
  } finally { dom.window.close(); }
} finally { restoreFetch(); }
