import assert from "node:assert/strict";
import { installChrome } from "./ui-fixture-dom.mjs";
import * as rev from "../src/lib/data-revision.js";
import * as api from "../src/lib/start-page-settings.js";
import * as defaults from "../src/lib/start-page-defaults.js";
import * as rt from "../src/lib/start-page-runtime.js";
import { restampRestoredState } from "../src/lib/backup-restore-revisions.js";
import { placeGridBlock, gridBlocksOverlap } from "../src/lib/grid-layout.js";
import { MAX_GRID_ROW, MAX_GRID_BLOCK_HEIGHT, MAX_START_PAGE_BLOCKS } from "../src/lib/platform-limits.js";
import { NoteDraft } from "../src/newtab/note-draft.js";
import { WidgetRequestCache } from "../src/newtab/widget-request-cache.js";

const settings=api.createDefaultStartPageSettings(100);
const runtime=rt.normalizeRuntimeState(undefined,settings);
const control=installChrome({startPageSettings:settings,startPageRuntimeState:runtime});
const local=control.chrome.storage.local;
const k=rev.DATA_REVISION_KEY;
await local.set({[k]:{version:1,updatedAt:Number.MAX_SAFE_INTEGER}});
await assert.rejects(rev.readStartTabDataRevision(),/safe integer range/);
await assert.rejects(rev.markStartTabDataChanged(),/safe integer range/);
await local.set({[k]:{version:1,updatedAt:10.25}});
await assert.rejects(rev.readStartTabDataRevision(),/safe integer range/);
await local.set({[k]:{version:2,updatedAt:2000}});
await assert.rejects(rev.readStartTabDataRevision(),/newer extension/);
await assert.rejects(rev.markStartTabDataChanged(1),/newer extension/);
assert.equal(await rev.markStartTabDataChanged(1,{allowFutureOverwrite:true}),2001);
await local.set({[k]:{version:2,updatedAt:"unknown"}});
assert.equal(await rev.markStartTabDataChanged(42,{allowFutureOverwrite:true}),42);
await local.set({[k]:{version:2,updatedAt:Infinity}});
assert.equal(await rev.markStartTabDataChanged(43,{allowFutureOverwrite:true}),43);
await local.set({[k]:{version:2,updatedAt:-10}});
assert.equal(await rev.markStartTabDataChanged(0,{allowFutureOverwrite:true}),1);
const time=Date.now();
assert.ok(await rev.markStartTabDataChanged(NaN)>=time);
await local.remove(k);
assert.equal(await rev.readStartTabDataRevision(100),100);
await rev.assertStartTabDataRevisionUnchanged(100,100,undefined,null);
await local.set({[k]:{version:1,updatedAt:100}});
await assert.rejects(rev.assertStartTabDataRevisionUnchanged(100,100,undefined,null),rev.StartTabDataRevisionConflictError);
const before=await local.get(null);
const oldSet=local.set;
local.set=async values=>{if(Object.hasOwn(values,k))throw Error("revision write refused");return oldSet(values)};
try{
  await assert.rejects(rev.commitStorageMutationWithRevision(["testKey"],()=>local.set({testKey:"new"})),e=>e instanceof AggregateError&&e.errors.length===2);
  assert.equal(control.state.testKey,undefined);
}finally{local.set=oldSet}
assert.deepEqual(await local.get(null),before);
const incoming=structuredClone(settings);
incoming.themes.customThemes=[api.createCustomThemeDraft(incoming,"Restored")];
const incomingRuntime=structuredClone(runtime);
incomingRuntime.tasks["localTasks-main"]=[{id:"t",title:"incoming",done:false,createdAt:1,updatedAt:99999}];
const previous=structuredClone(runtime);
previous.tasks["localTasks-main"]=[{id:"old",title:"previous",done:true,createdAt:1,updatedAt:1000}];
const restored=restampRestoredState(incoming,incomingRuntime,settings,previous,{version:1,updatedAt:500},1);
assert.equal(restored.revision,1001);
assert.equal(restored.runtime.tasks["localTasks-main"][0].updatedAt,1001);
assert.equal(restored.settings.themes.customThemes[0].updatedAt,1001);
assert.equal(incomingRuntime.tasks["localTasks-main"][0].updatedAt,99999);
assert.throws(()=>restampRestoredState(settings,runtime,settings,runtime,{version:1,updatedAt:Number.MAX_SAFE_INTEGER-1},0),/safe integer range/);
assert.throws(()=>restampRestoredState(settings,runtime,settings,runtime,null,Infinity),/safe integer range/);

const high=api.createBlockInstance("note",{id:"high",row:MAX_GRID_ROW,height:MAX_GRID_BLOCK_HEIGHT,width:2});
const candidate=api.createBlockInstance("note",{id:"candidate",row:MAX_GRID_ROW,width:2});
const fallback=placeGridBlock(candidate,[high],2);
assert.equal(fallback.row,1);
assert.equal(gridBlocksOverlap(fallback,high),false);

 // One rendered grid shares coordinates across legacy per-card zones.
{
  const a=api.createBlockInstance("note",{id:"mixed-a",zone:"contained",column:1,row:1,width:4,height:3});
  const b=api.createBlockInstance("note",{id:"mixed-b",zone:"full",column:1,row:1,width:4,height:3});
  assert.equal(gridBlocksOverlap(a,b),true);
  const placed=placeGridBlock(b,[a],12);
  assert.equal(placed.row,a.row+a.height);
  assert.equal(placed.zone,"full");
  assert.equal(gridBlocksOverlap(a,placed),false);
  const imported=api.normalizeStartPageSettings({...settings,layout:{...settings.layout,mode:"grid",columns:12,blocks:[a,b]}});
  assert.equal(imported.layout.blocks[1].row,placed.row);
  assert.equal(gridBlocksOverlap(...imported.layout.blocks),false);
  assert.deepEqual(api.normalizeStartPageSettings(imported),imported);
  assert.equal(placeGridBlock(b,[{...a,enabled:false}],12).row,1);
}

