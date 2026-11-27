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
    const closeWindow = window.close.bind(window);
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
    control.tab = { id: 3, url: "chrome://settings/" };
    primary.click();
    await until(() => primary.hidden, "unsupported popup tab");
    window.close = closeWindow;
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
    control.handler = async m => {
      if (m.type === "blocked-original-url") return { ok: true, blockedUrl: "https://blocked.example/path" };
      if (m.type === "unblock") { control.state.blockedSites = []; return { ok: true, changed: true }; }
      return { ok: true };
    };
    one(document, "#cancel").click();
    one(document, "#unblock").click();
    now += 10001; tick();
    await until(() => control.messages.some(m => m.type === "record-unblock"), "countdown success");
    assert.deepEqual(control.state.blockedSites, []);
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
    assert.equal(one(dialog, "form").checkValidity(), true, "Default theme must be editable");
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
    btn(themeCard, "duplicate").click();
    await until(() => control.state.startPageSettings.themes.customThemes.length === 2 && busyDone(), "duplicate theme");
    themeCard = [...section("themes").querySelectorAll(".theme-card")].find(el => el.querySelector(".theme-card__title")?.textContent === "Options theme");
    btn(themeCard, "edit").click();
    dialog = one(document, "dialog[open]");
    value(one(dialog, 'input[type="text"]'), "Options theme edited");
    submit(one(dialog, "form"));
    await until(() => control.state.startPageSettings.themes.customThemes.some(t => t.name === "Options theme edited") && busyDone());
    themeCard = [...section("themes").querySelectorAll(".theme-card")].find(el => el.querySelector(".theme-card__title")?.textContent === "Options theme edited");
    btn(themeCard, "delete").click();
    await until(() => !control.state.startPageSettings.themes.customThemes.some(t => t.name === "Options theme edited") && busyDone());

    // Opening a dialog and cancelling must not publish any write.
    const preCancel=structuredClone(control.state.startPageSettings);
    const countBeforeCancel=control.messages.length;
    btn(section("blocks"),"addBlock").click();
    btn(one(document,"dialog[open]"),"cancel").click();
    await delay(20);
    btn(section("themes"),"createTheme").click();
    btn(one(document,"dialog[open]"),"cancel").click();
    await delay(20);
    const currentCustom=()=>[...section("themes").querySelectorAll(".theme-card")].find(el=>el.querySelector(".theme-card__title")?.textContent===control.state.startPageSettings.themes.customThemes[0].name);
    btn(currentCustom(),"edit").click();
    btn(one(document,"dialog[open]"),"cancel").click();
    await delay(20);
    window.confirm=()=>false;
    btn(currentCustom(),"delete").click();
    const noteRow=[...section("blocks").querySelectorAll(".instance-row")].find(el=>el.querySelector(".instance-row__title")?.textContent?.includes("Options note"));
    assert.ok(noteRow);
    btn(noteRow,"clearInstanceData").click();btn(noteRow,"delete").click();
    btn(section("backup"),"restorePreImportBackup").click();
    btn(section("backup"),"syncRestore").click();
    btn(section("blocker"),"clearBlocklist").click();
    btn(section("statistics"),"resetStatistics").click();
    submit(one(section("blocker"),"form"));
    await delay(20);
    assert.deepEqual(control.state.startPageSettings,preCancel);
    assert.equal(control.messages.length,countBeforeCancel);
    window.confirm=()=>true;

    const existingRow=[...section("blocks").querySelectorAll(".instance-row")].find(el=>el.querySelector(".instance-row__title")?.textContent?.includes("Options note"));
    const savedBeforeEdit=structuredClone(control.state.startPageSettings);
    btn(existingRow,"edit").click();
    btn(one(document,"dialog[open]"),"cancel").click();
    await delay(20);
    assert.deepEqual(control.state.startPageSettings,savedBeforeEdit);
    for(const id of ["backupImportInput","themeImportInput"]){
      const input=one(document,"#"+id);
      Object.defineProperty(input,"files",{configurable:true,value:[]});
      event(input,"change");
    }
    assert.deepEqual(control.state.startPageSettings,savedBeforeEdit);
    assert.equal(btn(section("backup"), "driveUpload").disabled, true);
    const backupApi = await import("../src/lib/backup.js");
    const themeApi = await import("../src/lib/start-page-settings.js");
    const baseline = await backupApi.exportBackup();
    const downloads = [];
    const originalClick = window.HTMLAnchorElement.prototype.click;
    window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
    try {
      btn(section("backup"), "exportBackup").click();
      await until(() => downloads.some(n => n.endsWith(".json")), "backup download");
      const custom = control.state.startPageSettings.themes.customThemes[0];
      const card = [...section("themes").querySelectorAll(".theme-card")].find(el => el.querySelector(".theme-card__title")?.textContent === custom.name);
      btn(card, "exportTheme").click();
      assert.ok(downloads.some(n => n.startsWith("start-tab-theme-")));
      const themeFile = one(document, 'input[type="file"][accept*="json"]#themeImportInput');
      const backupFile = one(document, "#backupImportInput");
      const inject = (input, body) => {
        Object.defineProperty(input, "files", { configurable: true, value: [{ text: async () => body }] });
        event(input, "change");
      };
      btn(section("themes"), "importTheme").click();
      const count = control.state.startPageSettings.themes.customThemes.length;
      inject(themeFile, JSON.stringify(themeApi.exportCustomTheme(custom)));
      await until(() => control.state.startPageSettings.themes.customThemes.length === count + 1 && busyDone(), "theme import");
      btn(section("backup"), "importBackup").click();
      window.confirm = () => false;
      inject(backupFile, JSON.stringify(baseline));
      await delay(20);
      assert.equal(control.state.startPageSettings.themes.customThemes.length, count + 1);
      window.confirm = () => true;
      inject(backupFile, "{ invalid json");
      await until(() => busyDone() && one(document, "#status").textContent.length > 0);
      inject(backupFile, JSON.stringify(baseline));
      await until(() => control.state.startPageSettings.themes.customThemes.length === count && busyDone(), "backup import");
      btn(section("backup"), "restorePreImportBackup").click();
      await until(() => control.state.startPageSettings.themes.customThemes.length === count + 1 && busyDone(), "pre-import restore");
      btn(section("backup"), "syncUpload").click();
      await until(() => busyDone());
      btn(section("backup"), "syncNow").click();
      await until(() => busyDone());
      btn(section("backup"), "syncRestore").click();
      await until(() => busyDone());
    } finally { window.HTMLAnchorElement.prototype.click = originalClick; }
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
    // General form invalid input, failed commit, committed-but-unreadable,
    // and explicit retry refresh without replaying a destructive mutation.
    const originalHandler=control.handler;
    const local=control.chrome.storage.local;
    const originalGet=local.get;
    const status=()=>one(document,"#status");
    const generalSubmit=()=>submit(one(section("general"),"form"));
    value(option("layoutGap"),61);
    const invalidBefore=control.messages.length;
    generalSubmit();await delay(20);
    assert.equal(control.messages.length,invalidBefore);
    assert.equal(one(section("general"),"form").checkValidity(),false);
    value(option("layoutGap"),23);
    control.handler=async m=>m.type==="replace-start-page-settings"?{ok:false,error:"conflicting settings"}:originalHandler(m);
    generalSubmit();
    await until(()=>status().textContent.includes("conflicting settings")&&busyDone());
    assert.equal(option("layoutGap").value,"23");
    assert.notEqual(control.state.startPageSettings.layout.gap,23);
    control.handler=async m=>{
      const response=await originalHandler(m);
      if(m.type==="replace-start-page-settings")local.get=async()=>{throw Error("refresh failed after commit")};
      return response;
    };
    generalSubmit();
    await until(()=>status().textContent.includes("refresh failed after commit")&&busyDone());
    assert.equal(control.state.startPageSettings.layout.gap,23);
    local.get=originalGet;control.handler=originalHandler;
    const committedCount=control.messages.length;
    generalSubmit();
    await until(()=>status().textContent===t.t("optionsRefreshedRetry")&&busyDone());
    assert.equal(control.messages.length,committedCount,"Refresh must not replay a committed action");
    assert.equal(option("layoutGap").value,"23");
    value(option("layoutGap"),24);
    control.handler=async m=>{
      if(m.type==="replace-start-page-settings"){local.get=async()=>{throw Error("refresh unavailable")};return {ok:false,error:"write refused"}}
      return originalHandler(m);
    };
    generalSubmit();
    await until(()=>status().textContent.includes("write refused")&&status().textContent.includes("refresh unavailable")&&busyDone());
    generalSubmit();
    await until(()=>status().textContent.includes("refresh unavailable")&&busyDone());
    local.get=originalGet;control.handler=originalHandler;
    generalSubmit();
    await until(()=>status().textContent===t.t("optionsRefreshedRetry")&&busyDone());
    assert.equal(option("layoutGap").value,"24");
    window.confirm=()=>true;
    btn(section("general"),"cancel").click();
    await until(()=>option("layoutGap").value==="23"&&busyDone());
    value(option("layoutPreset"),"minimal","change");
    assert.equal(option("layoutMode").value,"grid");
    value(option("layoutColumns"),13);
    assert.equal(option("layoutPreset").value,"custom");
    value(option("layoutPreset"),"focus","change");
    value(option("layoutZone"),"full","change");
    generalSubmit();
    await until(()=>control.state.startPageSettings.layout.profile==="focus"&&busyDone());
    assert.ok(control.state.startPageSettings.layout.blocks.every(b=>b.zone==="full"));
    value(option("locale"),"auto","change");
    generalSubmit();
    await until(()=>control.state.localeOverride===undefined&&busyDone());
    value(option("locale"),"en","change");
    value(option("layoutGap"),25.5);
    value(option("layoutRowHeight"),72.5);
    value(option("containedMaxWidth"),1445.25);
    value(option("defaultMinutesPerAvoidedVisit"),10.25);
    assert.equal(one(section("general"),"form").checkValidity(),true);
    generalSubmit();
    await until(()=>control.state.localeOverride==="en"&&control.state.startPageSettings.layout.gap===25.5&&busyDone());
    assert.equal(control.messages.at(-1).localeChange.preference,"en");
    assert.equal(control.state.startPageSettings.layout.rowHeight,72.5);
    assert.equal(control.state.startPageSettings.layout.containedMaxWidth,1445.25);
    assert.equal(control.state.startPageSettings.focusStats.defaultMinutesPerAvoidedVisit,10.25);
    const previousMessages=control.messages.length;
    window.confirm=()=>false;
    btn(document,"resetStartPage").click();
    await delay(20);
    assert.equal(control.messages.length,previousMessages);
    window.confirm=()=>true;

    // Dirty general form must survive a rejected unrelated action, and
    // an in-flight save must not be replayed by synthetic submit events.
    {
      const currentGap=control.state.startPageSettings.layout.gap;
      const n=control.messages.length;
      value(option("layoutGap"),26);
      window.confirm=()=>false;
      btn(section("blocker"),"clearBlocklist").click();
      btn(section("backup"),"syncNow").click();
      await delay(30);
      assert.equal(control.messages.length,n);
      assert.equal(option("layoutGap").value,"26");
      assert.equal(control.state.startPageSettings.layout.gap,currentGap);
      window.confirm=()=>true;
      let release;
      const previous=control.handler;
      control.handler=m=>m.type==="replace-start-page-settings"?new Promise(resolve=>{release=async()=>resolve(await previous(m))}):previous(m);
      try{
        generalSubmit();await until(()=>release);
        const inFlight=control.messages.length;
        generalSubmit();generalSubmit();
        await delay(20);
        assert.equal(control.messages.length,inFlight);
        await release();
        await until(()=>busyDone()&&control.state.startPageSettings.layout.gap===26);
      }finally{control.handler=previous}
      const clean=new window.Event("beforeunload",{cancelable:true});window.dispatchEvent(clean);
      assert.equal(clean.defaultPrevented,false);
    }
    // Smart sync must report each result instead of a generic success.
    {
      const api=await import("../src/lib/chrome-sync.js");
      const message=key=>t.t(key);
      await control.chrome.storage.sync.remove(Object.keys(await control.chrome.storage.sync.get(null)));
      btn(section("backup"),"syncNow").click();
      await until(()=>busyDone()&&status().textContent===message("syncUploaded"));
      btn(section("backup"),"syncNow").click();
      await until(()=>busyDone()&&status().textContent===message("syncUnchanged"));
      // Preserve the baseline, then publish remote-only content from a
      // separate mock profile and restore the original local profile.
      const savedLocal=await control.chrome.storage.local.get(null);
      const savedRemote=await control.chrome.storage.sync.get(null);
      const remote=installChrome(savedLocal);
      try{
        await remote.chrome.storage.sync.set(savedRemote);
        await remote.chrome.storage.local.set({blockedSites:["remote-only-options.example"]});
        await api.uploadChromeSyncBackup();
        await control.chrome.storage.sync.set(await remote.chrome.storage.sync.get(null));
      }finally{globalThis.chrome=control.chrome}
      btn(section("backup"),"syncNow").click();
      await until(()=>busyDone()&&status().textContent===message("syncRestored"));
      assert.deepEqual(control.state.blockedSites,["remote-only-options.example"]);
    }
    // An existing note must not be discarded silently by a layout preset.
    {
      const old=structuredClone(control.state.startPageSettings);
      const note=createBlockInstance("note",{id:"options-private-note",title:"Private note"});
      old.layout.blocks.push(note);
      old.layout.profile="custom";
      control.state.startPageSettings=old;
      control.state.startPageRuntimeState=normalizeRuntimeState(control.state.startPageRuntimeState,old);
      control.state.startPageRuntimeState.notes[note.id]="private unsaved-to-backup text";
      btn(section("backup"),"syncUpload").click();
      await until(()=>busyDone()&&[...section("blocks").querySelectorAll(".instance-row__title")].some(n=>n.textContent==="Private note"));
      let confirmations=[];
      window.confirm=text=>{confirmations.push(text);return false};
      const n=control.messages.length;
      value(option("layoutPreset"),"minimal","change");
      generalSubmit();await delay(30);
      assert.ok(confirmations.includes(t.t("applyPresetWithDataConfirm")));
      assert.equal(control.messages.length,n);
      assert.equal(control.state.startPageRuntimeState.notes[note.id],"private unsaved-to-backup text");
      window.confirm=()=>true;
      btn(section("general"),"cancel").click();
      await until(()=>busyDone());
    }

    // An unsupported select value (for example after a browser restores stale
    // form state) cannot silently apply a different standard preset.
    {
      const preset=option("layoutPreset");
      const before=control.messages.length;
      const oldMode=option("layoutMode").value,oldColumns=option("layoutColumns").value;
      value(preset,"unsupported-preset","change");
      assert.equal(preset.value,"");
      assert.equal(option("layoutMode").value,oldMode);
      assert.equal(option("layoutColumns").value,oldColumns);
      event(option("layoutColumns"),"input");
      assert.equal(preset.value,"custom");
      assert.equal(control.messages.length,before);
    }
    // Saving a custom layout after selecting a standard preset must not
    // falsely retain the preset badge when its geometry has been changed.
    {
      const initial=control.state.startPageSettings;
      value(option("layoutPreset"),"focus","change");
      value(option("layoutMode"),"free","change");
      assert.equal(option("layoutPreset").value,"custom");
      const previous=control.messages.length;
      generalSubmit();
      await until(()=>busyDone()&&control.state.startPageSettings.layout.mode==="free");
      assert.equal(control.state.startPageSettings.layout.profile,"custom");
      assert.equal(control.messages.length,previous+1);
      assert.equal(control.messages.at(-1).settings.layout.profile,"custom");
      // Select an already-current option: no destructive preset replacement.
      value(option("layoutPreset"),"custom","change");
      const saved=control.messages.length;
      generalSubmit();await until(()=>busyDone());
      assert.equal(control.messages.length,saved);
      assert.equal(control.state.startPageSettings.layout.blocks.length,initial.layout.blocks.length);
    }
    // Confirmation uses the actual runtime data and custom block title.
    {
      const note=createBlockInstance("note",{id:"options-delete-note",title:"Keep this note"});
      const next=structuredClone(control.state.startPageSettings);
      next.layout.blocks.push(note);
      control.state.startPageSettings=next;
      control.state.startPageRuntimeState=normalizeRuntimeState(control.state.startPageRuntimeState,next);
      control.state.startPageRuntimeState.notes[note.id]="private text";
      btn(section("backup"),"syncUpload").click();
      const row=()=>[...section("blocks").querySelectorAll(".instance-row")].find(el=>el.querySelector(".instance-row__title")?.textContent===note.title);
      await until(()=>busyDone()&&row());
      let message;
      window.confirm=text=>{message=text;return false};
      const count=control.messages.length;
      btn(row(),"delete").click();await delay(20);
      assert.equal(message,t.t("deleteBlockWithDataConfirm",{title:note.title}));
      assert.equal(control.messages.length,count);
      assert.equal(control.state.startPageRuntimeState.notes[note.id],"private text");
      window.confirm=()=>true;
      btn(row(),"delete").click();
      await until(()=>busyDone()&&!row());
      assert.equal(control.state.startPageRuntimeState.notes[note.id],undefined);
      assert.equal(control.messages.at(-1).type,"replace-start-page-settings");
    }

    // Transport rejections are not always Error objects. Both the original
    // failure and a failed canonical refresh must remain visible, and the
    // pending form values must survive the explicit refresh/retry cycle.
    {
      const baseline=control.state.startPageSettings.layout.gap;
      const changed=baseline===26?27:26;
      const handler=control.handler,get=local.get;
      value(option("layoutGap"),changed);
      try{
        control.handler=async m=>{
          if(m.type==="replace-start-page-settings"){
            local.get=async()=>{throw "storage disconnected"};
            throw "worker disconnected";
          }
          return handler(m);
        };
        generalSubmit();
        await until(()=>busyDone()&&status().textContent.includes("worker disconnected")&&status().textContent.includes("storage disconnected"));
        assert.equal(status().dataset.error,"true");
        assert.equal(control.state.startPageSettings.layout.gap,baseline);
        assert.equal(option("layoutGap").value,String(changed));
        generalSubmit();
        await until(()=>busyDone()&&status().textContent.includes("storage disconnected"));
        local.get=get;control.handler=handler;
        const count=control.messages.length;
        generalSubmit();
        await until(()=>busyDone()&&status().textContent===t.t("optionsRefreshedRetry"));
        assert.equal(control.messages.length,count);
        assert.equal(option("layoutGap").value,String(changed));
        generalSubmit();
        await until(()=>busyDone()&&control.state.startPageSettings.layout.gap===changed);
      }finally{local.get=get;control.handler=handler}
    }
    console.log("Options: invalid form, failed save, committed refresh failure, recovery, preset and locale paths");
    console.log("Options: general draft, save, add/edit/duplicate/disable/clear/delete blocks, create/select/delete theme, blocker and reset");
  } finally { dom.window.close(); }

  // A blocker-only build must not overwrite the latent full-build setting.
  dom=await installDom("options/options.html");
  control=handlers(installChrome(seed()));
  try {
    const t=await loadI18n();
    await import("../src/options/options.ts?case=blocker-only");
    await until(()=>document.querySelector("#statistics .stats-grid"));
    assert.ok(![...document.querySelectorAll("#headerActions button")].some(b=>b.textContent===t.t("openStartTab")));
    const option=k=>one([...one(document,"#general").querySelectorAll("label")].find(l=>l.querySelector(".option-field__label")?.textContent===t.t(k)),"input,select");
    assert.equal(option("startTabEnabled").disabled,true);
    option("startTabEnabled").checked=false;
    value(option("layoutGap"),19);
    submit(one(document,"#general form"));
    await until(()=>control.state.startPageSettings.layout.gap===19&&document.body.getAttribute("aria-busy")!=="true");
    assert.equal(control.state.startPageSettings.startTab.enabled,true);
  } finally {dom.window.close()}

  // New tab and the native gate share actual markup and storage events.
  dom = await installDom("newtab/newtab.html", "https://extension.example/newtab.html");
  const small = createDefaultStartPageSettings(100);
  small.layout.blocks = [createBlockInstance("note", { id: "page-note" }), createBlockInstance("localTasks", { id: "page-task" }), createBlockInstance("links", { id: "page-link", config: { ...createBlockInstance("links").config, columns: 1, rows: 1 } }), createBlockInstance("dateTime", { id: "page-date", enabled: false })];
  control = handlers(installChrome(seed({ startPageSettings: small, startPageRuntimeState: normalizeRuntimeState(undefined, small), startPageOnboarding: { onboarded: false } })));
  try {
    await import("../src/newtab/newtab-gate.js");
    await window.startTabGateReady;
    assert.equal(document.getElementById("startTabGateOverlay"), null);
    await import("../src/newtab/newtab.js");
    await until(() => document.querySelectorAll("#grid .card").length === 3, "new tab cards");
    await until(() => document.getElementById("onboarding"), "onboarding modal");
    const onboarding = one(document, "#onboarding");
    const onboardingButtons = [...onboarding.querySelectorAll("button")];
    const panel=one(onboarding,'[role="dialog"]');
    const nonTab=new window.KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true});
    panel.dispatchEvent(nonTab);assert.equal(nonTab.defaultPrevented,false);
    for(const b of onboardingButtons)b.disabled=true;
    const noFocus=new window.KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true});
    panel.dispatchEvent(noFocus);
    assert.equal(noFocus.defaultPrevented,true);
    assert.equal(document.activeElement,panel);
    for(const b of onboardingButtons)b.disabled=false;

    onboardingButtons[0].focus();
    key(onboardingButtons[0], "Tab", { shiftKey: true });
    assert.equal(document.activeElement, onboardingButtons.at(-1));
    key(onboardingButtons.at(-1), "Tab");
    assert.equal(document.activeElement, onboardingButtons[0]);
    onboardingButtons.at(-1).click();
    await until(() => control.state.startPageOnboarding?.onboarded && !document.getElementById("onboarding"), "onboarding skip");
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
    control.state.localeOverride = "ru";
    control.chrome.storage.onChanged.emit({ localeOverride: { newValue: "ru" } }, "local");
    await until(() => document.querySelector(".draft-recovery:not([hidden]) button"), "deferred locale reload");
    const reload = one(document, ".draft-recovery:not([hidden]) button");
    window.confirm = () => false;
    reload.click(); await delay(20);
    assert.equal(one(document, "#startPage").dataset.editorActive, "true");
    window.confirm = () => true;
    control.state.localeOverride = "en";
    control.chrome.storage.onChanged.emit({ localeOverride: { newValue: "en" } }, "local");
    await until(() => !document.querySelector(".draft-recovery:not([hidden]) button"), "locale change reverted");

    const externalLocale=await loadI18n();
    control.state.startPageSettings.layout.gap=21;
    control.chrome.storage.onChanged.emit({startPageSettings:{newValue:control.state.startPageSettings}},"local");
    await until(()=>one(document,"#statusRegion").textContent.includes(externalLocale.t("externalSettingsChangeIgnored")), "external settings notice");
    const focusedCard=one(document,'[data-block-id="page-note"]');
    focusedCard.focus();
    window.dispatchEvent(new window.Event("resize"));
    await until(()=>!focusedCard.isConnected,"focused card rerender");
    assert.equal(document.activeElement,one(document,'[data-block-id="page-note"]'));
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
    await delay(50);
    const focusedNote = one(document, '[data-block-id="page-note"] textarea');
    focusedNote.focus(); focusedNote.setSelectionRange(2, 5);
    window.dispatchEvent(new window.Event("resize"));
    await until(() => !focusedNote.isConnected, "note rerender");
    const restoredNote = one(document, '[data-block-id="page-note"] textarea');
    assert.equal(document.activeElement, restoredNote);
    assert.equal(restoredNote.selectionStart, 2); assert.equal(restoredNote.selectionEnd, 5);
    const task = one(document, '[data-block-id="page-task"] form');
    value(one(task, "input"), "New tab task");
    const taskInput = one(task, "input");
    taskInput.focus(); taskInput.setSelectionRange(1, 4);
    window.dispatchEvent(new window.Event("resize"));
    await until(() => !taskInput.isConnected, "task rerender");
    const replacement = one(document, '[data-block-id="page-task"] form input');
    assert.equal(document.activeElement, replacement);
    assert.equal(replacement.selectionStart, 1);
    assert.equal(replacement.selectionEnd, 4);
    submit(one(document, '[data-block-id="page-task"] form'));
    await until(() => control.state.startPageRuntimeState.tasks["page-task"]?.length === 1);
    const normalHandler=control.handler;
    const linksCard=()=>one(document,'[data-block-id="page-link"]');
    await until(()=>linksCard().querySelector(".pager"));
    control.handler=async m=>m.type==="runtime-link-page"?{ok:false,error:"link page conflict"}:normalHandler(m);
    button(linksCard(),t.t("nextPage")).click();
    await until(()=>one(document,"#statusRegion").textContent.includes("link page conflict"));
    assert.equal(control.state.startPageRuntimeState.linkPages["page-link"],0);
    control.handler=normalHandler;
    await until(()=>!button(linksCard(),t.t("nextPage")).disabled,"link retry enabled");
    button(linksCard(),t.t("nextPage")).click();
    await until(()=>control.state.startPageRuntimeState.linkPages["page-link"]===1);
    await delay(50);
    assert.ok(linksCard().querySelector("a"));
    const taskDraft=one(document,'[data-block-id="page-task"] form.task-form input');
    value(taskDraft,"hidden task text");
    const remoteSettings=control.state.startPageSettings;
    remoteSettings.layout.blocks.find(b=>b.id==="page-task").enabled=false;
    control.chrome.storage.onChanged.emit({startPageSettings:{newValue:remoteSettings}},"local");
    await until(()=>document.querySelector(".draft-recovery:not([hidden]) textarea")?.value==="hidden task text");
    assert.equal(document.querySelector('[data-block-id="page-task"]'),null);
    const recovery=one(document,".draft-recovery:not([hidden])");
    button(recovery,t.t("hiddenNoteDiscard")).click();
    await until(()=>!document.querySelector(".draft-recovery:not([hidden]) textarea"));
    control.state.startPageSettings.layout.blocks.find(b=>b.id==="page-task").enabled=true;
    control.chrome.storage.onChanged.emit({startPageSettings:{newValue:control.state.startPageSettings}},"local");
    await until(()=>document.querySelector('[data-block-id="page-task"] form.task-form input'));
    assert.equal(one(document,'[data-block-id="page-task"] form input').value,"");
    control.state.startPageSettings.startTab.enabled = false;
    control.chrome.storage.onChanged.emit({ startPageSettings: { newValue: control.state.startPageSettings } }, "local");
    await until(() => document.getElementById("startTabGateOverlay"), "disabled overlay");
    assert.equal(one(document, "#startPage").hasAttribute("inert"), true);
    control.state.startPageSettings.startTab.enabled = true;
    control.chrome.storage.onChanged.emit({ startPageSettings: { newValue: control.state.startPageSettings } }, "local");
    await until(() => !document.getElementById("startTabGateOverlay"));
    window.name = "split-view";
    control.chrome.tabs.query = async () => [control.tab, { id: 2, url: "https://target.example/", title: "Target tab" }, { id: 3, url: "chrome://settings/" }, { id: 4, url: "invalid" }, { id: 5, url: "" }];
    control.chrome.storage.onChanged.emit({ startPageSettings: { newValue: control.state.startPageSettings } }, "local");
    await until(() => document.getElementById("startTabGateOverlay")?.textContent.includes("Target tab"), "split picker");
    const overlay = one(document, "#startTabGateOverlay");
    assert.ok(control.state.startTabLastNativeNewTabContext);
    const actions = [...overlay.querySelectorAll("button")];
    assert.equal(actions.length, 3);
    actions[0].focus(); key(actions[0], "Tab", { shiftKey: true });
    assert.equal(document.activeElement, actions.at(-1));
    key(actions.at(-1), "Tab"); assert.equal(document.activeElement, actions[0]);
    actions[0].click();
    await until(() => control.calls.some(c => c[0] === "update" && c[2]?.url === "https://target.example/"));
    const oldHandler = control.handler;
    let release;
    control.handler = m => m.type === "open-native-new-tab" ? new Promise(resolve => { release = resolve; }) : oldHandler(m);
    const native = one(overlay, "[data-native-new-tab]");
    const prior = control.messages.length;
    native.click(); native.click();
    assert.equal(native.getAttribute("aria-busy"), "true");
    assert.equal(control.messages.length, prior + 1);
    release({ ok: false, error: "Rejected" });
    await until(() => overlay.querySelector('[role="alert"]:not([hidden])'), "native error");
    control.handler = oldHandler;
    native.click();
    await until(() => !native.hasAttribute("aria-busy"));
    assert.equal(one(overlay, '[role="alert"]').hidden, true);
    actions.at(-1).click();
    await until(() => control.calls.filter(c => c === "options").length >= 2);
    window.name = "";
    control.chrome.storage.onChanged.emit({ startPageSettings: { newValue: control.state.startPageSettings } }, "local");
    await until(() => !document.getElementById("startTabGateOverlay"), "split picker closed");
    control.state.startPageOnboarding = { onboarded: false };
    control.chrome.storage.onChanged.emit({ startPageOnboarding: { newValue: { onboarded: false } } }, "local");
    await until(() => document.getElementById("onboarding"), "onboarding reopened");
    const preset = one(document, "#onboarding .onboarding__presets button");
    preset.click();
    await until(() => control.messages.some(m => m.completeOnboarding === true) && !document.getElementById("onboarding"), "onboarding preset applied");
    assert.equal(control.state.startPageOnboarding.onboarded, true);
    assert.equal(control.state.startPageSettings.layout.mode, "grid");
    control.state.startPageSettings.layout.blocks = [];
    control.chrome.storage.onChanged.emit({ startPageSettings: { newValue: control.state.startPageSettings } }, "local");
    await until(() => document.querySelector("#grid .empty-layout"), "empty layout");

    // A clean page should not prevent navigation; stale storage events
    // after disposal must not recreate cards or perform new storage writes.
    const cleanUnload=new window.Event("beforeunload",{cancelable:true});
    window.dispatchEvent(cleanUnload);
    assert.equal(cleanUnload.defaultPrevented,false);
    control.chrome.storage.onChanged.emit({startPageSettings:{newValue:small}},"sync");
    await delay(30);
    assert.ok(document.querySelector("#grid .empty-layout"));
    window.dispatchEvent(new window.Event("resize"));
    window.dispatchEvent(new window.Event("pagehide"));
    const emptyMarkup=one(document,"#grid").innerHTML;
    control.state.startPageSettings=small;
    control.chrome.storage.onChanged.emit({startPageSettings:{newValue:small}},"local");
    await delay(30);
    assert.equal(one(document,"#grid").innerHTML,emptyMarkup);
    console.log("New tab: render enabled/disabled blocks, layout save, note/task dispatch, native gate, storage overlay and cleanup");
  } finally { dom.window.close(); }
} finally { restoreFetch(); }
