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
  assert.equal(failedNotice.notificationFailed, true);
  chrome.notifications.create = originalNotice;

  // Worker uses the browser locale if catalog reads fail; alarm completion
  // must remain committed regardless of translation or delivery failures.
  const originalFetch=globalThis.fetch, originalMessage=chrome.i18n.getMessage;
  const originalLocale=control.state.localeOverride;
  try{
    for(const mode of ["http","throw","empty","auto"]){
      control.state.localeOverride=mode==="auto"?undefined:"ru";
      chrome.i18n.getMessage=()=>mode==="empty"?"":"native fallback";
      globalThis.fetch=async()=>{
        if(mode==="throw")throw Error("catalog unavailable");
        return mode==="http"?new Response("",{status:503}):Response.json({});
      };
      await ok({type:"clock-action",instanceId:"worker-timer",action:"reset"});
      await ok({type:"clock-action",instanceId:"worker-timer",action:"start"});
      const clock=control.state.startPageRuntimeState.clocks["worker-timer"];
      // Restore a valid persisted countdown whose deadline already elapsed.
      clock.startedAt=Date.now()-3000;clock.targetAt=Date.now()-2000;
      await ok({type:"complete-clock",instanceId:"worker-timer",token:clock.completionToken});
      assert.equal((await view()).runtime.clocks["worker-timer"].running,false);
      const notification=control.calls.filter(c=>c[0]==="notification").at(-1)[2];
      assert.equal(notification.message,mode==="empty"?"timerDone":"native fallback");
    }
  }finally{globalThis.fetch=originalFetch;chrome.i18n.getMessage=originalMessage;control.state.localeOverride=originalLocale}
  await ok({type:"clock-action",instanceId:"worker-pomodoro",action:"start"});
  const focusStart=control.state.startPageRuntimeState.clocks["worker-pomodoro"];
  focusStart.startedAt=Date.now()-3000;focusStart.focusSessionStartedAt=focusStart.startedAt;
  await ok({type:"clock-action",instanceId:"worker-pomodoro",action:"reset"});
  assert.equal((await view()).runtime.clocks["worker-pomodoro"].running,false);
  assert.ok((await getFocusStats()).totals.focusSessionsInterrupted>=1);
  // Failure of a native browser redirect must be contained by the event
  // listener, then a later observation must be able to redirect normally.
  const redirectUpdateBefore=chrome.tabs.update;
  let rejectedRedirect=0;
  control.tab={id:1,url:"chrome://newtab/"};
  chrome.tabs.update=async()=>{rejectedRedirect++;throw Error("internal tab denied")};
  chrome.tabs.onUpdated.emit(1,{url:"chrome://newtab/"},control.tab);
  await until(()=>rejectedRedirect===1,"rejected internal redirect");
  chrome.tabs.update=redirectUpdateBefore;
  chrome.tabs.onUpdated.emit(1,{url:"chrome://newtab/"},control.tab);
  await until(()=>control.calls.some(c=>c[0]==="update"&&c[2]?.url==="https://extension.example/newtab.html"),"redirect after refusal");
  const previousCount=control.calls.length;
  const oldManifest=chrome.runtime.getManifest;
  chrome.runtime.getManifest=()=>({});
  control.tab={id:1,url:"chrome://newtab/"};
  chrome.tabs.onUpdated.emit(1,{url:"chrome://newtab/"},control.tab);
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(control.calls.length,previousCount);
  chrome.runtime.getManifest=oldManifest;

  // Automatic locale, unavailable catalogs and malformed catalog bodies
  // must all leave a readable notification, even if Chrome itself supplies
  // no message. Use an expired persisted countdown, not a synthetic reply.
  {
    const priorLocale=control.state.localeOverride,priorFetch=globalThis.fetch,priorMessage=chrome.i18n.getMessage;
    try{
      chrome.i18n.getMessage=()=>"";
      for(const scenario of ["auto","http","network","invalid-json","empty-translation"]){
        if(scenario==="auto")delete control.state.localeOverride;
        else control.state.localeOverride="ru";
        let catalogReads=0;
        globalThis.fetch=async()=>{
          catalogReads++;
          if(scenario==="network")throw Error("network unavailable");
          if(scenario==="http")return new Response(null,{status:503});
          if(scenario==="invalid-json")return new Response("{");
          return Response.json({timerDone:{message:""}});
        };
        await ok({type:"clock-action",instanceId:"worker-timer",action:"reset"});
        await ok({type:"clock-action",instanceId:"worker-timer",action:"start"});
        const clock=control.state.startPageRuntimeState.clocks["worker-timer"];
        clock.startedAt=Date.now()-3000;clock.targetAt=clock.startedAt+clock.durationMs;
        const count=control.calls.filter(c=>c[0]==="notification").length;
        await ok({type:"complete-clock",instanceId:"worker-timer",token:clock.completionToken});
        const notices=control.calls.filter(c=>c[0]==="notification");
        assert.equal(notices.length,count+1,scenario);
        assert.equal(notices.at(-1)[2].message,"timerDone",scenario);
        assert.equal((await view()).runtime.clocks["worker-timer"].running,false);
        if(scenario==="auto")assert.equal(catalogReads,0);
        else assert.ok(catalogReads>=1);
      }
    }finally{
      globalThis.fetch=priorFetch;chrome.i18n.getMessage=priorMessage;
      if(priorLocale===undefined)delete control.state.localeOverride;else control.state.localeOverride=priorLocale;
    }
  }

  // Regional legacy locale and failed locale storage reads must not
  // suppress a notification or select an unrelated browser language.
  {
    const priorLocale=control.state.localeOverride,priorFetch=globalThis.fetch,priorMessage=chrome.i18n.getMessage,priorGet=chrome.storage.local.get;
    try {
      chrome.i18n.getMessage=()=>"native notice";
      for(const scenario of ["ru-RU","EN_us","read-failure"]){
        control.state.localeOverride=scenario;
        const urls=[];
        globalThis.fetch=async url=>{
          urls.push(String(url));
          return Response.json({timerDone:{message:"localized notice"}});
        };
        chrome.storage.local.get=async (...args)=>{
          if(scenario==="read-failure"&&args[0]==="localeOverride")throw Error("locale read failure");
          return priorGet.apply(chrome.storage.local,args);
        };
        await ok({type:"clock-action",instanceId:"worker-timer",action:"reset"});
        await ok({type:"clock-action",instanceId:"worker-timer",action:"start"});
        const clock=control.state.startPageRuntimeState.clocks["worker-timer"];
        clock.startedAt=Date.now()-3000;clock.targetAt=clock.startedAt+clock.durationMs;
        const count=control.calls.filter(c=>c[0]==="notification").length;
        await ok({type:"complete-clock",instanceId:"worker-timer",token:clock.completionToken});
        const notices=control.calls.filter(c=>c[0]==="notification");
        assert.equal(notices.length,count+1,scenario);
        assert.equal(notices.at(-1)[2].message,scenario==="read-failure"?"native notice":"localized notice");
        if(scenario==="read-failure")assert.equal(urls.length,0);
        else assert.ok(urls.length>0&&urls.every(url=>url.includes("/_locales/"+(scenario==="ru-RU"?"ru":"en")+"/")));
      }
    }finally{
      chrome.storage.local.get=priorGet;globalThis.fetch=priorFetch;chrome.i18n.getMessage=priorMessage;
      if(priorLocale===undefined)delete control.state.localeOverride;else control.state.localeOverride=priorLocale;
    }
  }

  // A renamed timer uses its own title, whereas a silent timer commits
  // the completed state without creating a notification at all.
  {
    const previousSettings=structuredClone(control.state.startPageSettings);
    const previousRuntime=structuredClone(control.state.startPageRuntimeState);
    try{
      for(const notify of [true,false]){
        const saved=structuredClone(control.state.startPageSettings);
        const b=saved.layout.blocks.find(block=>block.id==="worker-timer");
        b.title="Custom kitchen timer";
        b.config.notifyOnComplete=notify;
        control.state.startPageSettings=saved;
        await ok({type:"clock-action",instanceId:b.id,action:"reset"});
        await ok({type:"clock-action",instanceId:b.id,action:"start"});
        const clock=control.state.startPageRuntimeState.clocks[b.id];
        clock.startedAt=Date.now()-3000;clock.targetAt=clock.startedAt+clock.durationMs;
        const before=control.calls.filter(c=>c[0]==="notification").length;
        await ok({type:"complete-clock",instanceId:b.id,token:clock.completionToken});
        const after=control.calls.filter(c=>c[0]==="notification");
        assert.equal(after.length,before+(notify?1:0));
        if(notify)assert.equal(after.at(-1)[2].title,"Custom kitchen timer");
        assert.equal((await view()).runtime.clocks[b.id].running,false);
      }
    }finally{
      control.state.startPageSettings=previousSettings;
      control.state.startPageRuntimeState=previousRuntime;
    }
  }

  // A real Pomodoro completion through the worker must use the localized
  // Pomodoro notification, advance phases and never double-count a token.
  {
    const oldSettings=structuredClone(control.state.startPageSettings);
    const oldRuntime=structuredClone(control.state.startPageRuntimeState);
    const oldLocale=control.state.localeOverride;
    control.state.localeOverride="en";
    const catalog=await (await fetch(chrome.runtime.getURL("_locales/en/messages.json"))).json();
    const expectedMessage=catalog.pomodoroDone.message;
    assert.ok(expectedMessage);
    try {
      for(const autoStart of [false,true]){
        const s=structuredClone(oldSettings);
        const b=s.layout.blocks.find(b=>b.id==="worker-pomodoro");
        b.config={...b.config,workSeconds:60,breakSeconds:30,notifyOnComplete:true,autoStartNextPhase:autoStart};
        control.state.startPageSettings=s;
        await ok({type:"clock-action",instanceId:b.id,action:"reset"});
        await ok({type:"clock-action",instanceId:b.id,action:"start"});
        for(const phase of ["work","break"]){
          let clock=control.state.startPageRuntimeState.clocks[b.id];
          if(!clock.running){
            await ok({type:"clock-action",instanceId:b.id,action:"start"});
            clock=control.state.startPageRuntimeState.clocks[b.id];
          }
          assert.equal(clock.phase,phase);
          clock.startedAt=Date.now()-clock.durationMs-1000;
          clock.targetAt=clock.startedAt+clock.durationMs;
          clock.focusSessionStartedAt=phase==="work"?clock.startedAt:null;
          const token=clock.completionToken;
          const count=control.calls.filter(c=>c[0]==="notification").length;
          await ok({type:"complete-clock",instanceId:b.id,token});
          const notices=control.calls.filter(c=>c[0]==="notification");
          assert.equal(notices.length,count+1);
          assert.equal(notices.at(-1)[2].message,expectedMessage);
          const after=await view();
          assert.equal(after.runtime.clocks[b.id].phase,phase==="work"?"break":"work");
          assert.equal(after.runtime.clocks[b.id].running,autoStart);
          const totals=(await getFocusStats()).totals;
          await ok({type:"complete-clock",instanceId:b.id,token});
          assert.equal(control.calls.filter(c=>c[0]==="notification").length,count+1);
          assert.deepEqual((await getFocusStats()).totals,totals);
        }
        await ok({type:"clock-action",instanceId:b.id,action:"reset"});
      }
    }finally{
      control.state.startPageSettings=oldSettings;
      control.state.startPageRuntimeState=oldRuntime;
      if(oldLocale===undefined)delete control.state.localeOverride;else control.state.localeOverride=oldLocale;
    }
  }
  console.log("Worker residual: translation fallbacks, interrupted pomodoro, rejected browser redirect and blocker-only manifest");

  {
  // Browser event listeners must ignore unrelated events and recover from
  // failures without poisoning the serialized runtime job.
  const beforeIgnored=structuredClone(control.state);
  chrome.tabs.onUpdated.emit(1,{status:"complete"});
  chrome.webNavigation.onBeforeNavigate.emit({tabId:1,frameId:0,url:""});
  chrome.webNavigation.onBeforeNavigate.emit({tabId:1,frameId:0,url:blocked});
  chrome.webNavigation.onBeforeNavigate.emit({tabId:1,frameId:2,url:"https://other.example/"});
  chrome.alarms.onAlarm.emit({name:"foreign-alarm"});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.deepEqual(control.state,beforeIgnored);
  const rtApi=await import("../src/lib/start-page-runtime.js");
  const alarmId="worker-timer";
  await ok({type:"clock-action",instanceId:alarmId,action:"start"});
  let alarmClock=control.state.startPageRuntimeState.clocks[alarmId];
  const alarmName=rtApi.clockAlarmName(alarmId,alarmClock.completionToken);
  alarmClock.startedAt=Date.now();alarmClock.targetAt=Date.now()+10000;
  control.alarms.delete(alarmName);
  chrome.alarms.onAlarm.emit({name:alarmName});
  await until(()=>control.alarms.has(alarmName),"early alarm rearmed");
  assert.equal(control.state.startPageRuntimeState.clocks[alarmId].running,true);
  // Fail the completion's storage read once, then verify that the alarm is
  // rearmed with backoff and its original token remains live.
  alarmClock=control.state.startPageRuntimeState.clocks[alarmId];
  alarmClock.startedAt=Date.now()-5000;alarmClock.targetAt=Date.now()-4000;
  const localArea=chrome.storage.local, readBeforeAlarm=localArea.get;
  let failAlarmRead=true;
  localArea.get=async keys=>{
    if(failAlarmRead){failAlarmRead=false;throw Error("transient alarm storage read")}
    return readBeforeAlarm(keys);
  };
  control.alarms.delete(alarmName);
  try{
    chrome.alarms.onAlarm.emit({name:alarmName});
    await until(()=>control.alarms.has(alarmName),"failed alarm retried");
    assert.ok(control.alarms.get(alarmName).scheduledTime>=Date.now()+29000);
    assert.equal(control.state.startPageRuntimeState.clocks[alarmId].running,true);
  }finally{localArea.get=readBeforeAlarm}
  await ok({type:"complete-clock",instanceId:alarmId,token:alarmClock.completionToken});
  assert.equal(control.state.startPageRuntimeState.clocks[alarmId].running,false);
  // A new job following a string-valued platform rejection must still work.
  localArea.get=async()=>{throw "storage bridge denied"};
  try{await reject({type:"runtime-note",instanceId:"worker-note",value:"x",expectedValue:""},/storage bridge denied/)}
  finally{localArea.get=readBeforeAlarm}
  await ok({type:"runtime-note",instanceId:"worker-note",value:"recovered",expectedValue:""});
  assert.equal((await view()).runtime.notes["worker-note"],"recovered");
  // All supported internal new-tab URL variants, and non-new-tab URLs that
  // must never be redirected (even if their pathname contains 'newtab').
  for(const url of ["about:newtab","edge://new-tab/","brave://new_tab/","chrome-search://local-ntp/","https://example.com/newtab","not a URL","chrome://settings/","https://extension.example/newtab.html"]){
    const count=control.calls.length;
    control.tab={id:1,url};
    chrome.tabs.onUpdated.emit(1,{url},control.tab);
    if(url==="about:newtab"||url.startsWith("edge:")||url.startsWith("brave:")||url.startsWith("chrome-search:")){
      await until(()=>control.calls.length>count,"internal new tab: "+url);
      assert.deepEqual(control.calls.at(-1),["update",1,{url:"https://extension.example/newtab.html"}]);
    }else{
      await new Promise(resolve=>setTimeout(resolve,30));
      assert.equal(control.calls.length,count,url);
    }
  }
  console.log("Worker: ignored events, early alarm and failed alarm retry, queue recovery and browser URL matrix");
  }

  // Failure in both the alarm completion transaction and its fallback
  // rearm must not poison the serialized worker queue. A later valid
  // request can finish the same token exactly once.
  {
    const runtimeApi=await import("../src/lib/start-page-runtime.js");
    const id="worker-timer";
    await ok({type:"clock-action",instanceId:id,action:"reset"});
    await ok({type:"clock-action",instanceId:id,action:"start"});
    const clock=control.state.startPageRuntimeState.clocks[id];
    clock.startedAt=Date.now()-5000;clock.targetAt=Date.now()-4000;
    const token=clock.completionToken,name=runtimeApi.clockAlarmName(id,token);
    control.alarms.delete(name);
    const store=chrome.storage.local,previousGet=store.get;
    let rejected=0;
    store.get=async keys=>{if(rejected<2){rejected++;throw Error("storage unavailable twice")}return previousGet(keys)};
    try{
      chrome.alarms.onAlarm.emit({name});
      await until(()=>rejected===2,"completion and rearm failure");
      assert.equal(control.state.startPageRuntimeState.clocks[id].running,true);
      assert.equal(control.alarms.has(name),false);
    }finally{store.get=previousGet}
    await ok({type:"complete-clock",instanceId:id,token});
    assert.equal(control.state.startPageRuntimeState.clocks[id].running,false);
    assert.equal(control.state.startPageRuntimeState.clocks[id].lastCompletedToken,token);
  }
  // Refuse to redirect a native page when Start Tab is disabled or a
  // bypass lease belongs to the same tab, while leaving unrelated tabs alone.
  {
    const nativeApi=await import("../src/lib/native-new-tab.js");
    const oldEnabled=control.state.startPageSettings.startTab.enabled;
    const oldGrant=control.state[nativeApi.NATIVE_NEW_TAB_BYPASS_KEY];
    const updates=()=>control.calls.filter(c=>c[0]==="update").length;
    const before=updates();
    try{
      control.state.startPageSettings.startTab.enabled=false;
      control.tab={id:1,url:"vivaldi://newtab/"};
      chrome.tabs.onUpdated.emit(1,{url:control.tab.url});
      await new Promise(resolve=>setTimeout(resolve,40));
      assert.equal(updates(),before);
      control.state.startPageSettings.startTab.enabled=true;
      control.state[nativeApi.NATIVE_NEW_TAB_BYPASS_KEY]={tabId:1,expiresAt:Date.now()+10000};
      control.tab={id:1,url:"opera://new-tab/"};
      chrome.tabs.onCreated.emit(control.tab);
      await until(()=>typeof control.state[nativeApi.NATIVE_NEW_TAB_BYPASS_KEY]?.consumedAt==="number");
      assert.equal(updates(),before);
      control.tab={id:2,url:"comet://newtab/"};
      chrome.tabs.onUpdated.emit(2,{url:control.tab.url});
      await until(()=>updates()===before+1);
      assert.deepEqual(control.calls.at(-1),["update",2,{url:"https://extension.example/newtab.html"}]);
    }finally{
      control.state.startPageSettings.startTab.enabled=oldEnabled;
      if(oldGrant===undefined)delete control.state[nativeApi.NATIVE_NEW_TAB_BYPASS_KEY];else control.state[nativeApi.NATIVE_NEW_TAB_BYPASS_KEY]=oldGrant;
    }
  }
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
  const native = await import("../src/lib/native-new-tab.js");
  const originalCreate = chrome.tabs.create;
  const originalUpdate = chrome.tabs.update;
  chrome.tabs.create = async opts => { control.tab = { id: 9, ...opts }; return { ...control.tab }; };
  chrome.tabs.update = async (id, opts) => {
    control.tab = { ...control.tab, ...opts };
    assert.equal(await native.consumeNativeNewTabBypass(id), true);
    return { ...control.tab };
  };
  await ok({ type: "open-native-new-tab" });
  assert.equal(control.tab.id, 9);
  assert.equal(control.tab.url, "chrome://new-tab-page/");
  assert.equal(control.state[native.NATIVE_NEW_TAB_BYPASS_KEY].tabId, 9);
  chrome.tabs.create = originalCreate;
  chrome.tabs.update = originalUpdate;
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
  const rt = await import("../src/lib/start-page-runtime.js");
  const currentSettings = await api.getStartPageSettings();
  const timer = await api.addBlockInstance("timer");
  let runtime = await rt.getStartPageRuntimeState();
  runtime.notes[block.id] = "persisted data";
  assert.equal(rt.instanceRuntimeHasUserData(block.id, runtime), true);
  assert.equal(rt.instanceRuntimeHasUserData("absent", runtime), false);
  await rt.setStartPageRuntimeState(runtime);
  assert.equal((await rt.getStartPageRuntimeState()).notes[block.id], "persisted data");
  await ok({ type: "clock-action", instanceId: timer.id, action: "start" });
  runtime = await rt.getStartPageRuntimeState();
  const runningTimer = runtime.clocks[timer.id];
  const alarmName = rt.clockAlarmName(timer.id, runningTimer.completionToken);
  assert.ok(control.alarms.has(alarmName));
  control.alarms.delete(alarmName);
  chrome.alarms.onAlarm.emit({ name: alarmName });
  await until(() => control.alarms.has(alarmName), "early alarm rearmed");
  assert.equal((await rt.getStartPageRuntimeState()).clocks[timer.id].running, true);
  await rt.scheduleClockAlarm(timer.id, runningTimer);
  assert.ok(control.alarms.has(alarmName));
  await ok({ type: "clock-action", instanceId: timer.id, action: "pause" });
  await rt.rearmClockAlarmIfPending(timer.id, runningTimer.completionToken, 0);
  assert.equal(control.alarms.has(alarmName), false);
  await rt.deleteInstanceRuntime("absent");
  await assert.rejects(rt.deleteInstanceRuntime(block.id, 0, runtime.updatedAt), /changed or was removed/);
  await rt.resetStartPageRuntimeState();
  assert.equal((await rt.getStartPageRuntimeState()).notes[block.id] ?? "", "");
  assert.equal(control.alarms.size, 0);
  // Durable mutation rollback and a stale guard must never change persisted
  // blocklist rules or navigation data.
  const bl=await import("../src/lib/blocklist.js");
  await bl.replaceBlockedSites(["example.com","sub.example.com"]);
  assert.equal(await bl.isBlocked("https://sub.example.com/"),true);
  assert.equal(await bl.isBlocked("chrome://settings/"),false);
  assert.equal(await bl.rememberBlockedNavigation("https://sub.example.com/path"),"sub.example.com");
  assert.equal(await bl.getLastBlockedUrl("sub.example.com"),"https://sub.example.com/path");
  assert.equal(await bl.getLastBlockedUrl("invalid / host"),null);
  await bl.clearLastBlockedUrl("sub.example.com");
  assert.equal(await bl.getLastBlockedUrl("sub.example.com"),null);
  await bl.clearLastBlockedUrl("invalid / host");
  const beforeSites=structuredClone(control.state.blockedSites);
  const beforeRules=await bl.readDynamicRulesSnapshot();
  await assert.rejects(bl.unblockHost("example.com",async()=>{throw Error("stale page")}),/stale page/);
  assert.deepEqual(control.state.blockedSites,beforeSites);
  assert.deepEqual(await bl.readDynamicRulesSnapshot(),beforeRules);
  const dnr=chrome.declarativeNetRequest;
  const updateRules=dnr.updateDynamicRules;
  let failOnce=true;
  dnr.updateDynamicRules=async opts=>{if(failOnce){failOnce=false;throw Error("DNR unavailable")}return updateRules(opts)};
  await assert.rejects(bl.blockHost("new.example"),/DNR unavailable/);
  assert.deepEqual(control.state.blockedSites,beforeSites);
  assert.deepEqual(await bl.readDynamicRulesSnapshot(),beforeRules);
  dnr.updateDynamicRules=updateRules;
  await bl.blockHost("new.example");
  assert.ok(control.state.blockedSites.includes("new.example"));
  const totalLimit=dnr.MAX_NUMBER_OF_DYNAMIC_RULES;
  dnr.MAX_NUMBER_OF_DYNAMIC_RULES=1;
  await assert.rejects(bl.blockHost("fourth.example"),/capacity|rollback/);
  dnr.MAX_NUMBER_OF_DYNAMIC_RULES=totalLimit;
  assert.ok(!control.state.blockedSites.includes("fourth.example"));
  await bl.clearAll();
  assert.deepEqual(control.state.blockedSites,[]);
  assert.deepEqual(await bl.readDynamicRulesSnapshot(),[]);
  assert.equal(bl.hostFromUrl("not a url"),null);
  assert.deepEqual(bl.normalizeBlockedSites([null,1,"https://WWW.Example.com/path","ftp://example.com","example.com"]),["example.com"]);
  assert.deepEqual({...bl.normalizeLastBlockedUrls({"example.com":"https://sub.example.com/path","bad.example":1,"mismatch.example":"https://other.example/"})},{"example.com":"https://sub.example.com/path"});

  // Native tab API: absent tab ID, timeout, cleanup failure, and user-owned
  // navigation after creation. Never close a tab that has become user-owned.
  const getTab=chrome.tabs.get, removeTab=chrome.tabs.remove;
  const nativeOptions={consumptionTimeoutMs:2,pollIntervalMs:1};
  chrome.tabs.create=async()=>({});
  await assert.rejects(native.openNativeNewTab(nativeOptions),/did not return a tab id/);
  chrome.tabs.create=async opts=>{control.tab={id:9,...opts};return {...control.tab}};
  chrome.tabs.get=async()=>({...control.tab});
  chrome.tabs.update=async(id,opts)=>{control.tab={id,...opts};return {...control.tab}};
  const removed=[];
  chrome.tabs.remove=async id=>{removed.push(id)};
  await assert.rejects(native.openNativeNewTab(nativeOptions),/rejected every native/);
  assert.deepEqual(removed,[9]);
  assert.equal(control.state[native.NATIVE_NEW_TAB_BYPASS_KEY],undefined);
  chrome.tabs.remove=async()=>{throw Error("cannot remove")};
  await assert.rejects(native.openNativeNewTab(nativeOptions),/cleanup.*incomplete/);
  chrome.tabs.remove=async id=>{removed.push(id)};
  chrome.tabs.update=async(id,opts)=>{control.tab={id,url:"https://user.example/"};throw Error("navigation changed")};
  await assert.rejects(native.openNativeNewTab(nativeOptions),/rejected every native/);
  assert.deepEqual(removed,[9]);
  assert.equal(control.tab.url,"https://user.example/");
  chrome.tabs.create=originalCreate;chrome.tabs.get=getTab;chrome.tabs.update=originalUpdate;chrome.tabs.remove=removeTab;
  console.log("Blocklist and native tab: rollback, stale precondition, capacity, navigation data, timeout and ownership");

  // Runtime schema guards and state restoration on alarm failure.
  let persisted=await view();
  const storedRuntime=structuredClone(control.state.startPageRuntimeState);
  control.state.startPageRuntimeState={version:999,updatedAt:123};
  await assert.rejects(rt.setStartPageRuntimeState(persisted.runtime),/newer extension version/);
  await assert.rejects(rt.deleteInstanceRuntime(block.id),/newer extension version/);
  assert.deepEqual(control.state.startPageRuntimeState,{version:999,updatedAt:123});
  control.state.startPageRuntimeState=storedRuntime;
  const storedSettings=structuredClone(control.state.startPageSettings);
  control.state.startPageSettings={schemaVersion:999,updatedAt:123};
  await assert.rejects(rt.setStartPageRuntimeState(persisted.runtime),/newer extension version/);
  control.state.startPageSettings=storedSettings;
  persisted=await view();
  const beforeReset=structuredClone(control.state);
  const removeStorage=chrome.storage.local.remove;
  let removeFail=true;
  chrome.storage.local.remove=async keys=>{if(removeFail){removeFail=false;throw Error("reset storage failure")}return removeStorage(keys)};
  await assert.rejects(rt.resetStartPageData(),/reset storage failure/);
  assert.deepEqual(control.state,beforeReset);
  chrome.storage.local.remove=removeStorage;
  await assert.rejects(rt.deleteInstanceRuntime(block.id,persisted.settings.layout.blocks.find(x=>x.id===block.id).updatedAt,0),/runtime changed/);
  await rt.deleteInstanceRuntime(block.id);
  assert.equal(rt.parseClockAlarmName("unrelated"),null);
  assert.equal(rt.parseClockAlarmName(rt.clockAlarmName("a:b","c:d")).instanceId,"a:b");
  assert.equal(rt.parseClockAlarmName(rt.clockAlarmName("a:b","c:d")).token,"c:d");
  console.log("Runtime: future schema preservation, reset rollback and revision guards");

  // Public settings APIs reject obsolete writers and invalid identities
  // without changing the previously committed state.
  let baseline=await api.getStartPageSettings();
  const noteBlock=baseline.layout.blocks.find(b=>b.type==="note");
  const singleton=baseline.layout.blocks.find(b=>b.type==="commands");
  assert.ok(noteBlock&&singleton);
  const savedBefore=structuredClone(control.state.startPageSettings);
  await assert.rejects(api.setStartPageSettings({...baseline,updatedAt:baseline.updatedAt-1}),/changed in another extension context/);
  await assert.rejects(api.updateBlockInstance("missing",b=>b),/not found/);
  await assert.rejects(api.updateBlockInstance(noteBlock.id,b=>({...b,id:"changed"})),/identity and type/);
  await assert.rejects(api.updateBlockInstance(noteBlock.id,b=>({...b,type:"timer"})),/identity and type/);
  await assert.rejects(api.saveNewBlockInstance(noteBlock),/ID already exists/);
  await assert.rejects(api.duplicateBlockInstance("missing"),/not found/);
  await assert.rejects(api.duplicateBlockInstance(singleton.id),/Singleton block cannot be duplicated/);
  await assert.rejects(api.saveNewBlockInstance(singleton),/Singleton block already exists/);
  assert.throws(()=>api.createBlockInstanceDraft(baseline,"commands"),/Singleton block already exists/);
  assert.throws(()=>api.settingsWithRemovedBlock(baseline,"missing"),/not found/);
  assert.throws(()=>api.settingsWithLayoutPreset(baseline,"missing"),/Unknown layout preset/);
  assert.deepEqual(control.state.startPageSettings,savedBefore);
  const dupe=await api.duplicateBlockInstance(noteBlock.id,"  Explicit duplicate  ",noteBlock.updatedAt);
  assert.equal(dupe.title,"Explicit duplicate");
  assert.notEqual(dupe.id,noteBlock.id);
  const blankTheme=api.createCustomThemeDraft(baseline,"   ");
  assert.equal(blankTheme.name,api.getTheme(baseline).name);
  const builtinCopy=await api.saveNewCustomTheme({...blankTheme,id:api.getTheme(baseline).id});
  assert.notEqual(builtinCopy.id,api.getTheme(baseline).id);
  const duplicateTheme=await api.duplicateTheme(builtinCopy.id,"  Explicit theme  ",builtinCopy.updatedAt);
  assert.equal(duplicateTheme.name,"Explicit theme");
  await assert.rejects(api.duplicateTheme("absent","name",123),/changed or was removed/);
  await api.deleteCustomTheme(duplicateTheme.id);
  await api.deleteCustomTheme(builtinCopy.id);
  baseline=await api.getStartPageSettings();
  const limitApi=await import("../src/lib/platform-limits.js");
  const saturated={...baseline,layout:{...baseline.layout,mode:"free",blocks:Array.from({length:limitApi.MAX_START_PAGE_BLOCKS},(_,i)=>api.createBlockInstance("note",{id:"capacity-"+i}))}};
  assert.equal(api.canAddBlock(saturated,"note"),false);
  assert.throws(()=>api.createBlockInstanceDraft(saturated,"note"),/supports at most/);
  assert.throws(()=>api.prepareStartPageSettingsWrite({...saturated,layout:{...saturated.layout,blocks:[...saturated.layout.blocks,noteBlock]}},baseline,baseline.updatedAt),/supports at most/);
  const overThemes={...baseline,themes:{...baseline.themes,customThemes:Array.from({length:limitApi.MAX_CUSTOM_THEMES+1},()=>blankTheme)}};
  assert.throws(()=>api.prepareStartPageSettingsWrite(overThemes,baseline,baseline.updatedAt),/custom themes/);
  const preserved=structuredClone(control.state.startPageSettings);
  control.state.startPageSettings={schemaVersion:999,updatedAt:123};
  await api.getStartPageSettings();
  assert.deepEqual(control.state.startPageSettings,{schemaVersion:999,updatedAt:123});
  await assert.rejects(api.updateStartPageSettings(s=>s),/newer extension version/);
  assert.throws(()=>api.prepareStartPageSettingsWrite(baseline,control.state.startPageSettings,123),/newer extension version/);
  control.state.startPageSettings=preserved;
  const migrationKey=api.START_PAGE_MIGRATION_REPORT_KEY;
  const priorReport=control.state[migrationKey];
  control.state[migrationKey]={fromVersion:1,toVersion:2,issues:[{path:"ok",reason:"migrated"},null,{path:"bad"}]};
  assert.deepEqual(await api.getStartPageMigrationReport(),{fromVersion:1,toVersion:2,migratedBlocks:0,skippedBlocks:0,issues:[{path:"ok",reason:"migrated"}]});
  control.state[migrationKey]={fromVersion:1,toVersion:2};
  assert.deepEqual((await api.getStartPageMigrationReport()).issues,[]);
  if(priorReport===undefined)delete control.state[migrationKey];else control.state[migrationKey]=priorReport;
  // Confirmation depends on actual user data, not just widget type.
  const sampleRuntime=await rt.getStartPageRuntimeState();
  const noteSample=api.createBlockInstance("note",{id:"confirmation-note"});
  const taskSample=api.createBlockInstance("localTasks",{id:"confirmation-task"});
  const clockSample=api.createBlockInstance("timer",{id:"confirmation-clock"});
  const taskValue={id:"task",title:"unsaved",done:false,createdAt:1,updatedAt:1};
  sampleRuntime.notes[noteSample.id]="  ";
  assert.equal(api.blockDeletionRequiresDataConfirmation(noteSample,sampleRuntime),false);
  sampleRuntime.notes[noteSample.id]="user note";
  assert.equal(api.blockDeletionRequiresDataConfirmation(noteSample,sampleRuntime),true);
  assert.equal(api.blockDeletionRequiresDataConfirmation({...noteSample,config:{...noteSample.config,confirmDeleteWithContent:false}},sampleRuntime),false);
  assert.equal(api.blockDeletionRequiresDataConfirmation(taskSample,sampleRuntime),false);
  sampleRuntime.tasks[taskSample.id]=[taskValue];
  assert.equal(api.blockDeletionRequiresDataConfirmation(taskSample,sampleRuntime),true);
  assert.equal(api.blockDeletionRequiresDataConfirmation(clockSample,sampleRuntime),false);
  assert.equal(api.blockDeletionRequiresDataConfirmation(singleton,sampleRuntime),false);
  const reduced=(candidate)=>({...baseline,layout:{...baseline.layout,blocks:[candidate]}});
  const empty={...baseline,layout:{...baseline.layout,blocks:[]}};
  assert.equal(api.layoutReplacementRemovesUserData(reduced(noteSample),empty,sampleRuntime),true);
  assert.equal(api.layoutReplacementRemovesUserData(reduced(taskSample),empty,sampleRuntime),true);
  assert.equal(api.layoutReplacementRemovesUserData(reduced(noteSample),reduced(noteSample),sampleRuntime),false);

  // Drive the actual runtime transactions through partial failure and rollback.
  const rollbackBaseline=structuredClone(control.state);
  const previousAlarms=await rt.readClockAlarmSnapshot();
  const aName=rt.clockAlarmName("test","token");
  const originalAlarmGet=chrome.alarms.getAll;
  const originalAlarmCreate=chrome.alarms.create;
  const originalAlarmClear=chrome.alarms.clear;
  const originalLocalSet=chrome.storage.local.set;
  const originalLocalRemove=chrome.storage.local.remove;
  const currentView=await rt.getStartPageViewSnapshot();
  const runtimeBefore=structuredClone(control.state);
  try {
    await assert.rejects(rt.mutateStartPageRuntimeStateWithAlarmsAndStorageEffect(
      r=>{r.notes[noteBlock.id]="tentative";return {state:r,result:7}},
      ["effectTest"],async result=>{assert.equal(result,7);await chrome.storage.local.set({effectTest:true});throw Error("effect failed")}
    ),/effect failed/);
    assert.deepEqual(control.state,runtimeBefore);
    chrome.storage.local.remove=async keys=>{
      if(Array.isArray(keys)&&keys.includes("effectTest"))throw Error("effect rollback failed");
      return originalLocalRemove(keys);
    };
    await assert.rejects(rt.mutateStartPageRuntimeStateWithAlarmsAndStorageEffect(
      r=>{r.notes[noteBlock.id]="tentative";return {state:r,result:7}},
      ["effectTest"],async()=>{await chrome.storage.local.set({effectTest:true});throw Error("effect failed")}
    ),e=>e instanceof AggregateError&&/rollback was incomplete/.test(e.message));
    chrome.storage.local.remove=originalLocalRemove;
    await originalLocalRemove("effectTest");
    assert.deepEqual(control.state,runtimeBefore);
    control.alarms.set(aName,{name:aName,scheduledTime:123});
    let failClear=true;
    chrome.alarms.clear=async name=>{if(failClear){failClear=false;throw Error("clear failed")}return originalAlarmClear(name)};
    await assert.rejects(rt.resetStartPageRuntimeState(),/clear failed/);
    assert.deepEqual(control.state,runtimeBefore);
    assert.ok(control.alarms.has(aName));
    chrome.alarms.clear=async()=>{throw Error("clear always failed")};
    await assert.rejects(rt.resetStartPageRuntimeState(),e=>e instanceof AggregateError&&/restore the previous state/.test(e.message));
    chrome.alarms.clear=originalAlarmClear;
    chrome.alarms.getAll=originalAlarmGet;
    await rt.clearClockAlarm("test");
    assert.equal(control.alarms.has(aName),false);

    // Reset future schemas explicitly; the new revision must exceed all
    // previous valid revisions even when the clock is behind.
    const future=Date.now()+100000;
    control.state.startPageSettings={schemaVersion:999,updatedAt:future};
    control.state.startPageRuntimeState={version:999,updatedAt:future+1};
    control.state.startTabDataRevision={version:999,updatedAt:future+2};
    const reset=await rt.resetStartPageData();
    assert.ok(reset.updatedAt>future+2);
    assert.equal(control.state.startTabDataRevision.version,1);
    assert.equal(control.state.startPageRuntimeState,undefined);
    const fresh=await rt.getStartPageRuntimeState();
    assert.ok(fresh.updatedAt>=reset.updatedAt);
    const rawBefore=structuredClone(control.state);
    control.state.startPageRuntimeState={...fresh,updatedAt:Number.MAX_SAFE_INTEGER};
    await assert.rejects(rt.setStartPageRuntimeState({...fresh,updatedAt:Number.MAX_SAFE_INTEGER}),/safe integer range/);
    control.state.startPageRuntimeState=rawBefore.startPageRuntimeState;
    const testSettings=await api.getStartPageSettings();
    const testRuntime=await rt.getStartPageRuntimeState();
    await assert.rejects(rt.setStartPageRuntimeState({...testRuntime,updatedAt:testRuntime.updatedAt-1}),/runtime changed/);
    const absentBlock=await rt.completeClockInstance("absent",null);
    assert.equal(absentBlock.completed,false);
    assert.equal(absentBlock.block,null);
    const watch=api.createBlockInstance("stopwatch");
    const idle=rt.defaultClockForBlock(watch);
    assert.equal(rt.remainingClockMs(idle),0);
    assert.equal(rt.pauseClockState(idle),idle);
    const running=rt.startClockState(idle,100);
    assert.equal(rt.startClockState(running,200),running);
    assert.equal(rt.elapsedClockMs(running,50),0);
    assert.equal(rt.elapsedClockMs(running,1000000000),7*24*60*60*1000);
    const p=api.createBlockInstance("pomodoro");
    const br=rt.resetClockState(p,"break");
    assert.equal(br.durationMs,p.config.breakSeconds*1000);
    assert.equal(rt.pomodoroFocusElapsedMs({...rt.startClockState(rt.defaultClockForBlock(p),100),targetAt:null},500),400);
    assert.equal(rt.parseClockAlarmName(rt.clockAlarmName("x","")),null);
    assert.equal(rt.parseClockAlarmName(rt.clockAlarmName("x","token").replace("token","%ZZ")),null);
  } finally {
    chrome.alarms.getAll=originalAlarmGet;chrome.alarms.create=originalAlarmCreate;chrome.alarms.clear=originalAlarmClear;
    chrome.storage.local.set=originalLocalSet;chrome.storage.local.remove=originalLocalRemove;
  }
  console.log("Runtime transactions: partial effect rollback, alarm failure, explicit future reset, revision exhaustion, clocks");
  console.log("Settings boundaries: rejected stale/invalid edits, singleton and capacity checks, migrations, data-loss confirmation");

  console.log("Theme normalization and storage: effects, legacy migration, invalid image, duplicate IDs, CRUD, import/export and layout APIs");

  // about:newtab is eligible for fallback redirects but is not an internal
  // split-picker scheme; a malformed current URL must never be redirected.
  {
    const prior=control.calls.filter(c=>c[0]==="update").length;
    const previousTab=control.tab;
    try{
      control.tab={id:301,url:"not a URL"};
      chrome.tabs.onCreated.emit(control.tab);
      await new Promise(resolve=>setTimeout(resolve,30));
      assert.equal(control.calls.filter(c=>c[0]==="update").length,prior);
      control.tab={id:302,url:"about:newtab"};
      chrome.tabs.onCreated.emit(control.tab);
      // Redirect may be disabled in this profile, but eligibility checking
      // must still leave the worker alive and able to handle messages.
      await new Promise(resolve=>setTimeout(resolve,30));
      await ok({type:"block",host:"post-malformed-url.example"});
      assert.ok(control.state.blockedSites.includes("post-malformed-url.example"));
    }finally{control.tab=previousTab}
  }
  // Split markers in query and fragment are part of eligibility, not only
  // the path. A valid internal URL still redirects after those observations.
  {
    const oldManifest=chrome.runtime.getManifest,oldTab=control.tab;
    try{
      chrome.runtime.getManifest=()=>({chrome_url_overrides:{newtab:"newtab.html"}});
      const before=control.calls.filter(c=>c[0]==="update").length;
      for(const url of ["chrome://newtab/?mode=split-view","edge://new-tab/#tab_picker","brave://new_tab/?layout=side-by-side"]){
        control.tab={id:1,url};
        chrome.tabs.onUpdated.emit(1,{url},control.tab);
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(control.calls.filter(c=>c[0]==="update").length,before);
    }finally{chrome.runtime.getManifest=oldManifest;control.tab=oldTab}
  }
  console.log("Worker: real message router, blocklist, document validation, runtime CAS, clocks, notifications, redirect and startup");
} finally { restoreFetch(); }
