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
    if(options.badCatalog)globalThis.fetch=async()=>new Response(null,{status:404});
    await import("../src/blocked/blocked.ts?case="+(++serial));
    if(options.badCatalog)await until(()=>!one(document,"#unblockError").hidden);
    else if(!options.inactive)await until(()=>document.title!=="");
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
  console.log("Popup: unblock stale tab, committed/failed refresh, locale CAS and catalog failures");
}finally{restoreFetch()}
