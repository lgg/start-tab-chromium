import assert from "node:assert/strict";
import { installDom, installChrome, installFetch, one, until, delay, value, event } from "./ui-fixture-dom.mjs";
import { createDefaultStartPageSettings } from "../src/lib/start-page-settings.js";
import { normalizeRuntimeState } from "../src/lib/start-page-runtime.js";
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
      await until(()=>!clear.disabled);
      assert.ok(one(document,"#note").textContent.length>0);
      assert.equal(control.messages.length,1);
    }finally{dom.window.close()}
  }
  // The host action may commit after the user navigates to another
  // document on that host. The optional reload must not interrupt it.
  {
    const dom=await installDom("popup/popup.html");
    const control=installChrome(seed());
    control.tab={id:1,url:"https://blocked.example/first"};
    const originalClose=window.close.bind(window);
    try{
      let closed=0;
      window.close=()=>{closed++};
      await import("../src/popup/popup.ts?residual="+(++serial));
      const primary=one(document,"#primary");
      await until(()=>!primary.hidden&&!primary.disabled);
      let release;
      control.handler=()=>new Promise(resolve=>{release=resolve});
      primary.click();await until(()=>release);
      assert.equal(control.messages.length,1);
      assert.equal(control.messages[0].type,"unblock");
      control.tab={id:1,url:"https://blocked.example/second"};
      control.state.blockedSites=[];
      release({ok:true,changed:true});
      await until(()=>closed===1&&!primary.disabled);
      assert.equal(control.calls.some(call=>Array.isArray(call)&&call[0]==="reload"),false);
      assert.deepEqual(control.state.blockedSites,[]);
    }finally{window.close=originalClose;dom.window.close()}
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
      const originalLocation=globalThis.location;
      let reloads=0;
      globalThis.location={search:originalLocation.search,reload:()=>reloads++,replace:()=>{throw Error("stale redirect")}};
      try{
        await import("../src/blocked/blocked.ts?residual="+(++serial));
        await until(()=>release,"blocked startup "+stage);
        assert.equal(one(document,"#unblock").disabled,true);
        assert.equal(one(document,"#cancel").disabled,true);
        window.dispatchEvent(new window.Event("pagehide"));
        // Simulate the site being removed while the blocklist read is pending.
        // Neither an original-URL lookup nor a redirect may follow disposal.
        control.state.blockedSites=[];
        const shown=new window.Event("pageshow");
        Object.defineProperty(shown,"persisted",{value:true});
        window.dispatchEvent(shown);
        assert.equal(reloads,1,stage+" BFCache restore before startup completes");
        await release();await delay(30);
        one(document,"#unblock").click();
        assert.equal(control.messages.length,0);
        assert.equal(one(document,"#countdown").hidden,true);
      }finally{globalThis.location=originalLocation}
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

  // Opening the start tab may fail on a restricted browser. Report the
  // actual Error while leaving the rest of the settings page usable.
  {
    const dom=await installDom("options/options.html");
    const control=installChrome(seed());
    control.chrome.runtime.getManifest=()=>({chrome_url_overrides:{newtab:"newtab.html"}});
    try{
      const {loadI18n}=await import("../src/lib/i18n.js");
      const t=await loadI18n();
      await import("../src/options/options.ts?residual="+(++serial));
      await until(()=>document.querySelector("#statistics .stats-grid"));
      const open=[...one(document,"#headerActions").querySelectorAll("button")].find(b=>b.textContent===t.t("openStartTab"));
      assert.ok(open);
      const create=control.chrome.tabs.create;
      control.chrome.tabs.create=async()=>{throw Error("browser refused tab creation")};
      open.click();
      await until(()=>one(document,"#status").textContent==="browser refused tab creation");
      assert.equal(one(document,"#status").dataset.error,"true");
      assert.ok(document.querySelector("#general form"));
      control.chrome.tabs.create=create;
      open.click();await until(()=>control.calls.some(c=>c[0]==="create"));
    }finally{dom.window.close()}
  }

  // Non-Error failures during initial storage reads must be visible in
  // the correct page region and must not arm partially initialized UI.
  for(const [page,module,selector] of [
    ["newtab/newtab.html","../src/newtab/newtab.ts","#grid .fatal-error"],
    ["options/options.html","../src/options/options.ts","#status"]
  ]){
    const dom=await installDom(page);
    const control=installChrome(seed());
    control.chrome.storage.local.get=async()=>{throw "initial storage connection lost"};
    try{
      await import(module+"?init-failure="+(++serial));
      await until(()=>document.querySelector(selector)?.textContent==="initial storage connection lost");
      assert.equal(control.messages.length,0);
      if(page.startsWith("options"))assert.equal(one(document,"#status").dataset.error,"true");
    }finally{dom.window.close()}
  }

  // A page may be closed while a canonical storage snapshot, a locale read
  // or an onboarding read is queued. Late replies must not repaint the old
  // page or schedule new commands after pagehide disposes its listeners.
  for(const stage of ["settings","locale","onboarding"]){
    const dom=await installDom("newtab/newtab.html","https://extension.example/newtab.html");
    // Use a synchronous card so this race measures the late page snapshot,
    // not independent network requests completing on the still-connected DOM.
    const initial=seed();
    initial.startPageSettings=structuredClone(initial.startPageSettings);
    initial.startPageSettings.layout.blocks=initial.startPageSettings.layout.blocks.filter(block=>block.type==="note");
    initial.startPageRuntimeState=normalizeRuntimeState(undefined,initial.startPageSettings);
    const control=installChrome({...initial,startPageOnboarding:{onboarded:true}});
    const get=control.chrome.storage.local.get;
    try{
      await import("../src/newtab/newtab.ts?dispose="+(++serial));
      await until(()=>document.querySelector("#grid [data-block-id]"));
      const original=one(document,"#grid").innerHTML;
      let release;
      control.chrome.storage.local.get=keys=>{
        const match=stage==="settings"?Array.isArray(keys)&&keys.includes("startPageSettings")&&keys.includes("startPageRuntimeState"):
          stage==="locale"?keys==="localeOverride":keys==="startPageOnboarding";
        if(match&&!release)return new Promise(resolve=>{release=async()=>resolve(await get(keys))});
        return get(keys);
      };
      if(stage==="settings"){
        control.state.startPageSettings.layout.blocks=[];
        control.chrome.storage.onChanged.emit({startPageSettings:{newValue:control.state.startPageSettings}},"local");
      }else if(stage==="locale"){
        control.state.localeOverride="ru";
        control.chrome.storage.onChanged.emit({localeOverride:{newValue:"ru"}},"local");
      }else{
        control.state.startPageOnboarding={onboarded:false};
        control.chrome.storage.onChanged.emit({startPageOnboarding:{newValue:{onboarded:false}}},"local");
      }
      await until(()=>release,"pending "+stage);
      window.dispatchEvent(new window.Event("pagehide"));
      await release();await delay(50);
      assert.equal(one(document,"#grid").innerHTML,original,stage);
      assert.equal(document.getElementById("onboarding"),null);
      assert.equal(control.messages.length,0);
    }finally{control.chrome.storage.local.get=get;dom.window.close()}
  }

  // A non-Error rejection from a browser API after successful startup must
  // be reported through the live-region path, not as an unhandled rejection.
  {
    const dom=await installDom("newtab/newtab.html");
    const s=structuredClone(settings);
    s.layout.blocks=s.layout.blocks.filter(b=>b.type==="note");
    const control=installChrome({...seed(),startPageSettings:s,startPageRuntimeState:normalizeRuntimeState(undefined,s),startPageOnboarding:{onboarded:true}});
    try{
      await import("../src/newtab/newtab.ts?nonerror="+(++serial));
      await until(()=>document.querySelector("#grid [data-block-id]"));
      control.chrome.runtime.openOptionsPage=async()=>{throw "options transport refused"};
      one(document,"#settings").click();
      await until(()=>[...document.querySelectorAll('[role="status"],[aria-live]')].some(el=>el.textContent==="options transport refused"));
      assert.equal(control.messages.length,0);
      window.dispatchEvent(new window.Event("pagehide"));
    }finally{dom.window.close()}
  }

  // During the final startup locale reconciliation, pagehide may arrive
  // before a first render. Do not mount the old page after that read settles.
  {
    const dom=await installDom("newtab/newtab.html");
    const s=structuredClone(settings);
    s.layout.blocks=s.layout.blocks.filter(b=>b.type==="note");
    const control=installChrome({...seed(),startPageSettings:s,startPageRuntimeState:normalizeRuntimeState(undefined,s),startPageOnboarding:{onboarded:true}});
    const store=control.chrome.storage.local,get=store.get;
    let localeReads=0,release,reloads=0;
    const actualLocation=globalThis.location;
    try{
      globalThis.location={reload:()=>{reloads++}};
      store.get=keys=>{
        if(keys==="localeOverride"&&++localeReads===2)return new Promise(resolve=>{release=async()=>resolve(await get(keys))});
        return get(keys);
      };
      await import("../src/newtab/newtab.ts?init-dispose="+(++serial));
      await until(()=>release,"final startup locale read");
      window.dispatchEvent(new window.Event("pagehide"));
      await release();
      await delay(40);
      assert.equal(document.querySelector("#grid [data-block-id]"),null);
      assert.equal(document.getElementById("onboarding"),null);
      assert.equal(reloads,0);
    }finally{store.get=get;globalThis.location=actualLocation;dom.window.close()}
  }

  // Two real gate events enqueue independent snapshot refreshes. Once
  // the page is disposed, the second queued refresh must never read storage.
  {
    const dom=await installDom("newtab/newtab.html");
    const s=structuredClone(settings);
    s.layout.blocks=s.layout.blocks.filter(b=>b.type==="note");
    const control=installChrome({...seed(),startPageSettings:s,startPageRuntimeState:normalizeRuntimeState(undefined,s),startPageOnboarding:{onboarded:true}});
    const store=control.chrome.storage.local,get=store.get;
    let release,reads=0;
    try{
      await import("../src/newtab/newtab.ts?queued-dispose="+(++serial));
      await until(()=>document.querySelector("#grid [data-block-id]"));
      const markup=one(document,"#grid").innerHTML;
      store.get=keys=>{
        if(Array.isArray(keys)&&keys.includes("startPageSettings")&&keys.includes("startPageRuntimeState")){
          reads++;
          if(reads===1)return new Promise(resolve=>{release=async()=>resolve(await get(keys))});
        }
        return get(keys);
      };
      window.dispatchEvent(new window.Event("start-tab-gate-change"));
      await until(()=>release,"first gate refresh");
      window.dispatchEvent(new window.Event("start-tab-gate-change"));
      window.dispatchEvent(new window.Event("pagehide"));
      await release();
      await delay(50);
      assert.equal(reads,1);
      assert.equal(one(document,"#grid").innerHTML,markup);
      assert.equal(control.messages.length,0);
    }finally{store.get=get;dom.window.close()}
  }

  // Web Locks releases the exclusive lease when its callback settles;
  // delivery of the request's result is asynchronous. Model that boundary,
  // not an out-of-order storage write, and let a new Options generation
  // finish while the prior Statistics result is still in transit.
  for(const oldFailure of [false,true]){
    const dom=await installDom("options/options.html");
    const control=installChrome(seed());
    const store=control.chrome.storage.local,get=store.get;
    const tails=new Map();
    let active=null,firstStats=true,release;
    Object.defineProperty(navigator,"locks",{configurable:true,value:{
      request(name,options,callback){
        const request={hold:false};
        const prev=tails.get(name)??Promise.resolve();
        const execution=prev.catch(()=>{}).then(async()=>{
          active=request;
          try{return await callback({name,mode:options.mode})}
          finally{active=null}
        });
        tails.set(name,execution.then(()=>{},()=>{}));
        return execution.then(value=>request.hold
          ? new Promise((resolve,reject)=>{release=()=>oldFailure?reject(Error("obsolete statistics delivery")):resolve(value)})
          : value);
      }
    }});
    store.get=async keys=>{
      if(keys==="focusStats"&&firstStats){firstStats=false;assert.ok(active);active.hold=true}
      return get(keys);
    };
    try{
      const t=await (await import("../src/lib/i18n.js")).loadI18n();
      await import("../src/options/options.ts?stats-delivery="+(++serial));
      await until(()=>release,"old statistics delivery");
      const clear=[...one(document,"#blocker").querySelectorAll("button")].find(b=>b.textContent===t.t("clearBlocklist"));
      assert.ok(clear);
      control.handler=async m=>{
        assert.equal(m.type,"clear");
        control.state.blockedSites=[];
        return {ok:true};
      };
      clear.click();
      await until(()=>document.querySelector("#statistics .stats-grid")&&document.body.getAttribute("aria-busy")!=="true","new statistics generation");
      const latest=one(document,"#statistics");
      const status=one(document,"#status").textContent;
      release();await delay(50);
      assert.equal(document.querySelectorAll("#statistics").length,1);
      assert.equal(one(document,"#statistics"),latest);
      assert.equal(one(document,"#status").textContent,status);
      assert.equal(control.messages.length,1);
    }finally{store.get=get;delete navigator.locks;dom.window.close()}
  }

  // An onboarding event can be the only event observed after a concurrent
  // committed layout change. Its refresh must repaint the new snapshot,
  // rather than show the onboarding dialog over the previous layout.
  {
    const dom=await installDom("newtab/newtab.html");
    const s=structuredClone(settings);
    s.layout.blocks=s.layout.blocks.filter(b=>b.type==="note");
    const control=installChrome({...seed(),startPageSettings:s,startPageRuntimeState:normalizeRuntimeState(undefined,s),startPageOnboarding:{onboarded:true}});
    try{
      await import("../src/newtab/newtab.ts?onboarding-snapshot="+(++serial));
      await until(()=>document.querySelector("#grid [data-block-id]"));
      const original=one(document,"#grid [data-block-id]");
      const next=structuredClone(control.state.startPageSettings);
      next.layout.blocks[0].title="Latest committed scratchpad";
      next.updatedAt++;
      control.state.startPageSettings=next;
      control.state.startPageOnboarding={onboarded:false};
      control.chrome.storage.onChanged.emit({startPageOnboarding:{newValue:{onboarded:false}}},"local");
      await until(()=>document.getElementById("onboarding")&&!original.isConnected);
      assert.equal(one(document,"#grid .card__title").textContent,"Latest committed scratchpad");
      assert.equal(control.messages.length,0);
      window.dispatchEvent(new window.Event("pagehide"));
    }finally{dom.window.close()}
  }

  // pagehide may occur before init has registered its ordinary listeners,
  // including while the locale catalog or initial settings snapshot waits.
  for(const stage of ["locale","snapshot"]){
    const dom=await installDom("newtab/newtab.html");
    const s=structuredClone(settings);
    s.layout.blocks=s.layout.blocks.filter(b=>b.type==="note");
    const control=installChrome({...seed(),startPageSettings:s,startPageRuntimeState:normalizeRuntimeState(undefined,s),startPageOnboarding:{onboarded:true}});
    const store=control.chrome.storage.local,get=store.get,loc=globalThis.location;
    let release,reads=0,reloads=0,opened=0;
    try{
      globalThis.location={reload:()=>{reloads++}};
      control.chrome.runtime.openOptionsPage=async()=>{opened++};
      store.get=keys=>{
        reads++;
        const match=stage==="locale"?keys==="localeOverride":Array.isArray(keys)&&keys.includes("startPageSettings")&&keys.includes("startPageRuntimeState");
        if(match&&!release)return new Promise(resolve=>{release=async()=>resolve(await get(keys))});
        return get(keys);
      };
      await import("../src/newtab/newtab.ts?early-pagehide="+(++serial));
      await until(()=>release,"early "+stage);
      window.dispatchEvent(new window.Event("pagehide"));
      await release();
      await delay(50);
      assert.equal(document.querySelector("#grid [data-block-id]"),null,stage);
      assert.equal(document.getElementById("onboarding"),null,stage);
      const before=reads;
      one(document,"#settings").click();
      control.chrome.storage.onChanged.emit({startPageSettings:{newValue:s}},"local");
      await delay(30);
      assert.equal(reads,before,stage);
      assert.equal(opened,0);
      assert.equal(control.messages.length,0);
      const shown=new window.Event("pageshow");
      Object.defineProperty(shown,"persisted",{value:true});
      window.dispatchEvent(shown);
      assert.equal(reloads,1);
    }finally{store.get=get;globalThis.location=loc;dom.window.close()}
  }
  console.log("Residual page races: shared popup lease, initialization failures, blocked page disposal and external onboarding completion");
}finally{globalThis.fetch=catalog;restoreFetch()}
