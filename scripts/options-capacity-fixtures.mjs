import assert from "node:assert/strict";
import { installDom, installChrome, installFetch, one, button, until } from "./ui-fixture-dom.mjs";
import { createDefaultStartPageSettings, createBlockInstance, getTheme } from "../src/lib/start-page-settings.js";
import { normalizeRuntimeState } from "../src/lib/start-page-runtime.js";
import { MAX_START_PAGE_BLOCKS, MAX_CUSTOM_THEMES } from "../src/lib/platform-limits.js";
import { loadI18n } from "../src/lib/i18n.js";

const restoreFetch=installFetch();
const settings=createDefaultStartPageSettings(100);
settings.layout.mode="free";
settings.layout.profile="custom";
settings.layout.blocks=Array.from({length:MAX_START_PAGE_BLOCKS},(_,i)=>createBlockInstance("note",{id:"cap-note-"+i,title:"Note "+i,createdAt:100,updatedAt:100}));
const source=getTheme(settings);
settings.themes.customThemes=Array.from({length:MAX_CUSTOM_THEMES},(_,i)=>({...structuredClone(source),id:"cap-theme-"+i,name:"Theme "+i,builtIn:false,createdAt:100,updatedAt:100,background:{kind:"image",url:"https://example.com/bg.png",fit:"cover",position:"center"}}));
const dom=await installDom("options/options.html");
const control=installChrome({startPageSettings:settings,startPageRuntimeState:normalizeRuntimeState(undefined,settings),localeOverride:"en",blockedSites:[]});
control.oauth=true;
try{
  const t=await loadI18n();
  await import("../src/options/options.ts");
  await until(()=>document.querySelector("#statistics .stats-grid"),"capacity options",10000);
  const blocks=one(document,"#blocks"),themes=one(document,"#themes");
  assert.equal(blocks.querySelectorAll(".instance-row").length,MAX_START_PAGE_BLOCKS);
  assert.equal(button(blocks,t.t("addBlock")).disabled,true);
  assert.ok(button(blocks,t.t("addBlock")).title.includes(String(MAX_START_PAGE_BLOCKS)));
  const first=one(blocks,".instance-row");
  assert.equal(one(first,".instance-row__title").textContent,"Note 0");
  assert.equal(button(first,t.t("duplicate")).disabled,true);
  assert.equal(button(themes,t.t("createTheme")).disabled,true);
  assert.equal(button(themes,t.t("importTheme")).disabled,true);
  assert.ok(themes.textContent.includes(MAX_CUSTOM_THEMES+"/"+MAX_CUSTOM_THEMES));
  assert.ok([...themes.querySelectorAll(".theme-card")].every(card=>button(card,t.t("duplicate")).disabled));
  assert.equal(button(one(document,"#backup"),t.t("driveUpload")).disabled,false);
  assert.equal(button(one(document,"#backup"),t.t("driveRestore")).disabled,false);
  assert.equal(control.messages.length,0);
  console.log("Options capacity: all supported blocks/themes render, create/duplicate/import controls disabled and Google integration enabled");
}finally{restoreFetch();dom.window.close()}


// Statistics errors should render a localized fallback without disabling
// the rest of Options, including when the page was opened at #statistics.
const recoveryFetch=installFetch();
const recoveryDom=await installDom("options/options.html","https://extension.example/options.html#statistics");
const fresh=createDefaultStartPageSettings(100);
const recovery=installChrome({startPageSettings:fresh,startPageRuntimeState:normalizeRuntimeState(undefined,fresh),localeOverride:"en",blockedSites:[]});
let scrolls=0;
window.HTMLElement.prototype.scrollIntoView=function(opts){if(this.id==="statistics"){assert.equal(opts.block,"start");scrolls++}};
const get=recovery.chrome.storage.local.get;
recovery.chrome.storage.local.get=async keys=>{if(keys==="focusStats")throw "statistics bridge unavailable";return get(keys)};
try{
  const t=await loadI18n();
  await import("../src/options/options.ts?case=statistics-recovery");
  await until(()=>document.querySelector("#statistics .empty-state"));
  assert.equal(one(document,"#statistics .empty-state").textContent,t.t("statisticsUnavailable"));
  assert.equal(one(document,"#status").textContent,"statistics bridge unavailable");
  assert.equal(scrolls,1);
  assert.equal(button(one(document,"#backup"),t.t("syncNow")).disabled,false);
  recovery.chrome.storage.local.get=get;
  const {START_PAGE_MIGRATION_REPORT_KEY}=await import("../src/lib/start-page-settings.js");
  await recovery.chrome.storage.local.set({[START_PAGE_MIGRATION_REPORT_KEY]:{fromVersion:1,toVersion:3,migratedBlocks:4,skippedBlocks:2,issues:[]}});
  button(one(document,"#backup"),t.t("syncNow")).click();
  await until(()=>document.querySelector("#statistics .stats-grid"));
  assert.ok(one(document,"#statistics").textContent.includes(t.t("migrationSummary",{from:1,to:3,blocks:4,skipped:2})));
  assert.equal(scrolls,2);
}finally{recovery.chrome.storage.local.get=get;recoveryFetch();recoveryDom.window.close()}


// Exercise the actual Options Drive controls, including rejection before
// any network request and the complete confirmed import transaction.
const driveFetch=installFetch();
const driveCatalog=globalThis.fetch;
const driveDom=await installDom("options/options.html");
const driveSettings=createDefaultStartPageSettings(100);
const drive=installChrome({startPageSettings:driveSettings,startPageRuntimeState:normalizeRuntimeState(undefined,driveSettings),localeOverride:"en",blockedSites:[]});
drive.oauth=true;
try{
  const t=await loadI18n();
  const {exportBackup}=await import("../src/lib/backup.js");
  const bundle=await exportBackup();
  bundle.storage.blockedSites=["drive-restored.example"];
  let requests=0;
  globalThis.fetch=async(url,init)=>{
    const parsed=new URL(url);
    if(parsed.hostname!=="www.googleapis.com")return driveCatalog(url,init);
    requests++;
    if(parsed.searchParams.get("alt")==="media")return Response.json(bundle);
    return Response.json({files:[{id:"drive-file",name:"start-tab-backup.json"}]});
  };
  await import("../src/options/options.ts?case=drive-restore");
  await until(()=>document.querySelector("#statistics .stats-grid"));
  const restore=()=>button(one(document,"#backup"),t.t("driveRestore"));
  window.confirm=()=>false;restore().click();
  assert.equal(requests,0);
  assert.deepEqual(drive.state.blockedSites,[]);
  window.confirm=()=>true;restore().click();
  await until(()=>one(document,"#status").textContent===t.t("driveRestored"));
  assert.equal(requests,2);
  assert.deepEqual(drive.state.blockedSites,["drive-restored.example"]);
  console.log("Options: cancelled and confirmed Google Drive restore");
}finally{driveFetch();driveDom.window.close()}
