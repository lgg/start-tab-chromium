import assert from "node:assert/strict";
import { installDom, installChrome, installFetch, one, until, delay, value, event } from "./ui-fixture-dom.mjs";
import { createDefaultStartPageSettings } from "../src/lib/start-page-settings.js";
import { normalizeRuntimeState } from "../src/lib/start-page-runtime.js";
import { loadI18n } from "../src/lib/i18n.js";
const restoreFetch=installFetch();
const catalog=globalThis.fetch;
const settings=createDefaultStartPageSettings(100);
const seed=()=>({startPageSettings:settings,startPageRuntimeState:normalizeRuntimeState(undefined,settings),blockedSites:["blocked.example"],localeOverride:"en"});
let serial=0;
try{
  // All three popup controls share one lease, even if DOM events are
  // dispatched while the real controls are disabled.
  {
    const dom=await installDom("popup/popup.html");
    const control=installChrome(seed());
    control.tab={id:1,url:"https://blocked.example/path"};
    try{
      await import("../src/popup/popup.ts?residual="+(++serial));
      const primary=one(document,"#primary"),clear=one(document,"#clear"),lang=one(document,"#language");
      await until(()=>!primary.hidden&&!primary.disabled);
      let release;
      control.handler=()=>new Promise(resolve=>{release=resolve});
      primary.click();await until(()=>release);
      assert.equal(primary.disabled,true);assert.equal(clear.disabled,true);assert.equal(lang.disabled,true);
      event(primary,"click");event(clear,"click");value(lang,"ru","change");
      await delay(20);
      assert.equal(control.messages.length,1);
      assert.equal(control.state.localeOverride,"en");
      release({ok:false,error:"worker unavailable"});
      await until(()=>!primary.disabled);
      assert.equal(one(document,"#note").textContent,"worker unavailable");
      assert.deepEqual(control.state.blockedSites,["blocked.example"]);
      control.chrome.storage.local.get=async()=>{throw null};
      clear.click();
      const t=await loadI18n().catch(()=>null);
      await until(()=>!clear.disabled);
      assert.ok(one(document,"#note").textContent.length>0);
      assert.equal(control.messages.length,1);
    }finally{dom.window.close()}
  }
  // A non-Error platform failure during popup initialization gets a
  // readable fallback even before the locale catalog is loaded.
  {
    const dom=await installDom("popup/popup.html");
    const control=installChrome(seed());
    control.chrome.storage.local.get=async()=>{throw null};
    try{
      await import("../src/popup/popup.ts?residual="+(++serial));
      await until(()=>one(document,"#note").textContent==="Something went wrong");
      assert.equal(one(document,"#primary").disabled,true);
      assert.equal(one(document,"#clear").disabled,true);
    }finally{dom.window.close()}
  }
  // A blocked page closed during asynchronous startup must not arm any
  // interaction or replace its DOM after the committed read completes.
  for(const stage of ["locale","blocklist"]){
    const dom=await installDom("blocked/blocked.html","https://extension.example/blocked.html?site=blocked.example");
    const control=installChrome(seed());
    const get=control.chrome.storage.local.get;
    let release;
    control.chrome.storage.local.get=keys=>{
      const matches=stage==="locale"?keys==="localeOverride":keys==="blockedSites";
      if(matches&&!release)return new Promise(resolve=>{release=async()=>resolve(await get(keys))});
      return get(keys);
    };
    try{
      await import("../src/blocked/blocked.ts?residual="+(++serial));
      await until(()=>release,"blocked startup "+stage);
      window.dispatchEvent(new window.Event("pagehide"));
      await release();await delay(30);
      one(document,"#unblock").click();
      assert.equal(control.messages.length,0);
      assert.equal(one(document,"#countdown").hidden,true);
    }finally{dom.window.close()}
  }
  // A failed startup read may reject with a string rather than Error.
  {
    const dom=await installDom("blocked/blocked.html","https://extension.example/blocked.html?site=blocked.example");
    const control=installChrome(seed());
    control.chrome.storage.local.get=async()=>{throw "storage disconnected"};
    try{
      await import("../src/blocked/blocked.ts?residual="+(++serial));
      await until(()=>!one(document,"#unblockError").hidden);
      assert.equal(one(document,"#unblockError").textContent,"storage disconnected");
      assert.equal(one(document,"#unblock").disabled,true);
    }finally{dom.window.close()}
  }
  // An onboarding completion event from another tab dismisses the modal
  // without writing settings or emitting a second completion command.
  {
    const dom=await installDom("newtab/newtab.html");
    const control=installChrome({...seed(),startPageOnboarding:{onboarded:false}});
    try{
      await import("../src/newtab/newtab.ts?residual="+(++serial));
      await until(()=>document.getElementById("onboarding"));
      control.state.startPageOnboarding={onboarded:true};
      control.chrome.storage.onChanged.emit({startPageOnboarding:{newValue:{onboarded:true}}},"local");
      await until(()=>!document.getElementById("onboarding"));
      assert.equal(one(document,"#startPage").hasAttribute("inert"),false);
      assert.equal(control.messages.length,0);
      window.dispatchEvent(new window.Event("pagehide"));
    }finally{dom.window.close()}
  }
  console.log("Residual page races: shared popup lease, initialization failures, blocked page disposal and external onboarding completion");
}finally{globalThis.fetch=catalog;restoreFetch()}