const packed=Array.from({length:MAX_START_PAGE_BLOCKS+1},(_,i)=>api.createBlockInstance("note",{id:"filled-"+i,row:1+i*MAX_GRID_BLOCK_HEIGHT,height:MAX_GRID_BLOCK_HEIGHT,width:2}));
assert.throws(()=>placeGridBlock(candidate,packed,2),/Unable to place/);
assert.throws(()=>defaults.blockDescriptor("invalid"),/Unknown block type/);
const cryptoDescriptor=Object.getOwnPropertyDescriptor(globalThis,"crypto");
try{
  Object.defineProperty(globalThis,"crypto",{configurable:true,value:undefined});
  assert.match(defaults.createBlockId("note"),/^note-[a-z0-9]+-[a-z0-9]+$/);
  assert.match(defaults.createThemeId(),/^theme-[a-z0-9]+-[a-z0-9]+$/);
}finally{Object.defineProperty(globalThis,"crypto",cryptoDescriptor)}
assert.equal(defaults.getTheme(settings,"missing").id,defaults.BUILT_IN_THEMES[0].id);
const custom=api.createCustomThemeDraft(settings,"Custom");
const themed={...settings,themes:{selectedThemeId:custom.id,customThemes:[custom]}};
assert.deepEqual(defaults.getTheme(themed),custom);
assert.notEqual(defaults.getTheme(themed),custom);

const draft=new NoteDraft("base",1);
draft.edit("local");draft.observeCanonical("remote",2);
draft.observeCanonical("stale",1);draft.observeCanonical("bad same revision",2);
draft.edit("base");assert.equal(draft.value,"remote");assert.equal(draft.hasUnsaved,false);
draft.edit("next");const attempt=draft.beginSave();
assert.throws(()=>draft.rebaseForRetry("x",2),/pending/);
draft.fail({...attempt});assert.equal(draft.saving,true);
draft.succeed({...attempt},3);assert.equal(draft.saving,true);
draft.observeCanonical("newer",4);draft.succeed(attempt,3);
assert.equal(draft.value,"newer");
draft.edit("unsaved");const failed=draft.beginSave();draft.fail(failed);
assert.throws(()=>draft.rebaseForRetry("old",3),/changed during conflict/);
draft.rebaseForRetry("newer");assert.equal(draft.value,"unsaved");assert.equal(draft.failed,false);
const legacy=draft.beginSave();draft.succeed(legacy);assert.equal(draft.hasUnsaved,false);
draft.observeCanonical("legacy refreshed");assert.equal(draft.value,"legacy refreshed");

let now=0;
const cache=new WidgetRequestCache(2,()=>now);
let release, reject;
const pending=cache.get("pending",100,()=>new Promise(resolve=>release=resolve));
const failedLoad=cache.get("failed",100,()=>new Promise((_,r)=>reject=r));
await Promise.resolve();
const next=cache.get("next",100,async()=>3);
assert.equal(await next,3);
const replacement=cache.get("pending",100,async()=>4);
assert.equal(await replacement,4);
release(1);reject(Error("evicted failure"));
assert.equal(await pending,1);
await assert.rejects(failedLoad,/evicted failure/);
assert.equal(await cache.get("pending",100,async()=>99),4);
now=101;
assert.equal(await cache.get("pending",100,async()=>5),5);

