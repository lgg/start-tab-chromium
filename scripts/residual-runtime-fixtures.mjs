import assert from "node:assert/strict";
import { installChrome } from "./ui-fixture-dom.mjs";
import * as api from "../src/lib/start-page-settings.js";
import * as rt from "../src/lib/start-page-runtime.js";
import * as v from "../src/lib/start-page-validation-primitives.js";
import { MAX_START_PAGE_BLOCKS } from "../src/lib/platform-limits.js";

const settings=api.createDefaultStartPageSettings(100);
const timer=api.createBlockInstance("timer",{id:"timer-test",config:{type:"timer",durationSeconds:5,notifyOnComplete:false}});
const pomodoro=api.createBlockInstance("pomodoro",{id:"pomodoro-test",config:{type:"pomodoro",workSeconds:60,breakSeconds:30,notifyOnComplete:false,autoStartNextPhase:true}});
const note=api.createBlockInstance("note",{id:"note-test"});
const tasks=api.createBlockInstance("localTasks",{id:"tasks-test"});
const links=api.createBlockInstance("links",{id:"links-test"});
settings.layout.blocks=[timer,pomodoro,note,tasks,links];
const initial=rt.normalizeRuntimeState(undefined,settings);
const control=installChrome({startPageSettings:settings,startPageRuntimeState:initial});
const local=control.chrome.storage.local,alarms=control.chrome.alarms;
const get=local.get,set=local.set,remove=local.remove,create=alarms.create,clear=alarms.clear;
const legacy=rt.normalizeRuntimeState({clocks:{timer:{running:true,startedAt:100,durationMs:5000}},tasks:{[tasks.id]:[null,{title:12},{title:" "},{title:"Task",done:true}]},linkPages:{links:2}},settings,{clocks:{[pomodoro.id]:{running:true,startedAt:200,phase:"break",durationMs:30000}},linkPages:{[links.id]:3}});
assert.equal(legacy.clocks[timer.id].running,true);
assert.match(legacy.clocks[timer.id].completionToken,/^legacy-timer-/);
assert.equal(legacy.clocks[pomodoro.id].phase,"break");
assert.deepEqual(legacy.tasks[tasks.id].map(t=>t.title),["Task"]);
assert.equal(legacy.linkPages[links.id],3);
assert.equal(rt.instanceRuntimeHasUserData(tasks.id,legacy),true);
assert.equal(rt.instanceRuntimeHasUserData("missing",legacy),false);
const idle=rt.defaultClockForBlock(timer);
assert.equal(rt.startClockState({...idle,accumulatedMs:1000},100).accumulatedMs,1000);
const descriptor=Object.getOwnPropertyDescriptor(globalThis,"crypto");
try{
  Object.defineProperty(globalThis,"crypto",{configurable:true,value:undefined});
  assert.match(rt.startClockState(idle,100).completionToken,/^[a-z0-9]+-[a-z0-9]+$/);
}finally{Object.defineProperty(globalThis,"crypto",descriptor)}

