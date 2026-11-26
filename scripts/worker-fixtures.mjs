import assert from "node:assert/strict";
import { installChrome, installFetch, until } from "./ui-fixture-dom.mjs";
import { createDefaultStartPageSettings, createBlockInstance } from "../src/lib/start-page-settings.js";
import { normalizeRuntimeState, getStartPageViewSnapshot } from "../src/lib/start-page-runtime.js";
import { getFocusStats } from "../src/lib/focus-stats.js";
const settings = createDefaultStartPageSettings(100);
settings.layout.blocks = [
  createBlockInstance("note", { id: "worker-note" }), createBlockInstance("localTasks", { id: "worker-task" }),
  createBlockInstance("links", { id: "worker-links" }), createBlockInstance("timer", { id: "worker-timer", config: { type: "timer", durationSeconds: 1, notifyOnComplete: true } }),
  createBlockInstance("pomodoro", { id: "worker-pomodoro" }),
];
const control = installChrome({ startPageSettings: settings, startPageRuntimeState: normalizeRuntimeState(undefined, settings), blockedSites: [], localeOverride: "en" });
control.chrome.runtime.getManifest = () => ({ chrome_url_overrides: { newtab: "newtab.html" } });
const restoreFetch = installFetch();
try {
  const worker = await import("../src/service-worker.js");
  const chrome = control.chrome;
  const sender = { url: "https://extension.example/newtab.html" };
  function dispatch(m, from = sender) {
    return new Promise(resolve => {
      const replies = chrome.runtime.onMessage.emit(m, from, resolve);
      assert.equal(replies.length, 1);
    });
  }
  async function ok(m, from) {
    const ack = await dispatch(m, from);
    assert.equal(ack.ok, true, JSON.stringify(m) + ": " + ack.error);
    return ack;
  }
  async function reject(m, pattern, from) {
    const ack = await dispatch(m, from);
    assert.equal(ack.ok, false);
    assert.match(ack.error, pattern);
  }
  const view = () => getStartPageViewSnapshot();
  assert.equal(worker.sameTasks([], []), true);
  await reject({ type: "invalid" }, /Unsupported/);
  await ok({ type: "block", host: "example.com" });
  assert.deepEqual(control.state.blockedSites, ["example.com"]);
  await ok({ type: "block", host: "example.com" });
  await ok({ type: "replace-blocked-sites", sites: ["example.com", "other.example"] });
  await reject({ type: "clear", expectedSites: ["example.com"] }, /changed/);
  const blocked = "https://extension.example/blocked.html?site=example.com";
  const blockedSender = { url: blocked, frameId: 0, tab: { id: 1 }, documentId: "doc", documentLifecycle: "active" };
  await reject({ type: "unblock", host: "example.com" }, /active top-level/, { ...blockedSender, frameId: 1 });
  await reject({ type: "unblock", host: "example.com" }, /changed before unblocking/, blockedSender);
  chrome.webNavigation.onBeforeNavigate.emit({ tabId: 1, frameId: 0, url: "https://example.com/path" });
  await until(() => control.state.lastBlockedUrls?.["example.com"] === "https://example.com/path");
  control.tab = { id: 1, url: blocked };
  const original = await ok({ type: "blocked-original-url", host: "example.com" }, blockedSender);
  assert.equal(original.blockedUrl, "https://example.com/path");
  assert.equal((await ok({ type: "blocked-original-url", host: "example.com" }, { ...blockedSender, frameId: 1 })).blockedUrl, undefined);
  assert.equal((await ok({ type: "unblock", host: "example.com" }, blockedSender)).changed, true);
  assert.equal((await ok({ type: "unblock", host: "example.com" })).changed, false);
  await ok({ type: "record-unblock", host: "example.com" }, blockedSender);
  assert.equal((await getFocusStats()).totals.unblocksAfterCountdown, 1);
  await ok({ type: "clear", expectedSites: ["other.example"] });
  assert.deepEqual(control.state.blockedSites, []);
  await ok({ type: "runtime-note", instanceId: "worker-note", value: "Hello", expectedValue: "" });
  assert.equal((await view()).runtime.notes["worker-note"], "Hello");
  await reject({ type: "runtime-note", instanceId: "worker-note", value: "Stale", expectedValue: "" }, /changed/);
  await reject({ type: "runtime-note", instanceId: "worker-task", value: "Wrong", expectedValue: "" }, /block changed or was removed/i);
  const task = { id: "test-task", title: "Task", done: false, createdAt: 100, updatedAt: 100 };
  assert.deepEqual((await ok({ type: "runtime-tasks", instanceId: "worker-task", tasks: [task], expectedTasks: [] })).savedTasks.map(t => t.title), ["Task"]);
  await reject({ type: "runtime-tasks", instanceId: "worker-task", tasks: [], expectedTasks: [] }, /changed/);
  assert.equal((await ok({ type: "runtime-link-page", instanceId: "worker-links", page: 2, expectedPage: 0 })).savedLinkPage, 2);
  await reject({ type: "runtime-link-page", instanceId: "worker-links", page: 0, expectedPage: 0 }, /changed/);
  let current = await view();
  await ok({ type: "delete-instance-runtime", instanceId: "worker-note", expectedBlockUpdatedAt: current.settings.layout.blocks.find(b => b.id === "worker-note").updatedAt, expectedRuntimeUpdatedAt: current.runtime.updatedAt });
  assert.equal((await view()).runtime.notes["worker-note"] ?? "", "");
  for (const id of ["worker-timer", "worker-pomodoro"]) {
    await ok({ type: "clock-action", instanceId: id, action: "start" });
    assert.equal((await view()).runtime.clocks[id].running, true);
    const token = (await view()).runtime.clocks[id].completionToken;
    await ok({ type: "clock-action", instanceId: id, action: "start" });
    assert.equal((await view()).runtime.clocks[id].completionToken, token);
    await ok({ type: "clock-action", instanceId: id, action: "pause" });
    assert.equal((await view()).runtime.clocks[id].running, false);
    await ok({ type: "clock-action", instanceId: id, action: "pause" });
    await ok({ type: "clock-action", instanceId: id, action: "reset" });
  }
  await ok({ type: "clock-action", instanceId: "worker-timer", action: "start" });
  const token = (await view()).runtime.clocks["worker-timer"].completionToken;
  await ok({ type: "complete-clock", instanceId: "worker-timer", token: "stale" });
  assert.equal((await view()).runtime.clocks["worker-timer"].running, true);
  await until(() => Date.now() >= (control.state.startPageRuntimeState.clocks["worker-timer"].startedAt ?? Date.now()) + 1100, "timer deadline");
  await ok({ type: "complete-clock", instanceId: "worker-timer", token });
  assert.equal((await view()).runtime.clocks["worker-timer"].running, false);
  assert.ok(control.calls.some(c => c[0] === "notification"));
  await ok({ type: "clock-action", instanceId: "worker-timer", action: "reset" });
  await ok({ type: "clock-action", instanceId: "worker-timer", action: "start" });
  const failedNoticeToken = (await view()).runtime.clocks["worker-timer"].completionToken;
  const originalNotice = chrome.notifications.create;
  chrome.notifications.create = async () => { throw new Error("notifications unavailable"); };
  await until(() => Date.now() >= control.state.startPageRuntimeState.clocks["worker-timer"].startedAt + 1100, "second timer deadline");
  const failedNotice = await ok({ type: "complete-clock", instanceId: "worker-timer", token: failedNoticeToken });
  assert.equal((await view()).runtime.clocks["worker-timer"].running, false);
  chrome.notifications.create = originalNotice;
  await ok({ type: "reset-clocks" });
  await ok({ type: "reset-stats" });
  assert.equal((await getFocusStats()).totals.unblocksAfterCountdown, 0);
  current = await view();
  const changed = structuredClone(current.settings);
  changed.layout.gap = 17;
  const result = await ok({ type: "replace-start-page-settings", settings: changed, expectedSettingsUpdatedAt: current.settings.updatedAt, expectedRuntimeUpdatedAt: current.runtime.updatedAt });
  assert.equal(result.savedSettings.layout.gap, 17);
  await reject({ type: "replace-start-page-settings", settings: changed, expectedSettingsUpdatedAt: current.settings.updatedAt, expectedRuntimeUpdatedAt: current.runtime.updatedAt }, /changed/);
  control.tab = { id: 1, url: "chrome://newtab/" };
  chrome.tabs.onCreated.emit(control.tab);
  await until(() => control.calls.some(c => c[0] === "update" && c[2]?.url === "https://extension.example/newtab.html"), "new tab redirect");
  const redirects = control.calls.length;
  control.tab = { id: 1, url: "chrome://newtab/split-view" };
  chrome.tabs.onUpdated.emit(1, { url: control.tab.url });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(control.calls.length, redirects);
  chrome.tabs.onRemoved.emit(1);
  await ok({ type: "reset-start-page" });
  assert.ok((await view()).settings.layout.blocks.length > 5);
  chrome.runtime.onStartup.emit();
  chrome.runtime.onInstalled.emit();
  await new Promise(r => setTimeout(r, 50));
  const api = await import("../src/lib/start-page-settings.js");
  const themes = await import("../src/lib/start-page-theme-validation.js");
  const defaults = await import("../src/lib/start-page-defaults.js");
  const fallback = defaults.BUILT_IN_THEMES[0];
  const solid = themes.normalizeTheme({ ...fallback, background: { kind: "solid", color: "#123456" } }, fallback);
  assert.equal(solid.background.kind, "solid");
  assert.deepEqual(themes.normalizeTheme(null, fallback), fallback);
  for (const effect of ["animated-gradient", "aurora", "mesh", "spotlight", "noise", "matrix", "cyberpunk"]) {
    const normalized = themes.normalizeTheme({ background: { kind: "effect", config: { effect, speed: 100, intensity: 100, angle: -30, blur: -5, density: 100, scale: 100, size: 100, colors: ["#fff", "#000"], animated: true, scanlines: true } } }, solid);
    assert.equal(normalized.background.kind, "effect");
    assert.equal(normalized.background.config.effect, effect);
    assert.ok(normalized.background.config.speed <= 4);
    assert.ok(normalized.background.config.intensity <= 1);
  }
  assert.equal(themes.migrateLegacyTheme({}, []), null);
  for (const effect of ["gradient", "aurora", "mesh", "spotlight", "noise", "none"]) {
    const migrated = themes.migrateLegacyTheme({ appearance: { backgroundEffect: effect, backgroundColor: "#123456", baseFontSize: 16 } }, []);
    assert.equal(migrated.builtIn, false);
    assert.equal(migrated.background.kind, effect === "none" ? "solid" : "effect");
    if (effect !== "none") assert.equal(migrated.background.config.effect, effect === "gradient" ? "animated-gradient" : effect);
  }
  assert.equal(themes.migrateLegacyTheme({ appearance: { backgroundImage: "https://example.com/bg.png" } }, []).background.kind, "image");
  const issues = [];
  const rejectedImage = themes.normalizeTheme({ background: { kind: "image", url: "javascript:bad()" } }, solid, "theme", issues);
  assert.equal(rejectedImage.background.kind, "solid");
  assert.ok(issues.some(x => x.messageKey === "validationInvalidUrl"));
  const distinct = themes.normalizeCustomThemes([fallback, fallback], []);
  assert.equal(new Set(distinct.map(x => x.id)).size, 2);
  assert.ok(distinct.every(x => !x.builtIn && x.id !== fallback.id));
  await assert.rejects(api.importCustomTheme({}), /Invalid Start Tab theme file/);
  await assert.rejects(api.updateCustomTheme(fallback), /Built-in/);
  await assert.rejects(api.deleteCustomTheme(fallback.id), /Built-in/);
  await assert.rejects(api.selectTheme("absent"), /Theme not found/);
  await assert.rejects(api.duplicateTheme("absent"), /Theme not found/);
  const draft = await api.createCustomTheme(" Draft ");
  assert.equal(draft.name, "Draft");
  const saved = await api.updateCustomTheme(draft);
  assert.equal(saved.id, draft.id);
  const imported = await api.importCustomTheme(api.exportCustomTheme(saved));
  assert.notEqual(imported.theme.id, saved.id);
  assert.equal(imported.theme.name, "Draft");
  await api.selectTheme(saved.id);
  await api.deleteCustomTheme(imported.theme.id);
  assert.equal((await api.getStartPageSettings()).themes.selectedThemeId, saved.id);
  await api.deleteCustomTheme(saved.id);
  await api.deleteCustomTheme(saved.id);
  assert.notEqual((await api.getStartPageSettings()).themes.selectedThemeId, saved.id);
  await assert.rejects(api.deleteCustomTheme(saved.id, saved.updatedAt), /changed or was removed/);
  await assert.rejects(api.updateCustomTheme(saved, saved.updatedAt), /changed or was removed/);
  assert.equal((await api.setLayoutMode("free")).layout.mode, "free");
  const zone = (await api.getStartPageSettings()).layout.zone;
  assert.equal((await api.setLayoutZone(zone)).layout.zone, zone);
  const block = await api.addBlockInstance("note");
  assert.equal(block.type, "note");
  console.log("Theme normalization and storage: effects, legacy migration, invalid image, duplicate IDs, CRUD, import/export and layout APIs");
  console.log("Worker: real message router, blocklist, document validation, runtime CAS, clocks, notifications, redirect and startup");
} finally { restoreFetch(); }