const alarms=control.chrome.alarms;
const alarmName=rt.clockAlarmName("timer","token");
control.alarms.set(alarmName,{name:alarmName,scheduledTime:123,periodInMinutes:2});
assert.deepEqual(await rt.readClockAlarmSnapshot(),[{name:alarmName,scheduledTime:123,periodInMinutes:2}]);
const oldGetAll=alarms.getAll,oldCreate=alarms.create;
alarms.getAll=async()=>{throw Error("list unavailable")};
let recreated;
alarms.create=async(name,info)=>{recreated={name,...info}};
try{
 await assert.rejects(rt.restoreClockAlarmSnapshot([{name:alarmName,scheduledTime:123,periodInMinutes:2}]),/list unavailable/);
 assert.deepEqual(recreated,{name:alarmName,when:123,periodInMinutes:2});
 alarms.create=async()=>{throw Error("create unavailable")};
 await assert.rejects(rt.restoreClockAlarmSnapshot([{name:alarmName,scheduledTime:123}]),e=>e instanceof AggregateError&&e.errors.length===2);
}finally{alarms.getAll=oldGetAll;alarms.create=oldCreate}
const oldRuntime=structuredClone(control.state.startPageRuntimeState);
control.state.startPageRuntimeState={version:999,updatedAt:100};
await rt.reconcileStoredClockAlarms();
assert.deepEqual(control.state.startPageRuntimeState,{version:999,updatedAt:100});
await assert.rejects(rt.replaceStartPageSettingsWithRuntime(settings,settings.updatedAt,100),/newer extension version/);
control.state.startPageRuntimeState=oldRuntime;
await local.set({startPageOnboarding:{onboarded:true}});
await assert.rejects(rt.replaceStartPageSettingsWithRuntime(settings,settings.updatedAt,runtime.updatedAt,undefined,true),/already completed/);

 // Recovery of a damaged oversized URL collection is deterministic and
 // never keeps a URL for a site that is not actually blocked.
{
  const {MAX_BLOCKED_SITES}=await import("../src/lib/platform-limits.js");
  const {normalizeBackupLastBlockedUrls}=await import("../src/lib/backup-blocked-urls.js");
  const hosts=Array.from({length:MAX_BLOCKED_SITES+1},(_,i)=>"h"+String(i).padStart(5,"0")+".example");
  const raw=Object.fromEntries([...hosts].reverse().map(host=>[host,"https://"+host+"/path"]));
  assert.throws(()=>normalizeBackupLastBlockedUrls(raw,hosts,"strict-import"),/more than/);
  const recovered=normalizeBackupLastBlockedUrls(raw,hosts,"local-recovery");
  assert.equal(Object.keys(recovered).length,MAX_BLOCKED_SITES);
  assert.equal(recovered[hosts[0]],"https://"+hosts[0]+"/path");
  assert.equal(recovered[hosts.at(-1)],undefined);
  const filtered=normalizeBackupLastBlockedUrls(raw,[hosts.at(-1)],"local-recovery");
  assert.deepEqual({...filtered},{[hosts.at(-1)]:"https://"+hosts.at(-1)+"/path"});
}


 // Tab disappearance, unavailable URLs, and a changed pending navigation
 // must never cause a popup to mutate or reload the wrong browser tab.
{
  const {readStablePopupTarget,mayReloadPopupTarget}=await import("../src/popup/popup-target.js");
  const valid={id:7,url:"https://example.com/old"};
  let lookups=0;
  const lookup=async()=>{lookups++;return "example.com"};
  for(const tab of [undefined,{}, {id:7},{id:7,url:""},{id:7,url:"chrome://settings/"}]){
    assert.equal(await readStablePopupTarget(async()=>tab,lookup),null);
  }
  assert.equal(lookups,0);
  const observations=[valid,{id:7,pendingUrl:"https://example.com/new",url:valid.url}];
  const target=await readStablePopupTarget(async()=>observations.shift(),lookup);
  assert.deepEqual(target,{tabId:7,url:"https://example.com/new",host:"example.com",blockedHost:"example.com"});
  assert.equal(mayReloadPopupTarget(target,undefined),false);
  assert.equal(mayReloadPopupTarget(target,{id:7}),false);
  assert.equal(mayReloadPopupTarget(target,{...valid,pendingUrl:"https://elsewhere.example/"}),false);
  // The new URL was the displayed target; the previously committed
  // URL is not safe to reload even though it has the same hostname.
  assert.equal(mayReloadPopupTarget(target,{...valid,pendingUrl:valid.url}),false);
  assert.equal(mayReloadPopupTarget(target,{id:7,url:target.url}),true);
  assert.equal(mayReloadPopupTarget(target,{id:7,url:target.url,pendingUrl:target.url}),true);
  assert.equal(mayReloadPopupTarget(target,{id:7,url:target.url,pendingUrl:valid.url}),false);
  assert.equal(mayReloadPopupTarget(target,{id:7,url:"https://example.com/newer"}),false);
  for(const next of [undefined,{id:8,url:valid.url},{id:7,url:"https://elsewhere.example/"},{id:7,pendingUrl:"chrome://settings/",url:valid.url}]){
    const states=[valid,next];
    assert.equal(await readStablePopupTarget(async()=>states.shift(),lookup),null);
  }
  const {isBlockedPageNavigation,BlockedNavigationRegistry}=await import("../src/lib/blocked-navigation.js");
  assert.equal(isBlockedPageNavigation("not a URL","https://extension.example/blocked.html"),false);
  assert.equal(isBlockedPageNavigation("https://extension.example/blocked.html","not a URL"),false);
  const registry=new BlockedNavigationRegistry(()=>{throw Error("invalid tab must not access storage")});
  for(const id of [-1,NaN,1.5,undefined]){
    assert.equal(await registry.observe(id,"https://example.com/",async()=>{throw Error("invalid tab must not resolve")}),null);
    assert.equal(await registry.lookup(id,"example.com"),null);
    await registry.forget(id);
  }
}

console.log("Revision, restore, grid bounds, note conflict, cache eviction, native defaults and alarm failure boundary matrix");