const legacyKey=rt.LEGACY_INSTANCE_RUNTIME_KEY;
await local.set({[legacyKey]:{localTasks:{[tasks.id]:[{id:"legacy",title:"Imported",done:false}]}}});
await local.remove(rt.START_PAGE_RUNTIME_KEY);
const migrated=await rt.getStartPageRuntimeState();
assert.equal(migrated.tasks[tasks.id][0].title,"Imported");
assert.equal(control.state[legacyKey],undefined);
const canonicalSettings=await api.getStartPageSettings();
const base=await rt.getStartPageRuntimeState();
await local.set({[rt.START_PAGE_RUNTIME_KEY]:{version:999,updatedAt:100}});
await assert.rejects(rt.mutateStartPageRuntimeState(r=>({state:r,result:null})),/newer extension/);
await rt.scheduleClockAlarm(timer.id,idle);
await rt.rearmClockAlarmIfPending(timer.id,"old",100);
assert.equal(control.alarms.size,0);
await local.set({[rt.START_PAGE_RUNTIME_KEY]:base});
await assert.rejects(rt.deleteInstanceRuntime(note.id,note.updatedAt),/revision validation is incomplete/);
const running=rt.startClockState(rt.defaultClockForBlock(pomodoro),Date.now()-120000);
await rt.updateStartPageRuntimeState(r=>{r.clocks[pomodoro.id]=running;return r});
const completed=await rt.completeClockInstance(pomodoro.id,running.completionToken);
assert.equal(completed.completed,true);
assert.equal(completed.clock.phase,"break");
assert.equal(completed.clock.running,true);
assert.equal(completed.notify,false);
const breakClock={...completed.clock,startedAt:Date.now()-60000,targetAt:Date.now()-30000};
await rt.updateStartPageRuntimeState(r=>{r.clocks[pomodoro.id]=breakClock;return r});
const work=await rt.completeClockInstance(pomodoro.id,breakClock.completionToken);
assert.equal(work.clock.phase,"work");
assert.equal(work.startedWork,true);
assert.ok(work.clock.focusSessionStartedAt>0);

const prior=await local.get(null);
const savedAlarms=await rt.readClockAlarmSnapshot();
let failures=0;
alarms.create=async()=>{failures++;throw Error("alarm create unavailable")};
try{
  await assert.rejects(rt.reconcileClockAlarmsForRuntime(await rt.getStartPageRuntimeState()),e=>e instanceof AggregateError&&/previous alarm set/.test(e.message));
  assert.ok(failures>=2);
}finally{alarms.create=create}
await rt.restoreClockAlarmSnapshot(savedAlarms);
assert.deepEqual(await local.get(null),prior);
const snapshot=await rt.getStartPageViewSnapshot();
const oldSet=local.set;
local.set=async items=>{if(Object.hasOwn(items,"startPageOnboarding"))throw Error("onboarding write refused");return oldSet(items)};
try{
  await assert.rejects(rt.replaceStartPageSettingsWithRuntime(snapshot.settings,snapshot.settings.updatedAt,snapshot.runtime.updatedAt,undefined,true),/onboarding write refused/);
  assert.deepEqual(await local.get(null),prior);
}finally{local.set=oldSet}

// Deleting an orphaned instance with only an alarm must clean that alarm
// without disturbing the normalized runtime.
const orphan=rt.clockAlarmName("orphan","token");
await alarms.create(orphan,{when:123});
const beforeDelete=await local.get(null);
await rt.deleteInstanceRuntime("orphan");
assert.equal(control.alarms.has(orphan),false);
assert.deepEqual(await local.get(null),beforeDelete);
await rt.updateStartPageRuntimeState(r=>{r.notes[note.id]="keep me";return r});
const noteBefore=await local.get(null);
const noteAlarm=rt.clockAlarmName(note.id,"token");
await alarms.create(noteAlarm,{when:123});
let fail=true;
alarms.clear=async name=>{if(name===noteAlarm&&fail){fail=false;throw Error("delete alarm refused")}return clear(name)};
try{
  await assert.rejects(rt.deleteInstanceRuntime(note.id),/delete alarm refused/);
  assert.deepEqual(await local.get(null),noteBefore);
  assert.equal(control.alarms.has(noteAlarm),true);
}finally{alarms.clear=clear}
await rt.deleteInstanceRuntime(note.id);
assert.equal((await rt.getStartPageRuntimeState()).notes[note.id],undefined);

