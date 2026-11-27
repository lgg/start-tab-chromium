import assert from "node:assert/strict";
import { installDom, installChrome, installFetch, one, until, delay, value } from "./ui-fixture-dom.mjs";
import { loadI18n } from "../src/lib/i18n.js";
import { countdownSecondUnitKey } from "../src/blocked/countdown.js";
import { createDefaultStartPageSettings } from "../src/lib/start-page-settings.js";
let serial=0;
const restoreFetch=installFetch();
const catalog=globalThis.fetch;
const originalPerformance=globalThis.performance;
const seed=()=>({startPageSettings:createDefaultStartPageSettings(100),blockedSites:["blocked.example"],localeOverride:"en"});
async function blocked(query,run,options={}){
  const dom=await installDom("blocked/blocked.html","https://extension.example/blocked.html"+query);
  const control=installChrome(seed());
  let now=0,tick;
  Object.defineProperty(globalThis,"performance",{configurable:true,writable:true,value:{now:()=>now}});
  window.setInterval=fn=>{tick=fn;return 1};
  window.clearInterval=()=>{tick=undefined};
  try{
    if(options.inactive)control.state.blockedSites=[];
    if(options.locale)control.state.localeOverride=options.locale;
    if(options.prepare)await options.prepare(control);
    if(options.badCatalog)globalThis.fetch=async()=>new Response(null,{status:404});
    await import("../src/blocked/blocked.ts?case="+(++serial));
    if(options.badCatalog)await until(()=>!one(document,"#unblockError").hidden);
    else if(!options.inactive)await until(()=>one(document,"#site").textContent!=="");
    await run(control,ms=>{now+=ms;tick?.()},()=>tick);
  }finally{globalThis.fetch=catalog;Object.defineProperty(globalThis,"performance",{configurable:true,writable:true,value:originalPerformance});dom.window.close()}
}
try{
  for(const seconds of [0,1,2,4,5,10,11,12,13,14,15,21,22,24,25,101,111,112,114,122]){
    const ru=seconds%10===1&&seconds%100!==11?"secondOne":([2,3,4].includes(seconds%10)&&![12,13,14].includes(seconds%100))?"secondFew":"secondMany";
    assert.equal(countdownSecondUnitKey("ru",seconds),ru);
    assert.equal(countdownSecondUnitKey("en",seconds),seconds===1?"secondOne":"secondMany");
  }
  // A queued callback of a cancelled countdown must not shorten its successor;
  // callbacks queued at expiry must not issue a second unblock transaction.
  await blocked("?site=blocked.example",async(control,advance,getTick)=>{
    let release;
    const unblock=one(document,"#unblock"),cancel=one(document,"#cancel");
    control.handler=m=>m.type==="blocked-original-url"?new Promise(resolve=>{release=resolve}):Promise.resolve({ok:true,changed:true});
    unblock.click();
    const stale=getTick();
    advance(9000);
    cancel.click();
    unblock.click();
    const live=getTick(),initial=one(document,"#countdownText").textContent;
    stale();
    assert.equal(one(document,"#countdownText").textContent,initial);
    assert.equal(getTick(),live);
    advance(10001);
    await until(()=>release);
    live();stale();
    cancel.dispatchEvent(new window.MouseEvent("click",{bubbles:true}));
    assert.equal(cancel.disabled,true);
    assert.equal(control.messages.length,1);
    window.dispatchEvent(new window.Event("pagehide"));
    cancel.dispatchEvent(new window.MouseEvent("click",{bubbles:true}));
    release({ok:true,blockedUrl:"https://blocked.example/"});
    await delay(20);
    assert.deepEqual(control.messages.map(m=>m.type),["blocked-original-url"]);
  });
  // A valid catalog may contain an intentionally empty motivation list.
  await blocked("?site=blocked.example",async control=>{
    const t=await loadI18n();
    assert.equal(one(document,"#message").textContent,t.t("blockedUnknownSiteMessage"));
    assert.equal(one(document,"#unblock").disabled,false);
  },{prepare:async()=>{
    globalThis.fetch=async url=>{
      const response=await catalog(url);
      if(!response.ok)return response;
      const data=await response.json();
      if(data.motivationPhrases)data.motivationPhrases={message:""};
      return Response.json(data);
    };
  }});
  for(const query of ["","?site=","?site=BLOCKED.example","?site=blocked.example&site=other.example","?site=invalid%2Fhost"]){
    await blocked(query,async control=>{
      assert.equal(one(document,"#unblock").disabled,true);
      one(document,"#unblock").click();
      assert.equal(control.messages.length,0);
    });
  }
  await blocked("?site=blocked.example",async(control,advance,getTick)=>{
    let release;
    control.handler=m=>m.type==="blocked-original-url"?new Promise(resolve=>{release=resolve}):Promise.resolve({ok:true,changed:true});
    one(document,"#unblock").click();
    advance(9000);
    assert.match(one(document,"#countdownText").textContent,/1/);
    advance(1001);
    await until(()=>release);
    window.dispatchEvent(new window.Event("pagehide"));
    release({ok:true,blockedUrl:"https://blocked.example/path"});
    await delay(30);
    assert.deepEqual(control.messages.map(m=>m.type),["blocked-original-url"]);
    assert.equal(getTick(),undefined);
    one(document,"#unblock").click();
    assert.equal(getTick(),undefined);
    assert.deepEqual(control.state.blockedSites,["blocked.example"]);
  });
  await blocked("?site=blocked.example",async(control,advance)=>{
    control.handler=async m=>m.type==="blocked-original-url"?{ok:false,error:"no destination"}:{ok:true,changed:false};
    one(document,"#unblock").click();advance(10001);
    await until(()=>control.messages.some(m=>m.type==="unblock"));await delay(10);
    assert.ok(!control.messages.some(m=>m.type==="record-unblock"));
  });
  await blocked("?site=blocked.example",async control=>{
    await until(()=>control.messages.some(m=>m.type==="blocked-original-url"));
    assert.ok(!control.messages.some(m=>m.type==="unblock"));
  },{inactive:true});
  await blocked("?site=blocked.example",async control=>{
    assert.equal(one(document,"#unblock").disabled,true);
    assert.equal(one(document,"#actions").hidden,true);
  },{badCatalog:true});

  for(const locale of ["en","ru"]){
    await blocked("?site=blocked.example",async(control,advance,getTick)=>{
      const t=await loadI18n();
      const count=one(document,"#countdownText");
      const unblock=one(document,"#unblock"),cancel=one(document,"#cancel");
      const units=[[10,"secondMany"],[5,"secondMany"],[4,locale==="ru"?"secondFew":"secondMany"],[2,locale==="ru"?"secondFew":"secondMany"],[1,"secondOne"]];
      unblock.click();
      let previous=10;
      for(const [seconds,unit] of units){
        advance((previous-seconds)*1000);
        assert.equal(count.textContent,t.t("unblockingCountdown",{host:"blocked.example",remaining:seconds,unit:t.t(unit)}));
        previous=seconds;
      }
      cancel.click();assert.equal(getTick(),undefined);
      assert.equal(unblock.disabled,false);
      assert.equal(one(document,"#actions").hidden,false);
      control.handler=async m=>m.type==="blocked-original-url"?{ok:true,blockedUrl:"https://sub.blocked.example/old"}:{ok:false,error:"unblock denied"};
      unblock.click();advance(10001);
      await until(()=>!one(document,"#unblockError").hidden);
      assert.equal(unblock.disabled,false);
      assert.equal(control.messages.filter(m=>m.type==="record-unblock").length,0);
      control.handler=async m=>m.type==="blocked-original-url"?{ok:true,blockedUrl:"https://unrelated.example/"}:m.type==="unblock"?{ok:true,changed:true}:{ok:false,error:"statistics unavailable"};
      unblock.click();advance(10001);
      await until(()=>control.messages.some(m=>m.type==="record-unblock"));
      await delay(20);
      assert.equal(control.messages.filter(m=>m.type==="record-unblock").length,1);
    },{locale});
  }
  await blocked("?site=blocked.example",async(control,advance)=>{
    let release;
    control.handler=m=>m.type==="blocked-original-url"?Promise.resolve({ok:true,blockedUrl:"https://blocked.example/"}):new Promise(resolve=>release=resolve);
    one(document,"#unblock").click();advance(10001);
    await until(()=>release);
    window.dispatchEvent(new window.Event("pagehide"));
    release({ok:true,changed:true});
    await delay(20);
    assert.equal(control.messages.some(m=>m.type==="record-unblock"),false);
  });

  // Verify actual navigation destinations without relying on jsdom's
  // unsupported cross-origin navigation implementation.
  for(const destination of ["https://sub.blocked.example/exact?q=1","https://unrelated.example/path",undefined]){
    await blocked("?site=blocked.example",async(control,advance,getTick)=>{
      const originalLocation=globalThis.location;
      const redirects=[];let reloads=0;
      globalThis.location={search:originalLocation.search,replace:url=>redirects.push(url),reload:()=>reloads++};
      try{
        control.handler=async m=>m.type==="blocked-original-url"?{ok:true,blockedUrl:destination}:{ok:true,changed:true};
        one(document,"#unblock").click();
        const staleTick=getTick();
        one(document,"#unblock").dispatchEvent(new window.MouseEvent("click",{bubbles:true}));
        assert.equal(getTick(),staleTick);
        one(document,"#cancel").click();
        staleTick();
        assert.equal(control.messages.length,0);
        one(document,"#unblock").click();
        advance(10001);
        await until(()=>redirects.length===1);
        assert.equal(redirects[0],destination?.startsWith("https://sub.blocked.example/")?destination:"https://blocked.example/");
        assert.deepEqual(control.messages.map(m=>m.type),["blocked-original-url","unblock","record-unblock"]);
        window.dispatchEvent(new window.Event("pagehide"));
        const show=new window.Event("pageshow");Object.defineProperty(show,"persisted",{value:true});
        window.dispatchEvent(show);
        assert.equal(reloads,1);
      }finally{globalThis.location=originalLocation}
    });
  }
  // A site removed concurrently during the countdown must not be counted
  // as another unblock or re-added, but the page may still leave the interstitial.
  await blocked("?site=blocked.example",async(control,advance)=>{
    const actual=globalThis.location,redirects=[];
    globalThis.location={search:actual.search,replace:url=>redirects.push(url)};
    try{
      control.state.blockedSites=[];
      control.handler=async()=>({ok:true});
      one(document,"#unblock").click();advance(10001);
      await until(()=>redirects.length===1);
      assert.deepEqual(control.messages.map(m=>m.type),["blocked-original-url"]);
      assert.equal(redirects[0],"https://blocked.example/");
    }finally{globalThis.location=actual}
  });

  // Noncanonical numeric IP aliases must not arm the interstitial.
  for(const site of ["127.1","0x7f000001","%E2%98%83.example"]){
    await blocked("?site="+site,async control=>{
      assert.equal(one(document,"#unblock").disabled,true);
      assert.equal(control.messages.length,0);
    });
  }
  // The final statistics acknowledgement may arrive after pagehide. Do not
  // navigate a discarded interstitial even though its unblock has committed.
  await blocked("?site=blocked.example",async(control,advance)=>{
    const actual=globalThis.location,redirects=[];
    globalThis.location={search:actual.search,replace:url=>redirects.push(url)};
    let release;
    try{
      control.handler=async m=>{
        if(m.type==="blocked-original-url")return {ok:true,blockedUrl:"https://blocked.example/path"};
        if(m.type==="unblock"){control.state.blockedSites=[];return {ok:true,changed:true}}
        return new Promise(resolve=>{release=resolve});
      };
      one(document,"#unblock").click();advance(10001);
      await until(()=>release,"pending statistics acknowledgement");
      window.dispatchEvent(new window.Event("pagehide"));
      release({ok:true});
      await delay(30);
      assert.deepEqual(redirects,[]);
      assert.deepEqual(control.state.blockedSites,[]);
      assert.equal(control.messages.filter(m=>m.type==="record-unblock").length,1);
    }finally{globalThis.location=actual}
  });
  // Initial reads may finish after the page has already been disposed.
  // Late success and failure must both leave the original DOM untouched.
  for(const outcome of ["success","failure"]){
    const dom=await installDom("blocked/blocked.html","https://extension.example/blocked.html?site=blocked.example");
    const control=installChrome(seed());
    const get=control.chrome.storage.local.get;
    let release;
    control.chrome.storage.local.get=keys=>keys==="localeOverride"?new Promise((resolve,reject)=>{
      release=async()=>{if(outcome==="failure")reject(Error("locale read interrupted"));else resolve(await get(keys))};
    }):get(keys);
    try{
      const initial=document.body.innerHTML;
      await import("../src/blocked/blocked.ts?disposed="+(++serial));
      await until(()=>release,"pending locale read");
      window.dispatchEvent(new window.Event("pagehide"));
      await release();await delay(30);
      assert.equal(document.body.innerHTML,initial);
      assert.equal(control.messages.length,0);
    }finally{dom.window.close()}
  }
  console.log("Blocked page: malformed URL, stale asynchronous pagehide, already removed, fallback and startup failure");

  async function popup(run,prepare=()=>{}){
    const dom=await installDom("popup/popup.html");
    const control=installChrome(seed());
    control.tab={id:1,url:"https://blocked.example/path"};
    prepare(control);
    try {
      await import("../src/popup/popup.ts?case="+(++serial));
      await until(()=>!one(document,"#note").hidden||!one(document,"#primary").disabled);
      await run(control);
    }finally{globalThis.fetch=catalog;dom.window.close()}
  }
  await popup(async control=>{
    const originalClose=window.close.bind(window);let closed=0;window.close=()=>closed++;
    control.handler=async m=>{assert.equal(m.type,"unblock");control.state.blockedSites=[];return {ok:true,changed:true}};
    control.chrome.tabs.get=async()=>({id:1,url:"https://unrelated.example/"});
    one(document,"#primary").click();await until(()=>closed===1);
    assert.equal(control.messages.at(-1).host,"blocked.example");
    assert.ok(!control.calls.some(c=>c[0]==="reload"));
    window.close=originalClose;
  });
  for(const committed of [true,false]){
    await popup(async control=>{
      control.handler=async m=>{
        control.chrome.tabs.query=async()=>{throw Error("refresh unavailable")};
        if(committed){control.state.blockedSites=[];return {ok:true}}
        return {ok:false,error:"write unavailable"};
      };
      one(document,"#clear").click();
      await until(()=>one(document,"#note").textContent.includes("refresh unavailable"));
      assert.equal(one(document,"#primary").hidden,true);
      assert.equal(one(document,"#clear").disabled,true);
      assert.equal(control.state.blockedSites.length,committed?0:1);
      if(!committed)assert.match(one(document,"#note").textContent,/write unavailable/);
    });
  }
  await popup(async control=>{
    control.state.localeOverride="ru";
    value(one(document,"#language"),"auto","change");
    await until(()=>one(document,"#note").textContent.length>0&&!one(document,"#language").disabled);
    assert.equal(one(document,"#language").value,"ru");
    assert.equal(control.state.localeOverride,"ru");
  });
  await popup(async control=>{
    globalThis.fetch=async()=>new Response(null,{status:404});
    value(one(document,"#language"),"ru","change");
    await until(()=>one(document,"#note").textContent.includes("Unable to load locale catalog"));
    assert.equal(control.state.localeOverride,"ru");
    assert.equal(one(document,"#language").disabled,true);
  });
  await popup(async control=>{
    control.state.localeOverride="ru";
    globalThis.fetch=async()=>new Response(null,{status:404});
    value(one(document,"#language"),"auto","change");
    await until(()=>one(document,"#note").textContent.includes("Unable to load locale catalog"));
    assert.equal(control.state.localeOverride,"ru");
    assert.equal(one(document,"#language").disabled,true);
  });
  await popup(async()=>{
    assert.equal(one(document,"#primary").disabled,true);
    assert.equal(one(document,"#language").disabled,true);
  },()=>{globalThis.fetch=async()=>new Response(null,{status:404})});

  await popup(async control=>{
    control.chrome.tabs.reload=async()=>{throw Error("reload not supported")};
    let closed=0;window.close=()=>closed++;
    control.handler=async()=>({ok:true,changed:true});
    one(document,"#primary").click();
    await until(()=>closed===1);
    assert.equal(control.messages.at(-1).type,"unblock");
  });
  await popup(async control=>{
    window.confirm=()=>false;
    one(document,"#clear").click();await until(()=>!one(document,"#clear").disabled);
    assert.equal(control.messages.length,0);
    window.confirm=()=>true;
    control.handler=async()=>({ok:false,error:"clear refused"});
    one(document,"#clear").click();
    await until(()=>one(document,"#note").textContent.includes("clear refused"));
    assert.equal(one(document,"#clear").disabled,false);
    assert.deepEqual(control.state.blockedSites,["blocked.example"]);
    control.chrome.storage.local.get=async()=>{throw "read refused"};
    one(document,"#clear").click();
    await until(()=>one(document,"#note").textContent.includes("read refused"));
    assert.equal(one(document,"#clear").disabled,false);
  });
  await popup(async control=>{
    control.handler=async()=>({ok:false,error:"block refused"});
    one(document,"#primary").click();
    await until(()=>one(document,"#note").textContent.includes("block refused"));
    assert.equal(control.messages.at(-1).type,"block");
  },control=>{control.tab={id:1,url:"https://new.example/"}}); 
  console.log("Popup: unblock stale tab, committed/failed refresh, locale CAS and catalog failures");
  // Gate starts in the browser's split context even when discovered through
  // an opener rather than window.name. Failure to list tabs must keep the
  // native/Settings fallback usable.
  const gateDom=await installDom("newtab/newtab.html","https://extension.example/newtab.html");
  const gate=installChrome(seed());
  const overlay=()=>document.getElementById("startTabGateOverlay");
  const native=()=>one(overlay(),"[data-native-new-tab]");
  let generation=0;
  window.addEventListener("start-tab-gate-change",()=>generation++);
  try {
    delete gate.state.localeOverride;
    gate.chrome.i18n.getUILanguage=()=>"ru-RU";
    gate.tab={id:1,openerTabId:10,url:"https://extension.example/newtab.html"};
    gate.chrome.tabs.get=async id=>({id,title:"Side-by-side tab picker"});
    gate.chrome.tabs.query=async()=>{throw Error("tabs unavailable")};
    const originalSet=gate.chrome.storage.local.set;
    gate.chrome.storage.local.set=async values=>{
      if(Object.hasOwn(values,"startTabLastNativeNewTabContext"))throw Error("diagnostic denied");
      return originalSet(values);
    };
    await import("../src/newtab/newtab-gate.js?case="+(++serial));
    await window.startTabGateReady;
    assert.ok(overlay());
    assert.equal(overlay().querySelectorAll("button").length,2);
    assert.equal(one(document,"#startPage").hasAttribute("inert"),true);
    assert.equal(document.activeElement,native());
    const panel=one(overlay(),'[role="dialog"]');
    const buttons=[...panel.querySelectorAll("button")];
    for(const b of buttons)b.disabled=true;
    const tabKey=new window.KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true});
    panel.dispatchEvent(tabKey);
    assert.equal(tabKey.defaultPrevented,true);
    assert.equal(document.activeElement,panel);
    for(const b of buttons)b.disabled=false;
    const enter=new window.KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true});
    panel.dispatchEvent(enter);assert.equal(enter.defaultPrevented,false);
    gate.chrome.tabs.query=async()=>[
      {id:1,url:"https://current.example"},
      {id:2,url:" https://untitled.example/ ",title:"  "},
      {id:3,url:"https://no-title.example/"},
      {id:4,url:undefined},
      {id:5,url:"chrome://settings/"},
      {id:6,url:"invalid"}
    ];
    const before=generation;
    gate.chrome.storage.onChanged.emit({startPageSettings:{newValue:gate.state.startPageSettings}},"sync");
    await delay(20);assert.equal(generation,before);
    gate.chrome.storage.onChanged.emit({startPageSettings:{newValue:gate.state.startPageSettings}},"local");
    await until(()=>overlay()?.querySelectorAll("button").length===4);
    assert.match(overlay().textContent,/https:\/\/untitled\.example\//);
    assert.match(overlay().textContent,/https:\/\/no-title\.example\//);
    gate.chrome.tabs.getCurrent=async()=>({});
    one(overlay(),"button").click();await delay(20);
    assert.ok(!gate.calls.some(c=>Array.isArray(c)&&c[0]==="update"));
    gate.chrome.tabs.getCurrent=async()=>({...gate.tab});
    let settle;
    gate.handler=()=>new Promise(resolve=>settle=resolve);
    const oldButton=native();
    oldButton.click();await until(()=>settle);
    assert.equal(oldButton.getAttribute("aria-busy"),"true");
    const beforeRebuild=generation;
    gate.chrome.storage.onChanged.emit({startPageSettings:{newValue:gate.state.startPageSettings}},"local");
    await until(()=>generation>beforeRebuild&&!oldButton.isConnected);
    assert.equal(native().getAttribute("aria-busy"),"true");
    const count=gate.messages.length;
    native().click();assert.equal(gate.messages.length,count);
    settle({ok:false,error:"native denied"});
    await until(()=>overlay().querySelector('[role="alert"]:not([hidden])'));
    assert.equal(native().hasAttribute("aria-busy"),false);
    gate.handler=async()=>({ok:true});
    native().click();await until(()=>!native().hasAttribute("aria-busy"));
    assert.equal(one(overlay(),'[role="alert"]').hidden,true);
    // Failed opener lookup must not leave a stale split overlay.
    gate.chrome.tabs.get=async()=>{throw Error("opener gone")};
    gate.chrome.tabs.getCurrent=async()=>({...gate.tab});
    gate.chrome.storage.local.set=originalSet;
    gate.chrome.storage.onChanged.emit({startPageSettings:{newValue:gate.state.startPageSettings}},"local");
    await until(()=>!overlay());
    assert.equal(one(document,"#startPage").hasAttribute("inert"),false);
    // If the catalog and Chrome i18n fail to supply strings, use readable
    // built-in fallback text. A failed tab lookup is not a split signal.
    gate.chrome.tabs.getCurrent=async()=>{throw Error("tab closed")};
    globalThis.fetch=async()=>{throw Error("catalog offline")};
    gate.chrome.i18n.getMessage=()=>"";
    gate.chrome.i18n.getUILanguage=undefined;
    gate.state.startPageSettings.startTab.enabled=false;
    gate.chrome.storage.onChanged.emit({localeOverride:{newValue:undefined}},"local");
    await until(()=>overlay()?.textContent.includes("Start Tab is disabled"));
    assert.match(overlay().textContent,/Open browser new tab/);
    console.log("Gate: opener detection, diagnostic/query errors, stale overlay lease, focus trap, locale and native fallbacks");
  }finally{globalThis.fetch=catalog;gateDom.window.close()}




  // A browser may omit the UI language API and reject Web Locks or
  // diagnostics writes. The native gate should still remain usable.
  {
    const dom=await installDom("newtab/newtab.html","https://extension.example/newtab.html");
    const control=installChrome(seed());
    control.state.localeOverride=undefined;
    delete control.chrome.i18n.getUILanguage;
    control.chrome.i18n.getMessage=()=> "";
    control.state.startPageSettings.startTab.enabled=false;
    const locks=[];
    Object.defineProperty(navigator,"locks",{configurable:true,value:{request:async(name,options,read)=>{locks.push([name,options.mode]);return read()}}});
    globalThis.fetch=async()=>{throw Error("offline catalog")};
    const overlay=()=>document.getElementById("startTabGateOverlay");
    try{
      await import("../src/newtab/newtab-gate.js?case="+(++serial));
      await window.startTabGateReady;
      assert.match(overlay().textContent,/Start Tab is disabled/);
      assert.ok(locks.every(([name,mode])=>name==="start-tab:data-write"&&mode==="exclusive"));
      assert.ok(locks.length>=2);
      const panel=one(overlay(),'[role="dialog"]');
      const keys=[...panel.querySelectorAll("button")];
      keys.forEach(b=>b.disabled=true);
      const tab=new window.KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true});
      panel.dispatchEvent(tab);
      assert.equal(tab.defaultPrevented,true);assert.equal(document.activeElement,panel);
      const enter=new window.KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true});
      panel.dispatchEvent(enter);assert.equal(enter.defaultPrevented,false);
      const set=control.chrome.storage.local.set;
      control.chrome.storage.local.set=async()=>{throw Error("diagnostics unavailable")};
      window.name="split-view";
      control.chrome.tabs.getCurrent=async()=>{throw Error("tab lookup unavailable")};
      control.chrome.tabs.query=async()=>[{id:2,url:"https://untitled.example/"},{id:3,url:"https://whitespace.example/",title:"  "},{id:4}];
      control.chrome.storage.onChanged.emit({startPageSettings:{newValue:control.state.startPageSettings}},"local");
      await until(()=>overlay()?.textContent.includes("https://untitled.example/"));
      assert.ok(overlay().textContent.includes("https://whitespace.example/"));
      const count=control.calls.length;
      one(overlay(),"button").click();await delay(30);
      assert.equal(control.calls.length,count);
      control.chrome.storage.local.set=set;
      window.name="";
      control.state.startPageSettings.startTab.enabled=true;
      control.chrome.storage.onChanged.emit({startPageSettings:{newValue:control.state.startPageSettings}},"local");
      await until(()=>!overlay());
    }finally{globalThis.fetch=catalog;dom.window.close()}
  }

  // Gate generation races: late tab lists and locale catalogs must never
  // resurrect an obsolete overlay or overwrite the latest language.
  {
    const dom=await installDom("newtab/newtab.html","https://extension.example/newtab.html");
    const control=installChrome(seed());
    const overlay=()=>document.getElementById("startTabGateOverlay");
    try{
      await import("../src/newtab/newtab-gate.js?case="+(++serial));
      await window.startTabGateReady;
      assert.equal(overlay(),null);
      let resolveTabs;
      control.chrome.tabs.query=async()=>new Promise(resolve=>{resolveTabs=resolve});
      window.name="split-view";
      control.chrome.storage.onChanged.emit({startPageSettings:{newValue:control.state.startPageSettings}},"local");
      await until(()=>resolveTabs);
      window.name="";
      control.state.startPageSettings.startTab.enabled=false;
      control.chrome.storage.onChanged.emit({startPageSettings:{newValue:control.state.startPageSettings}},"local");
      const english=await loadI18n();
      await until(()=>overlay()?.textContent.includes(english.t("startTabDisabledTitle")));
      resolveTabs([{id:2,title:"Obsolete tab",url:"https://obsolete.example/"}]);
      await delay(30);
      assert.ok(!overlay().textContent.includes("Obsolete tab"));
      let pendingCatalog=[];
      globalThis.fetch=async url=>String(url).includes("/ru/")?new Promise(resolve=>pendingCatalog.push(()=>resolve(catalog(url)))):catalog(url);
      control.state.localeOverride="ru";
      control.chrome.storage.onChanged.emit({localeOverride:{newValue:"ru"}},"local");
      await until(()=>pendingCatalog.length===3);
      control.state.localeOverride="en";
      control.chrome.storage.onChanged.emit({localeOverride:{newValue:"en"}},"local");
      await delay(30);
      for(const finish of pendingCatalog)finish();
      await delay(30);
      assert.match(overlay().textContent,new RegExp(english.t("startTabDisabledTitle")));
      globalThis.fetch=catalog;
      // A native-tab failure belongs to the current overlay, not the
      // detached button which originally dispatched the request.
      let release;
      control.handler=()=>new Promise(resolve=>{release=resolve});
      const old=one(overlay(),"[data-native-new-tab]");old.click();
      await until(()=>release);
      control.chrome.storage.onChanged.emit({startPageSettings:{newValue:control.state.startPageSettings}},"local");
      await until(()=>!old.isConnected);
      const replacement=one(overlay(),"[data-native-new-tab]");
      assert.equal(replacement.getAttribute("aria-busy"),"true");
      release(undefined);
      await until(()=>overlay()?.querySelector('[role="alert"]:not([hidden])'));
      assert.equal(replacement.hasAttribute("aria-busy"),false);
      const n=control.messages.length;
      old.click();await delay(20);
      assert.equal(control.messages.length,n);
      control.state.startPageSettings.startTab.enabled=true;
      control.chrome.storage.onChanged.emit({startPageSettings:{newValue:control.state.startPageSettings}},"local");
      await until(()=>!overlay());
      assert.equal(one(document,"#startPage").hasAttribute("inert"),false);
    }finally{globalThis.fetch=catalog;dom.window.close()}
  }


  // Synchronous Chrome API failures must be contained by the native gate,
  // and repeated native-tab failures must reuse the existing status node.
  {
    const dom=await installDom("newtab/newtab.html","https://extension.example/newtab.html");
    const control=installChrome(seed());
    control.state.startPageSettings.startTab.enabled=false;
    control.chrome.i18n.getUILanguage=()=>undefined;
    delete control.state.localeOverride;
    const overlay=()=>one(document,"#startTabGateOverlay");
    try{
      await import("../src/newtab/newtab-gate.js?case="+(++serial));
      await window.startTabGateReady;
      const native=one(overlay(),"[data-native-new-tab]");
      const settingsButton=[...overlay().querySelectorAll("button")].at(-1);
      let attempts=0;
      control.chrome.runtime.openOptionsPage=()=>{attempts++;throw Error("API disconnected")};
      settingsButton.click();
      assert.equal(attempts,1);
      assert.ok(overlay().isConnected);
      control.chrome.runtime.openOptionsPage=async()=>{attempts++};
      settingsButton.click();assert.equal(attempts,2);
      control.handler=async()=>({ok:false,error:"native rejected"});
      native.click();
      await until(()=>overlay().querySelector('[role="alert"]:not([hidden])'));
      const status=one(overlay(),'[role="alert"]');
      native.click();
      await until(()=>control.messages.length===2&&!native.hasAttribute("aria-busy"));
      assert.equal(one(overlay(),'[role="alert"]'),status);
      assert.equal(overlay().querySelectorAll('[role="alert"]').length,1);
      let release;
      control.handler=()=>new Promise(resolve=>{release=resolve});
      native.click();await until(()=>release);
      control.state.startPageSettings.startTab.enabled=true;
      control.chrome.storage.onChanged.emit({startPageSettings:{newValue:control.state.startPageSettings}},"local");
      await until(()=>!document.getElementById("startTabGateOverlay"));
      release({ok:false,error:"late failure"});
      const fallback=one(document,"#nativeNewTab");
      await until(()=>!fallback.hasAttribute("aria-busy"));
      assert.ok(fallback.nextElementSibling?.getAttribute("role")==="alert");
      assert.equal(document.getElementById("startTabGateOverlay"),null);
      assert.equal(one(document,"#startPage").hasAttribute("inert"),false);
    }finally{globalThis.fetch=catalog;dom.window.close()}
  }

  // A web-accessible blocked page embedded as a subframe must never expose
  // an active countdown or send unblock messages.
  const frameDom=await installDom("blocked/blocked.html","https://extension.example/blocked.html?site=blocked.example");
  const frameControl=installChrome(seed());
  const topWindow=window,topDocument=document,topLocation=location;
  try{
    const frame=topDocument.createElement("iframe");
    topDocument.body.append(frame);
    frame.contentDocument.body.innerHTML=topDocument.body.innerHTML.split("<iframe")[0];
    globalThis.window=frame.contentWindow;
    globalThis.document=frame.contentDocument;
    globalThis.location=frame.contentWindow.location;
    await import("../src/blocked/blocked.ts?case="+(++serial));
    assert.equal(one(document,"#unblock").disabled,true);
    assert.equal(one(document,"#cancel").disabled,true);
    assert.equal(one(document,"#actions").hidden,true);
    one(document,"#unblock").click();
    assert.equal(frameControl.messages.length,0);
  }finally{globalThis.window=topWindow;globalThis.document=topDocument;globalThis.location=topLocation;frameDom.window.close()}
  // Fatal initialization errors are shown instead of a blank, unusable UI.
  for(const page of ["newtab","options"]){
    const failDom=await installDom(page+"/"+page+".html");
    const failControl=installChrome(seed());
    failControl.chrome.storage.local.get=async()=>{throw Error("startup storage unavailable")};
    try{
      await import("../src/"+page+"/"+page+".ts?case="+(++serial));
      const selector=page==="newtab"?"#grid .fatal-error":"#status";
      await until(()=>document.querySelector(selector)?.textContent.includes("startup storage unavailable"),page+" fatal initialization");
      assert.equal(failControl.messages.length,0);
    }finally{failDom.window.close()}
  }

  // A clean page must reload for a committed locale change and a restored
  // BFCache page must reload instead of keeping disposed listeners.
  {
    const cleanDom=await installDom("newtab/newtab.html","https://extension.example/newtab.html");
    const cleanSettings=createDefaultStartPageSettings(100);
    cleanSettings.layout.blocks=[];
    const clean=installChrome({...seed(),startPageSettings:cleanSettings,startPageOnboarding:{onboarded:true}});
    const actualLocation=globalThis.location;
    let reloads=0;
    try{
      await import("../src/newtab/newtab.ts?case="+(++serial));
      await until(()=>document.querySelector("#grid .empty-layout"));
      globalThis.location={reload:()=>{reloads++}};
      clean.state.localeOverride="ru";
      clean.chrome.storage.onChanged.emit({localeOverride:{newValue:"ru"}},"local");
      await until(()=>reloads===1);
      assert.equal(document.querySelector(".draft-recovery:not([hidden])"),null);
      window.dispatchEvent(new window.Event("pagehide"));
      const show=new window.Event("pageshow");
      Object.defineProperty(show,"persisted",{value:true});
      window.dispatchEvent(show);
      assert.equal(reloads,2);
      clean.state.localeOverride="en";
      clean.chrome.storage.onChanged.emit({localeOverride:{newValue:"en"}},"local");
      await delay(30);
      assert.equal(reloads,2);
    }finally{globalThis.location=actualLocation;cleanDom.window.close()}
  }
  for(const [page,required] of [["newtab","background"],["options","title"]]){
    const malformedDom=await installDom(page+"/"+page+".html");
    installChrome(seed());
    try{
      one(document,"#"+required).remove();
      await assert.rejects(import("../src/"+page+"/"+page+".ts?case="+(++serial)),new RegExp("Missing required element: "+required));
    }finally{malformedDom.window.close()}
  }
  // A delayed split-picker choice belongs to the overlay that rendered it.
  // Changing context before getCurrent resolves must not navigate the tab.
  {
    const dom=await installDom("newtab/newtab.html","https://extension.example/newtab.html");
    const control=installChrome(seed());
    const overlay=()=>document.getElementById("startTabGateOverlay");
    const chosen=()=>[...overlay().querySelectorAll("button")].find(b=>b.textContent==="Chosen tab");
    const originalGet=control.chrome.tabs.getCurrent;
    window.name="split-view";
    control.chrome.tabs.query=async()=>[{id:2,url:"https://chosen.example/",title:"Chosen tab"}];
    try{
      await import("../src/newtab/newtab-gate.js?case="+(++serial));
      await window.startTabGateReady;
      assert.ok(chosen());
      chosen().click();
      await until(()=>control.calls.some(c=>c[0]==="update"&&c[2]?.url==="https://chosen.example/"));
      const before=control.calls.length;
      let release;
      control.chrome.tabs.getCurrent=()=>new Promise(resolve=>{release=resolve});
      const oldChoice=chosen(), oldSettings=[...overlay().querySelectorAll("button")].at(-1);
      oldChoice.click();await until(()=>release);
      control.chrome.tabs.getCurrent=originalGet;
      window.name="";
      control.chrome.storage.onChanged.emit({startPageSettings:{newValue:control.state.startPageSettings}},"local");
      await until(()=>!overlay());
      release({id:1,url:"https://extension.example/newtab.html"});
      await delay(30);
      oldChoice.click();oldSettings.click();
      await delay(20);
      assert.equal(control.calls.length,before);
    }finally{control.chrome.tabs.getCurrent=originalGet;dom.window.close()}
  }

  // The settings read may finish after a newer gate generation. An old
  // disabled snapshot must not remount the overlay on an enabled page.
  {
    const dom=await installDom("newtab/newtab.html","https://extension.example/newtab.html");
    const control=installChrome(seed());
    const get=control.chrome.storage.local.get;
    const overlay=()=>document.getElementById("startTabGateOverlay");
    try{
      await import("../src/newtab/newtab-gate.js?case="+(++serial));
      await window.startTabGateReady;
      assert.equal(overlay(),null);
      const disabled=structuredClone(control.state.startPageSettings);
      disabled.startTab.enabled=false;
      let release,changes=0;
      window.addEventListener("start-tab-gate-change",()=>{changes++});
      control.chrome.storage.local.get=keys=>{
        if(keys==="startPageSettings"&&!release)return new Promise(resolve=>{release=()=>resolve({startPageSettings:disabled})});
        return get(keys);
      };
      control.chrome.storage.onChanged.emit({startPageSettings:{newValue:disabled}},"local");
      await until(()=>release);
      control.chrome.storage.local.get=get;
      // A missing root must not prevent gate reconciliation.
      one(document,"#startPage").remove();
      control.chrome.storage.onChanged.emit({startPageSettings:{newValue:control.state.startPageSettings}},"local");
      await until(()=>changes===1);
      release();await delay(30);
      assert.equal(overlay(),null);
      assert.equal(changes,1);
    }finally{control.chrome.storage.local.get=get;dom.window.close()}
  }
  console.log("Page initialization: blocked subframe, stale settings generation and fatal startup reads");
}finally{restoreFetch()}
