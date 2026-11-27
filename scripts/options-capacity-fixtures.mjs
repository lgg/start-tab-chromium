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