const navigation=await import("../src/lib/blocked-navigation.js");
const page="https://extension.example/blocked.html";
const blockedUrl=page+"?site=example.com";
const sender={tab:{id:1},frameId:0,url:blockedUrl};
assert.equal(await navigation.readBlockedDestinationForSender(sender,page,"example.com",async()=>({id:1,url:blockedUrl}),async()=>{throw Error("session storage unavailable")}),null);
const bl=await import("../src/lib/blocklist.js");
await bl.replaceBlockedSites(["example.com"]);
await bl.rememberBlockedNavigation("https://example.com/path");
await bl.blockHost("new.example");
assert.equal(await bl.getLastBlockedUrl("example.com"),"https://example.com/path");
const dnr=control.chrome.declarativeNetRequest;
const beforeRules=await bl.readDynamicRulesSnapshot();
await dnr.updateDynamicRules({removeRuleIds:beforeRules.map(rule=>rule.id)});
const originalUpdate=dnr.updateDynamicRules;
let failOnce=true;
dnr.updateDynamicRules=async options=>{if(failOnce){failOnce=false;throw Error("repair unavailable")}return originalUpdate(options)};
try{
  await assert.rejects(bl.blockHost("new.example"),/repair unavailable/);
  assert.deepEqual(await bl.readDynamicRulesSnapshot(),[]);
  assert.deepEqual(control.state.blockedSites,["example.com","new.example"]);
}finally{dnr.updateDynamicRules=originalUpdate}
await bl.blockHost("new.example");
assert.deepEqual(await bl.readDynamicRulesSnapshot(),beforeRules);
const native=await import("../src/lib/native-new-tab.js");
const tabs=control.chrome.tabs;
const originalCreateTab=tabs.create,originalGetTab=tabs.get,originalUpdateTab=tabs.update,originalRemoveTab=tabs.remove,originalRemoveStorage=local.remove;
const removedTabs=[];
tabs.create=async options=>{control.tab={id:9,...options};return {...control.tab}};
tabs.get=async()=>({...control.tab});
tabs.update=async(id,options)=>{control.tab={id,...options};throw Error("navigation unavailable")};
tabs.remove=async id=>removedTabs.push(id);
local.remove=async keys=>{if(keys===native.NATIVE_NEW_TAB_BYPASS_KEY)throw Error("grant cleanup unavailable");return originalRemoveStorage(keys)};
try{
  await assert.rejects(native.openNativeNewTab({consumptionTimeoutMs:1,pollIntervalMs:1}),e=>e instanceof AggregateError&&e.errors.some(cause=>cause.message==="grant cleanup unavailable"));
  assert.deepEqual(removedTabs,[9]);
}finally{tabs.create=originalCreateTab;tabs.get=originalGetTab;tabs.update=originalUpdateTab;tabs.remove=originalRemoveTab;local.remove=originalRemoveStorage}
await local.remove(native.NATIVE_NEW_TAB_BYPASS_KEY);

 // The asynchronous bypass read can finish after the grant's deadline.
 // Do not sleep for a negative delay or retry against an already expired
 // lease; continue the browser fallback sequence and clean up the tab.
{
  const originalNow=Date.now, originalGet=local.get;
  const originalCreate=tabs.create, originalTabGet=tabs.get, originalTabUpdate=tabs.update, originalTabRemove=tabs.remove;
  let now=100000,attempts=0,removed=[];
  Date.now=()=>now;
  tabs.create=async options=>{control.tab={id:73,...options};return {...control.tab}};
  tabs.get=async()=>({...control.tab});
  tabs.update=async(id,options)=>{attempts++;control.tab={id,...options};return {...control.tab}};
  tabs.remove=async id=>{removed.push(id)};
  local.get=async keys=>{
    const result=await originalGet(keys);
    if(keys===native.NATIVE_NEW_TAB_BYPASS_KEY&&result[keys]?.tabId===73&&!result[keys].consumedAt)now+=100;
    return result;
  };
  try{
    await assert.rejects(native.openNativeNewTab({consumptionTimeoutMs:10,pollIntervalMs:1}),e=>e instanceof AggregateError&&e.errors.length===3);
    assert.equal(attempts,3);
    assert.deepEqual(removed,[73]);
    assert.equal(control.state[native.NATIVE_NEW_TAB_BYPASS_KEY],undefined);
  }finally{Date.now=originalNow;local.get=originalGet;tabs.create=originalCreate;tabs.get=originalTabGet;tabs.update=originalTabUpdate;tabs.remove=originalTabRemove}
}

// The clock can cross the expiry boundary between two synchronous reads.
// The consumer must use the timestamp at which it actually checked the lease.
{
  const originalNow=Date.now;
  const key=native.NATIVE_NEW_TAB_BYPASS_KEY;
  let now=100000;
  try {
    await local.set({[key]:{tabId:73,expiresAt:100001}});
    Date.now=()=>now++;
    assert.equal(await native.consumeNativeNewTabBypass(73),true);
    assert.deepEqual(control.state[key],{tabId:73,expiresAt:100001,consumedAt:100000});
    assert.equal(await native.consumeNativeNewTabBypass(73),false);
    assert.equal(control.state[key],undefined);

    // An invalid existing acknowledgement must not be treated as valid.
    await local.set({[key]:{tabId:73,expiresAt:200000,consumedAt:200001}});
    const consumedAt=now;
    assert.equal(await native.consumeNativeNewTabBypass(73),true);
    assert.equal(control.state[key].consumedAt,consumedAt);
  } finally {
    Date.now=originalNow;
    await local.remove(key);
  }
}

// An acknowledgement at or beyond the deadline is not successful
// consumption, even if it is returned by an asynchronous storage read.
{
  const originalNow=Date.now, originalGet=local.get;
  const originalCreate=tabs.create, originalTabGet=tabs.get, originalTabUpdate=tabs.update, originalTabRemove=tabs.remove;
  const key=native.NATIVE_NEW_TAB_BYPASS_KEY;
  let now=100000,attempts=0;
  const removed=[];
  Date.now=()=>now;
  tabs.create=async options=>{control.tab={id:73,...options};return {...control.tab}};
  tabs.get=async()=>({...control.tab});
  tabs.update=async(id,options)=>{attempts++;control.tab={id,...options};return {...control.tab}};
  tabs.remove=async id=>{removed.push(id)};
  local.get=async keys=>{
    const result=await originalGet(keys);
    if(keys===key&&result[keys]?.tabId===73){
      const grant=result[keys];
      now=grant.expiresAt;
      return {...result,[key]:{...grant,consumedAt:grant.expiresAt}};
    }
    return result;
  };
  try{
    await assert.rejects(native.openNativeNewTab({consumptionTimeoutMs:10,pollIntervalMs:1}),/rejected every native/);
    assert.equal(attempts,3);
    assert.deepEqual(removed,[73]);
    assert.equal(control.state[key],undefined);
  }finally{Date.now=originalNow;local.get=originalGet;tabs.create=originalCreate;tabs.get=originalTabGet;tabs.update=originalTabUpdate;tabs.remove=originalTabRemove}
}

