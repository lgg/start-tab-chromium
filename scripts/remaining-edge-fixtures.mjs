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
const {installDom}=await import("./ui-fixture-dom.mjs");
const dom=await installDom();
try{
  control.handler=async m=>({ok:true,changed:m.host==="example.com"});
  assert.equal(await bl.unblockHost("example.com"),true);
  assert.equal(await bl.unblockHost("missing.example"),false);
  assert.deepEqual(control.messages.slice(-2),[{type:"unblock",host:"example.com"},{type:"unblock",host:"missing.example"}]);
  await assert.rejects(rt.deleteInstanceRuntime("example"),/requires the current block and runtime revisions/);
  await rt.deleteInstanceRuntime("example",1,2);
  assert.deepEqual(control.messages.at(-1),{type:"delete-instance-runtime",instanceId:"example",expectedBlockUpdatedAt:1,expectedRuntimeUpdatedAt:2});
}finally{dom.window.close()}
console.log("Navigation: failed session lookup, DNR repair, native grant cleanup and UI-to-worker mutation boundaries");