// Public settings APIs must refuse additions/duplications at the real cap.
const full={...settings,layout:{...settings.layout,mode:"free",blocks:Array.from({length:MAX_START_PAGE_BLOCKS},(_,i)=>api.createBlockInstance("note",{id:"capacity-"+i,createdAt:100,updatedAt:100}))}};
await local.set({startPageSettings:api.normalizeStartPageSettings(full)});
const fullSnapshot=await api.getStartPageSettings();
await assert.rejects(api.saveNewBlockInstance(note),/supports at most/);
await assert.rejects(api.duplicateBlockInstance(fullSnapshot.layout.blocks[0].id),/supports at most/);
assert.equal((await api.getStartPageSettings()).layout.blocks.length,MAX_START_PAGE_BLOCKS);
const exhausted={...settings,layout:{...settings.layout,blocks:[{...note,updatedAt:Number.MAX_SAFE_INTEGER-1}]}};
await local.set({startPageSettings:api.normalizeStartPageSettings(exhausted)});
await assert.rejects(api.updateBlockInstance(note.id,b=>({...b,title:"changed"})),/safe integer range/);
assert.equal(control.state.startPageSettings.layout.blocks[0].title,note.title);
assert.equal(v.normalizeEntityId(undefined,"fallback"),"fallback");
assert.deepEqual(v.legacyConfigSource("timer",{}),{});
assert.equal(v.normalizeSearchProviders([{urlTemplate:"https://example.com/?q={query}"}],[],"providers",[]).length,1);
console.log("Residual runtime: legacy migration, clock phases, future schema, alarm rollback, orphan cleanup, capacity and revision exhaustion");

const bl=await import("../src/lib/blocklist.js");
await assert.rejects(bl.blockHost(""),/Invalid host/);
await assert.rejects(bl.unblockHost("ftp://example.com"),/Invalid host/);
assert.equal(bl.hostFromUrl("https://./"),null);
assert.equal(bl.hostFromUrl("https://.example.com/"),null);
assert.equal(bl.hostFromUrl("https://[::1]/"),null);
assert.equal(await bl.rememberBlockedNavigation("chrome://settings/"),null);
await local.set({blockedSites:"broken",blocked:{legacy:"bad"}});
await bl.migrateLegacyStorage();
assert.deepEqual(control.state.blockedSites,[]);
assert.equal(control.state.blocked,undefined);
await bl.replaceBlockedSites(["example.com"]);
assert.equal(await bl.rememberBlockedNavigation("https://unrelated.example/"),null);
await bl.clearLastBlockedUrl("missing.example");
const dnr=control.chrome.declarativeNetRequest;
const originalUpdate=dnr.updateDynamicRules;
let collisions=0;
dnr.updateDynamicRules=async ({removeRuleIds=[],addRules=[]})=>{
  if(collisions===0&&addRules.some(rule=>rule.condition.requestDomains?.includes("new.example"))){
    const contested=addRules.find(rule=>rule.condition.requestDomains?.includes("new.example"));
    collisions++;
    await originalUpdate({addRules:[{id:contested.id,priority:1,action:{type:"block"},condition:{urlFilter:"||foreign.example^"}}]});
    throw Error("DNR ID was claimed concurrently");
  }
  return originalUpdate({removeRuleIds,addRules});
};
try{
  await bl.blockHost("new.example");
  assert.equal(collisions,1);
  assert.deepEqual(await bl.getBlockedSites(),["example.com","new.example"]);
  const rules=await dnr.getDynamicRules();
  assert.equal(new Set(rules.map(rule=>rule.id)).size,rules.length);
  assert.ok(rules.some(rule=>rule.action.type==="block"));
  assert.equal((await bl.readDynamicRulesSnapshot()).length,2);
}finally{dnr.updateDynamicRules=originalUpdate}
// Page contexts must delegate, not alter local durable state directly.
const {installDom}=await import("./ui-fixture-dom.mjs");
const dom=await installDom();
try{
  const stored=await local.get(null);
  assert.deepEqual(await bl.replaceBlockedSites(["WWW.Example.COM","example.com"]),["example.com"]);
  assert.deepEqual(control.messages.at(-1),{type:"replace-blocked-sites",sites:["example.com"]});
  await assert.rejects(bl.clearAll(),/confirmed site snapshot/);
  await bl.clearAll(["example.com"]);
  assert.deepEqual(control.messages.at(-1),{type:"clear",expectedSites:["example.com"]});
  assert.deepEqual(await local.get(null),stored);
}finally{dom.window.close()}
console.log("Blocklist residual: invalid host, malformed legacy state, concurrent DNR ID claims and delegated page mutations");