const {installDom}=await import("./ui-fixture-dom.mjs");
const dom=await installDom();
try{

  const {focusExistingSettingsDialog,nextSettingsDialogTitleId}=await import("../src/lib/settings-dialog-guard.js");
  assert.equal(focusExistingSettingsDialog(),false);
  const emptyDialog=document.createElement("dialog");
  emptyDialog.className="settings-dialog";emptyDialog.setAttribute("open","");emptyDialog.tabIndex=-1;
  document.body.append(emptyDialog);
  assert.equal(focusExistingSettingsDialog(),true);
  assert.equal(document.activeElement,emptyDialog);
  const enabledButton=document.createElement("button");
  emptyDialog.append(enabledButton);
  assert.equal(focusExistingSettingsDialog(),true);
  assert.equal(document.activeElement,enabledButton);
  assert.notEqual(nextSettingsDialogTitleId("settings"),nextSettingsDialogTitleId("settings"));
  emptyDialog.remove();
  control.handler=async m=>({ok:true,changed:m.host==="example.com"});
  assert.equal(await bl.unblockHost("example.com"),true);
  assert.equal(await bl.unblockHost("missing.example"),false);
  assert.deepEqual(control.messages.slice(-2),[{type:"unblock",host:"example.com"},{type:"unblock",host:"missing.example"}]);
  await assert.rejects(rt.deleteInstanceRuntime("example"),/requires the current block and runtime revisions/);
  await rt.deleteInstanceRuntime("example",1,2);
  assert.deepEqual(control.messages.at(-1),{type:"delete-instance-runtime",instanceId:"example",expectedBlockUpdatedAt:1,expectedRuntimeUpdatedAt:2});
}finally{dom.window.close()}
console.log("Navigation: failed session lookup, DNR repair, native grant cleanup and UI-to-worker mutation boundaries");

 // Residual pure helpers: success/failure isolation, stable JSON, missing
 // navigation metadata, and a task acknowledgement with mismatched text.
{
  const {runIndependentEffects}=await import("../src/lib/independent-effects.js");
  const calls=[];
  await runIndependentEffects([async()=>{calls.push(1)},async()=>{calls.push(2)}],"effects");
  assert.deepEqual(calls,[1,2]);
  const first=Error("first"),second=Error("second");
  await assert.rejects(runIndependentEffects([async()=>{throw first},async()=>{calls.push(3)}],"effects"),error=>error===first);
  assert.deepEqual(calls,[1,2,3]);
  await assert.rejects(runIndependentEffects([async()=>{throw first},async()=>{calls.push(4);throw second},async()=>{calls.push(5)}],"effects"),error=>error instanceof AggregateError&&error.message==="effects"&&error.errors[0]===first&&error.errors[1]===second);
  assert.deepEqual(calls,[1,2,3,4,5]);
  const {canonicalJsonValue,jsonContentEqual}=await import("../src/lib/json-content.js");
  assert.deepEqual(canonicalJsonValue({z:1,a:[{b:2,a:1},null]}),{a:[{a:1,b:2},null],z:1});
  assert.equal(jsonContentEqual({z:1,a:2},{a:2,z:1}),true);
  assert.equal(jsonContentEqual([1,2],[2,1]),false);
  const {containsSplitViewMarker,SPLIT_VIEW_MARKERS}=await import("../src/lib/split-view-markers.js");
  assert.equal(containsSplitViewMarker(null),false);
  assert.equal(containsSplitViewMarker(undefined),false);
  for(const marker of SPLIT_VIEW_MARKERS)assert.equal(containsSplitViewMarker("prefix-"+marker.toUpperCase()+"-suffix"),true);
  const {NewTabRedirectGuard,currentTabNavigationUrl,changedTabNavigationUrl}=await import("../src/lib/tab-navigation-change.js");
  const calls2=[];
  const guard=new NewTabRedirectGuard({isEligible:()=>true,getTab:async()=>{calls2.push("get");throw Error("tab closed")},shouldBypass:async()=>false,isEnabled:async()=>true,redirect:async()=>{calls2.push("redirect")}});
  await guard.observe(undefined,"chrome://newtab/");
  await guard.observe(1,undefined);
  assert.deepEqual(calls2,[]);
  await guard.observe(1,"chrome://newtab/");
  assert.deepEqual(calls2,["get"]);
  assert.equal(currentTabNavigationUrl({url:"old",pendingUrl:""}),"old");
  assert.equal(changedTabNavigationUrl({url:42}),null);
  const {TaskFormSession}=await import("../src/newtab/task-submission-gate.js");
  const taskSession=new TaskFormSession();
  taskSession.draft="next draft";
  const draft=taskSession.snapshotDraft();
  taskSession.acknowledge({...draft,value:"different"});
  assert.equal(taskSession.draft,"next draft");
  taskSession.acknowledge(draft);
  assert.equal(taskSession.draft,"");
  const {formatDateParts,createDatePartsFormatter}=await import("../src/newtab/date-pattern.js");
  assert.equal(formatDateParts("YYYY-MM DD HH:mm:ss",{}),"-MM  ::");
  assert.equal(createDatePartsFormatter("en-GB","UTC")(new Date("2026-11-26T12:34:56Z")).hour,"12");
  
  // A direct guarded import does not require the optional legacy fallback
  // when a durable revision exists. A stale revision must reject before any
  // DNR or storage change; a matching revision commits atomically.
  {
    const {exportBackup,importBackup}=await import("../src/lib/backup.js");
    const priorChrome=globalThis.chrome;
    const fresh=installChrome({startPageSettings:settings,startPageRuntimeState:runtime,
      blockedSites:["old-import.example"],startTabDataRevision:{version:1,updatedAt:4000}});
    try{
      const bundle=await exportBackup();
      bundle.storage.blockedSites=["new-import.example"];
      const snapshot=await fresh.chrome.storage.local.get(null);
      const rules=await fresh.chrome.declarativeNetRequest.getDynamicRules();
      await assert.rejects(importBackup(bundle,{expectedCurrentDataRevision:3999}),rev.StartTabDataRevisionConflictError);
      assert.deepEqual(await fresh.chrome.storage.local.get(null),snapshot);
      assert.deepEqual(await fresh.chrome.declarativeNetRequest.getDynamicRules(),rules);
      await importBackup(bundle,{expectedCurrentDataRevision:4000});
      assert.deepEqual(fresh.state.blockedSites,["new-import.example"]);
      assert.ok(fresh.state.startTabDataRevision.updatedAt>4000);
    }finally{globalThis.chrome=priorChrome}
  }

  // Starting a new request cleans up expired completion cooldowns but
  // cannot release a different instance's outstanding request.
  {
    const {ClockRequestGate}=await import("../src/newtab/clock-request-gate.js");
    let time=0;
    const gate=new ClockRequestGate(()=>time,100);
    const old=gate.begin("first","token-1");
    assert.ok(old);gate.finish(old);
    const live=gate.begin("second","token-2");
    assert.ok(live);
    assert.equal(gate.canComplete("first","token-1"),false);
    assert.equal(gate.begin("first","token-1"),null);
    time=101;
    const retry=gate.begin("first","token-1");
    assert.ok(retry);
    gate.finish(old);
    assert.equal(gate.isPending("first"),true);
    assert.equal(gate.isPending("second"),true);
    gate.finish(retry);gate.finish(live);
    assert.equal(gate.canComplete("first","token-1"),false);
    assert.equal(gate.canComplete("first","new-token"),true);
  }
  // A sparse JS layout is not a matching preset merely because it has
  // the right length and grid geometry. Missing entries must fail safely.
  {
    const candidate=api.settingsWithLayoutPreset(settings,"focus");
    assert.equal(api.layoutMatchesPreset(candidate,"focus"),true);
    delete candidate.layout.blocks[1];
    assert.equal(api.layoutMatchesPreset(candidate,"focus"),false);
  }

  // A newer observed navigation supersedes an old redirect even if the
  // Chrome API's last read still returns the old new-tab URL.
  {
    const {NewTabRedirectGuard}=await import("../src/lib/tab-navigation-change.js");
    const redirects=[];
    let release,reads=0;
    const guard=new NewTabRedirectGuard({
      isEligible:url=>url==="chrome://newtab/",
      getTab:async()=>{reads++;return {url:"chrome://newtab/"}},
      shouldBypass:()=>new Promise(resolve=>{release=resolve}),
      isEnabled:async()=>true,
      redirect:async id=>{redirects.push(id)}
    });
    const first=guard.observe(1,"chrome://newtab/");
    for(let attempt=0;!release&&attempt<100;attempt++)await Promise.resolve();
    assert.ok(release,"redirect guard did not reach the bypass check");
    await guard.observe(1,"https://user-chosen.example/");
    release(false);
    await first;
    assert.equal(reads,1);
    assert.deepEqual(redirects,[]);
    release=undefined;
    const next=guard.observe(1,"chrome://newtab/");
    for(let attempt=0;!release&&attempt<100;attempt++)await Promise.resolve();
    assert.ok(release,"redirect guard did not reach the bypass check");
    release(false);
    await next;
    assert.deepEqual(redirects,[1]);
  }
  // Malformed historical storage must be removed without touching the
  // current DNR rules or leaking URLs from a previously blocked profile.
  {
    const bl=await import("../src/lib/blocklist.js");
    const priorChrome=globalThis.chrome;
    const fresh=installChrome({blockedSites:["blocked.example"],lastBlockedUrls:["https://blocked.example/old"]});
    try{
      await bl.syncRules();
      const rules=await fresh.chrome.declarativeNetRequest.getDynamicRules();
      await bl.clearLastBlockedUrl("blocked.example");
      assert.equal(Object.hasOwn(fresh.state,"lastBlockedUrls"),false);
      assert.deepEqual(await fresh.chrome.declarativeNetRequest.getDynamicRules(),rules);
      assert.equal(await bl.rememberBlockedNavigation("https://blocked.example/new"),"blocked.example");
      assert.equal(await bl.getLastBlockedUrl("blocked.example"),"https://blocked.example/new");
    }finally{globalThis.chrome=priorChrome}
  }

  // Normalizing a legacy custom theme ID can reveal a collision that was
  // not apparent in the raw ID. Creating the legacy theme must allocate a
  // fresh ID and must never overwrite the existing theme.
  {
    const priorChrome=globalThis.chrome;
    const fresh=installChrome({startPageSettings:settings,startPageRuntimeState:runtime});
    try{
      const original=await api.saveNewCustomTheme({...api.createCustomThemeDraft(settings,"Original"),id:"legacy-theme-id"});
      const saved=await api.updateCustomTheme({...original,id:" legacy-theme-id ",name:"Imported legacy theme"});
      assert.notEqual(saved.id,original.id);
      assert.equal(saved.name,"Imported legacy theme");
      const state=await api.getStartPageSettings();
      assert.equal(state.themes.customThemes.length,2);
      assert.equal(state.themes.customThemes.find(t=>t.id===original.id).name,"Original");
      assert.equal(state.themes.selectedThemeId,saved.id);
    }finally{globalThis.chrome=priorChrome}
  }

  // Invalid new IDs must fail before publishing any settings or revision.
  // Even a browser UUID collision cannot cause a duplicate API to return
  // the existing object rather than the newly committed entity.
  {
    const priorChrome=globalThis.chrome;
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,"crypto");
    const fresh=installChrome({startPageSettings:settings,startPageRuntimeState:runtime});
    try{
      const before=await fresh.chrome.storage.local.get(null);
      for(const id of [""," spaced id ","bad/id","x".repeat(161)]){
        await assert.rejects(api.saveNewBlockInstance(api.createBlockInstance("note",{id})),/Invalid block instance identity/);
        assert.deepEqual(await fresh.chrome.storage.local.get(null),before);
      }
      Object.defineProperty(globalThis,"crypto",{configurable:true,value:{randomUUID:()=>"fixed-uuid"}});
      const a=await api.addBlockInstance("note");
      const b=await api.addBlockInstance("note");
      const c=await api.duplicateBlockInstance(a.id,"Copied note");
      assert.deepEqual([a.id,b.id,c.id],["note-fixed-uuid","note-fixed-uuid-2","note-fixed-uuid-3"]);
      assert.equal(c.title,"Copied note");
      const theme=await api.saveNewCustomTheme(api.createCustomThemeDraft(await api.getStartPageSettings(),"First"));
      const duplicate=await api.duplicateTheme(theme.id,"Second");
      const imported=await api.importCustomTheme(api.exportCustomTheme(theme));
      const third=await api.saveNewCustomTheme({...theme,name:"Fourth"});
      const legacy=await api.updateCustomTheme({...theme,id:" "+theme.id+" ",name:"Fifth"});
      const blank=await api.saveNewCustomTheme({...theme,id:" ",name:"Normalized"});
      const migrated=await api.updateCustomTheme({...theme,id:" start-tab-dark ",name:"Legacy built-in collision"});
      const state=await api.getStartPageSettings();
      assert.equal(theme.id,"theme-fixed-uuid");
      assert.equal(duplicate.id,"theme-fixed-uuid-2");
      assert.equal(imported.theme.id,"theme-fixed-uuid-3");
      assert.equal(third.id,"theme-fixed-uuid-4");
      assert.equal(legacy.id,"theme-fixed-uuid-5");
      assert.equal(blank.id,"custom-theme");
      assert.equal(migrated.id,"theme-fixed-uuid-6");
      assert.equal(state.themes.customThemes.length,7);
      assert.equal(state.themes.selectedThemeId,migrated.id);
      assert.equal(state.themes.customThemes.find(t=>t.id===theme.id).name,"First");
      assert.equal(state.layout.blocks.find(b=>b.id===c.id).title,"Copied note");
      assert.equal(state.layout.blocks.length,settings.layout.blocks.length+3);
    }finally{
      globalThis.chrome=priorChrome;
      if(descriptor)Object.defineProperty(globalThis,"crypto",descriptor);else delete globalThis.crypto;
    }
  }

  // DNR rollback accepts only owned snapshots. Chrome may reorder the
  // object properties and rule list; that is not a reason to rewrite rules.
  {
    const bl=await import("../src/lib/blocklist.js");
    const priorChrome=globalThis.chrome;
    const fresh=installChrome({blockedSites:["a.example","b.example"]});
    const dnr=fresh.chrome.declarativeNetRequest;
    try{
      const foreign={id:900,priority:1,action:{type:"block"},condition:{requestDomains:["foreign.example","another.example"],resourceTypes:["main_frame","sub_frame"]}};
      await dnr.updateDynamicRules({addRules:[foreign]});
      await bl.syncRules();
      const snapshot=await bl.readDynamicRulesSnapshot();
      assert.equal(snapshot.length,2);
      const before=await dnr.getDynamicRules();
      const update=dnr.updateDynamicRules;
      let writes=0;
      dnr.updateDynamicRules=async options=>{writes++;return update(options)};
      const reordered=[...snapshot].reverse().map(rule=>({condition:{resourceTypes:[...rule.condition.resourceTypes],requestDomains:[...rule.condition.requestDomains]},action:{redirect:{url:rule.action.redirect.url},type:rule.action.type},priority:rule.priority,id:rule.id}));
      await bl.restoreDynamicRulesSnapshot(reordered);
      assert.equal(writes,0);
      for(const invalid of [[...snapshot,foreign],[snapshot[0],snapshot[0]]]){
        await assert.rejects(bl.restoreDynamicRulesSnapshot(invalid),/Invalid blocklist dynamic-rule snapshot/);
        assert.equal(writes,0);
        assert.deepEqual(await dnr.getDynamicRules(),before);
      }
      await fresh.chrome.storage.local.set({blockedSites:["changed.example"]});
      await bl.syncRules();
      await bl.restoreDynamicRulesSnapshot(snapshot);
      assert.deepEqual(await bl.readDynamicRulesSnapshot(),snapshot);
      assert.deepEqual((await dnr.getDynamicRules()).find(rule=>rule.id===foreign.id),foreign);
    }finally{globalThis.chrome=priorChrome}
  }
  // A tab can be closed while eligibility is being checked, and a newer
  // observation can arrive synchronously from the platform's URL getter.
  {
    const {NewTabRedirectGuard}=await import("../src/lib/tab-navigation-change.js");
    let redirects=0,release;
    const guard=new NewTabRedirectGuard({
      isEligible:url=>url==="chrome://newtab/",
      getTab:()=>new Promise(resolve=>{release=resolve}),
      shouldBypass:async()=>false,
      isEnabled:async()=>true,
      redirect:async()=>{redirects++}
    });
    const first=guard.observe(7,"chrome://newtab/");
    assert.ok(release);
    guard.cancel(7);
    release({url:"chrome://newtab/"});
    await first;
    assert.equal(redirects,0);
    const second=guard.observe(7,"chrome://newtab/");
    const releaseFirst=release;
    releaseFirst({url:"chrome://newtab/"});
    await Promise.resolve();await Promise.resolve();await Promise.resolve();await Promise.resolve();
    // Cancel any still pending final inspection before allowing it to finish.
    guard.cancel(7);
    release({url:"chrome://newtab/"});
    await second;
    assert.equal(redirects,0);
  }
