import assert from "node:assert/strict";
import { installDom, installChrome, installFetch, one, until, delay, value } from "./ui-fixture-dom.mjs";
import { loadI18n } from "../src/lib/i18n.js";
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

}finally{restoreFetch()}
