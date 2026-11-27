import assert from "node:assert/strict";
import { installDom, installChrome, installFetch, one, button, value, until, delay } from "./ui-fixture-dom.mjs";
import { createDefaultStartPageSettings, createBlockInstance } from "../src/lib/start-page-settings.js";
import { normalizeRuntimeState } from "../src/lib/start-page-runtime.js";
import { loadI18n } from "../src/lib/i18n.js";

const restoreFetch=installFetch();
const settings=createDefaultStartPageSettings(100);
const search=createBlockInstance("search",{id:"locale-search",title:"Private search"});
const note=createBlockInstance("note",{id:"locale-note"});
settings.layout.blocks=[search,note];
const runtime=normalizeRuntimeState(undefined,settings);
const dom=await installDom("newtab/newtab.html","https://extension.example/newtab.html");
const control=installChrome({startPageSettings:settings,startPageRuntimeState:runtime,startPageOnboarding:{onboarded:true},localeOverride:"en"});
const actual=globalThis.location;
let reloads=0;
try{
  const t=await loadI18n();
  await import("../src/newtab/newtab.ts");
  await until(()=>document.querySelector('[data-block-id="locale-search"] input'));
  globalThis.location={reload:()=>{reloads++}};
  const input=()=>one(document,'[data-block-id="locale-search"] input');
  const notice=()=>[...document.querySelectorAll(".draft-recovery:not([hidden])")].find(el=>el.textContent.includes(t.t("localeReloadDeferred")));
  const locale=next=>{control.state.localeOverride=next;control.chrome.storage.onChanged.emit({localeOverride:{newValue:next}},"local")};
  value(input(),"private query");
  locale("ru");
  await until(()=>notice());
  assert.equal(reloads,0);
  assert.equal(input().value,"private query");
  window.confirm=()=>false;
  button(notice(),t.t("localeReloadAction")).click();
  await delay(30);assert.equal(reloads,0);
  assert.equal(input().value,"private query");
  // The committed preference can revert before a click reaches storage.
  control.state.localeOverride="en";
  button(notice(),t.t("localeReloadAction")).click();
  await until(()=>!notice());
  assert.equal(reloads,0);
  locale("ru");await until(()=>notice());
  value(input(),"");
  locale("ru");await delay(30);
  assert.ok(notice());assert.equal(reloads,0);
  // Explicit reload is now allowed without confirmation.
  let confirmations=0;
  window.confirm=()=>{confirmations++;return false};
  button(notice(),t.t("localeReloadAction")).click();
  await until(()=>reloads===1);
  assert.equal(confirmations,0);
  // Re-enter protected work and explicitly accept its discard.
  value(input(),"another private query");
  window.confirm=()=>true;
  button(notice(),t.t("localeReloadAction")).click();
  await until(()=>reloads===2);
  // A real user click can be awaiting a locked locale read when the page
  // closes. A later response must not prompt or navigate a disposed page.
  const store=control.chrome.storage.local, get=store.get;
  let release;
  store.get=keys=>keys==="localeOverride"&&!release
    ? new Promise(resolve=>{release=async()=>resolve(await get(keys))})
    : get(keys);
  let latePrompts=0;
  window.confirm=()=>{latePrompts++;return true};
  button(notice(),t.t("localeReloadAction")).click();
  await until(()=>release);
  window.dispatchEvent(new window.Event("pagehide"));
  await release();
  store.get=get;
  locale("en");await delay(30);
  assert.equal(latePrompts,0);
  assert.equal(reloads,2);
  console.log("Locale page lifecycle: protected search, deferred reload, reverted preference, explicit clean and confirmed reload");
}finally{globalThis.location=actual;restoreFetch();dom.window.close()}
