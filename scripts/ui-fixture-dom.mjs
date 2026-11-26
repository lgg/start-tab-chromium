import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
function resolveJsdom() {
  try { return require("jsdom"); } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
  }
  for (const bin of (process.env.PATH ?? "").split(path.delimiter)) {
    if (path.basename(bin) !== ".bin" || path.basename(path.dirname(bin)) !== "node_modules") continue;
    const candidate = createRequire(path.join(path.dirname(bin), "fixture-resolver.cjs"));
    try { return candidate("jsdom"); } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") throw error;
    }
  }
  throw new Error("jsdom not found in npm exec environment");
}
const { JSDOM } = resolveJsdom();
export const delay = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
export async function until(check, label = "UI condition", timeout = 2500) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Timed out: " + label);
    await delay(10);
  }
}
export function one(root, selector) {
  const item = root.querySelector(selector);
  assert.ok(item, "Missing element: " + selector);
  return item;
}
export function button(root, label) {
  const item = [...root.querySelectorAll("button")].find(el => el.textContent === label || el.getAttribute("aria-label") === label);
  assert.ok(item, "Missing button: " + label);
  return item;
}
export function field(root, label) {
  const item = [...root.querySelectorAll("label")].find(el => el.querySelector(".settings-field__label")?.textContent === label);
  assert.ok(item, "Missing field: " + label);
  return one(item, "input,select,textarea");
}
export function event(el, type) { return el.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true })); }
export function value(el, next, type = "input") { el.value = String(next); event(el, type); }
export const submit = el => event(el, "submit");
export const key = (el, key, options = {}) => el.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
export function pointer(el, type, x, y, id = 1, button = 0) {
  const e = new window.MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true });
  Object.defineProperty(e, "pointerId", { value: id });
  el.dispatchEvent(e);
}
export const i18n = { locale: "en", t: (k, v = {}) => k + (Object.keys(v).length ? ":" + Object.values(v).join(",") : ""), list: () => ["message"] };
export async function installDom(page = "", url = "https://extension.example/") {
  const html = page ? await readFile(path.join(root, "src", page), "utf8") : "<!doctype html><html><body></body></html>";
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  const win = dom.window;
  for (const name of ["window", "document", "navigator", "location", "HTMLElement", "HTMLInputElement", "HTMLSelectElement",
    "HTMLTextAreaElement", "HTMLButtonElement", "HTMLDialogElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent",
    "MouseEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
    const v = name === "window" ? win : win[name];
    Object.defineProperty(globalThis, name, { value: typeof v === "function" && ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(name) ? v.bind(win) : v, configurable: true, writable: true });
  }
  // jsdom does not implement modal dialogs or pointer capture. Polyfill only
  // these platform primitives; all application listeners and DOM are real.
  win.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  win.HTMLDialogElement.prototype.close = function (result = "") { this.returnValue = result; this.removeAttribute("open"); this.dispatchEvent(new win.Event("close")); };
  win.HTMLElement.prototype.setPointerCapture = function (id) { this.fixturePointer = id; };
  win.HTMLElement.prototype.hasPointerCapture = function (id) { return this.fixturePointer === id; };
  win.HTMLElement.prototype.releasePointerCapture = function () { delete this.fixturePointer; };
  win.confirm = () => true;
  return dom;
}
export function host() {
  const el = document.createElement("div"); document.body.append(el); return el;
}
export function browserEvent() {
  const listeners = new Set();
  return { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f), emit: (...args) => [...listeners].map(f => f(...args)), listeners };
}
export function installChrome(initial = {}) {
  const state = structuredClone(initial);
  const messages = [], calls = [], alarms = new Map();
  let rules = [];
  const copy = v => structuredClone(v);
  function area(data) {
    return {
      get: async (keys = null) => Object.fromEntries((keys === null ? Object.keys(data) : typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys)).filter(k => Object.hasOwn(data,k) || (keys && typeof keys === "object" && !Array.isArray(keys) && Object.hasOwn(keys,k))).map(k => [k, copy(Object.hasOwn(data,k) ? data[k] : keys[k])])),
      set: async items => { Object.assign(data, copy(items)); },
      remove: async keys => { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; },
    };
  }
  const control = { state, messages, calls, alarms, tab: { id: 1, url: "https://example.com/", active: true }, oauth: false, handler: async () => ({ ok: true }) };
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "3.0.0", ...(control.oauth ? { oauth2: { client_id: "test.apps.googleusercontent.com" } } : {}) }),
      getURL: p => "https://extension.example/" + p, onMessage: browserEvent(), onInstalled: browserEvent(), onStartup: browserEvent(),
      sendMessage: async message => { messages.push(copy(message)); return control.handler(message); },
      openOptionsPage: async () => { calls.push("options"); },
    },
    storage: { local: area(state), session: area({}), sync: { ...area({}), QUOTA_BYTES: 102400, QUOTA_BYTES_PER_ITEM: 8192 }, onChanged: browserEvent() },
    tabs: { query: async q => q.pinned ? [{ id: 2, title: "Pinned", url: "https://pinned.example/" }] : [copy(control.tab)], get: async () => copy(control.tab),
      getCurrent: async () => copy(control.tab), reload: async id => { calls.push(["reload", id]); }, update: async (id, options) => { calls.push(["update", id, options]); return { id, ...options }; },
      create: async options => { calls.push(["create", options]); return { id: 9, ...options }; }, remove: async id => { calls.push(["remove",id]); },
      onCreated: browserEvent(), onUpdated: browserEvent(), onRemoved: browserEvent() },
    history: { search: async () => [{ title: "History", url: "https://history.example/" }, { title: "Internal", url: "chrome://settings/" }] },
    identity: { getAuthToken: async () => ({ token: "test-token" }), removeCachedAuthToken: async () => {} },
    i18n: { getUILanguage: () => "en", getMessage: k => k },
    webNavigation: { onBeforeNavigate: browserEvent(), getFrame: async () => ({ url: control.tab.url, documentId: "doc", documentLifecycle: "active" }) },
    alarms: { onAlarm: browserEvent(), getAll: async () => [...alarms.values()], get: async name => alarms.get(name), clear: async name => alarms.delete(name),
      create: async (name, info) => { alarms.set(name, { name, scheduledTime: info.when ?? Date.now() }); } },
    notifications: { create: async (...args) => { calls.push(["notification", ...args]); return "notification"; } },
    declarativeNetRequest: {
      RuleActionType: { ALLOW: "allow", ALLOW_ALL_REQUESTS: "allowAllRequests", BLOCK: "block", MODIFY_HEADERS: "modifyHeaders", REDIRECT: "redirect", UPGRADE_SCHEME: "upgradeScheme" },
      ResourceType: { MAIN_FRAME: "main_frame" }, MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES: 5000, MAX_NUMBER_OF_DYNAMIC_RULES: 30000,
      getDynamicRules: async () => copy(rules),
      updateDynamicRules: async ({ removeRuleIds = [], addRules = [] }) => { rules = [...rules.filter(r => !removeRuleIds.includes(r.id)), ...copy(addRules)]; },
    },
  };
  Object.defineProperty(globalThis, "chrome", { value: chrome, configurable: true, writable: true });
  control.chrome = chrome;
  return control;
}
export function installFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.host === "extension.example" && url.pathname.startsWith("/_locales/")) {
      try { return Response.json(JSON.parse(await readFile(path.join(root, "src", url.pathname.slice(1)), "utf8"))); }
      catch (error) { if (error.code !== "ENOENT") throw error; return new Response("", { status: 404 }); }
    }
    if (url.host.includes("geocoding")) return Response.json({ results: [{ latitude: 52, longitude: 4 }] });
    if (url.host.includes("open-meteo")) return Response.json({ current: { temperature_2m: 14, weather_code: 0 }, current_units: { temperature_2m: "°C" }, daily: { time: ["2027-01-01"], temperature_2m_min: [10], temperature_2m_max: [16], weather_code: [61] } });
    if (url.host === "www.googleapis.com") return Response.json({ items: [{ id: "test", summary: "Meeting", start: { dateTime: "2027-01-01T10:00:00Z" }, end: { dateTime: "2027-01-01T11:00:00Z" } }] });
    if (["ipapi.co", "ipwho.is", "api.ipify.org"].includes(url.host)) return Response.json({ ip: "192.0.2.1", country_name: "Test country" });
    throw new Error("Unexpected real network request: " + url);
  };
  return () => { globalThis.fetch = original; };
}