console.log("Residual helpers: effect aggregation, canonical data, split-view markers, tab lifecycle and draft acknowledgement");
}



// The live-tab URL accessor can synchronously invalidate the observation.
// Even a successful final inspection must not redirect after that cancellation.
{
  const { NewTabRedirectGuard } = await import("../src/lib/tab-navigation-change.js");
  const url = "chrome://newtab/";
  let reads = 0, redirects = 0;
  const guard = new NewTabRedirectGuard({
    isEligible: value => value === url,
    getTab: async () => {
      if (++reads === 1) return { url };
      return { get url() { guard.cancel(42); return url; } };
    },
    shouldBypass: async () => false,
    isEnabled: async () => true,
    redirect: async () => { redirects++; }
  });
  await guard.observe(42, url);
  assert.equal(reads, 2);
  assert.equal(redirects, 0);
}

// An obsolete or declined discard must not re-render or lose a hidden draft.
// A pending draft cannot be discarded; the next successful action can render.
{
  const { installDom, i18n } = await import("./ui-fixture-dom.mjs");
  const { renderHiddenTextDrafts } = await import("../src/newtab/hidden-text-drafts.js");
  const dom = await installDom();
  try {
    const host = document.createElement("section");
    document.body.append(host);
    let discards = 0, renders = 0, allowDiscard = false;
    const errors = [];
    const context = { i18n, reportError: error => errors.push(error), requestRender: () => { renders++; } };
    const draft = { kind: "search", title: "", value: "unfinished query", pending: false,
      discard: () => { discards++; return allowDiscard; } };
    const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
    renderHiddenTextDrafts(host, [draft], context);
    const text = host.querySelector("textarea");
    const [select, discard] = host.querySelectorAll("button");
    assert.equal(text.value, draft.value);
    assert.equal(text.readOnly, true);
    assert.equal(text.getAttribute("aria-label"), "hiddenSearchDraft");
    select.click();
    await flush();
    assert.equal(document.activeElement, text);
    window.confirm = () => false;
    discard.click();
    await flush();
    assert.equal(discards, 0);
    window.confirm = () => true;
    discard.click();
    await flush();
    assert.equal(discards, 1);
    assert.equal(renders, 0);
    assert.equal(text.value, draft.value);
    renderHiddenTextDrafts(host, [{ ...draft, pending: true }], context);
    const pendingDiscard = host.querySelectorAll("button")[1];
    assert.equal(pendingDiscard.disabled, true);
    pendingDiscard.click();
    pendingDiscard.dispatchEvent(new window.Event("click",{bubbles:true}));
    discard.click();
    select.click();
    await flush();
    assert.equal(discards, 1);
    assert.equal(renders, 0);
    renderHiddenTextDrafts(host, [draft], context);
    allowDiscard = true;
    host.querySelectorAll("button")[1].click();
    await flush();
    assert.equal(discards, 2);
    assert.equal(renders, 1);
    renderHiddenTextDrafts(host, [], context);
    assert.equal(host.hidden, true);
    assert.equal(host.childNodes.length, 0);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
}

// A zero-capacity request still retains one entry; rejected or evicted
// operations must not delete a replacement with the same key.
{
  let rejectOld;
  const cache = new WidgetRequestCache(0, () => 0);
  const old = cache.get("a", 100, () => new Promise((_, reject) => { rejectOld = reject; }));
  await Promise.resolve();
  assert.equal(cache.get("a", 100, async () => 99), old);
  assert.equal(await cache.get("b", 100, async () => 2), 2);
  assert.equal(await cache.get("a", 100, async () => 3), 3);
  rejectOld(new Error("obsolete request"));
  await assert.rejects(old, /obsolete request/);
  assert.equal(await cache.get("a", 100, async () => 99), 3);
}
console.log("Round 158: live-tab cancellation, hidden draft discard boundaries and single-entry cache eviction");
