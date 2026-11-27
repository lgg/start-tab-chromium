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
// Force a real reconciliation need; a healthy existing alarm is no
// longer needlessly replaced just to exercise the create-error path.
for(const alarm of savedAlarms)control.alarms.set(alarm.name,{...alarm,periodInMinutes:1});
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


  // Reset completed timers to their full duration, and manually advance a
  // non-auto-starting pomodoro without starting another work session.
  const finishedTimer={...rt.defaultClockForBlock(timer),accumulatedMs:timer.config.durationSeconds*1000};
  const restarted=rt.startClockState(finishedTimer,500);
  assert.equal(restarted.accumulatedMs,0);
  assert.equal(restarted.targetAt,500+finishedTimer.durationMs);
  const manualSettings=structuredClone(settings);
  manualSettings.layout.blocks.find(b=>b.id===pomodoro.id).config.autoStartNextPhase=false;
  await local.set({startPageSettings:manualSettings});
  let manual=rt.startClockState(rt.defaultClockForBlock(pomodoro),Date.now()-120000);
  await rt.updateStartPageRuntimeState(r=>{r.clocks[pomodoro.id]=manual;return r});
  const manualBreak=await rt.completeClockInstance(pomodoro.id,manual.completionToken);
  assert.equal(manualBreak.completed,true);
  assert.equal(manualBreak.clock.running,false);
  assert.equal(manualBreak.clock.phase,"break");
  assert.equal(manualBreak.clock.targetAt,null);
  assert.equal(manualBreak.clock.startedAt,null);
  assert.equal(manualBreak.clock.completionToken,null);
  assert.equal(manualBreak.startedWork,false);
  manual=rt.startClockState(manualBreak.clock,Date.now()-120000);
  await rt.updateStartPageRuntimeState(r=>{r.clocks[pomodoro.id]=manual;return r});
  const manualWork=await rt.completeClockInstance(pomodoro.id,manual.completionToken);
  assert.equal(manualWork.clock.phase,"work");
  assert.equal(manualWork.clock.running,false);
  assert.equal(manualWork.startedWork,false);
  // A persisted completed token must be idempotent even if the browser
  // delivers another alarm while the clock is still marked as running.
  const duplicateClock=rt.startClockState(rt.defaultClockForBlock(timer),Date.now()-120000);
  duplicateClock.lastCompletedToken=duplicateClock.completionToken;
  await rt.updateStartPageRuntimeState(r=>{r.clocks[timer.id]=duplicateClock;return r});
  const duplicateResult=await rt.completeClockInstance(timer.id,duplicateClock.completionToken);
  assert.equal(duplicateResult.completed,false);
  assert.equal((await rt.getStartPageRuntimeState()).clocks[timer.id].running,false);
  assert.equal((await rt.getStartPageRuntimeState()).clocks[timer.id].accumulatedMs,duplicateClock.durationMs);
  await rt.resetAllClockRuntimeWithAlarms();

  // Reset failures must preserve old state and report a failed rollback as
  // an AggregateError, rather than claiming a reset was committed.
  const beforeReset=await local.get(null);
  const beforeResetAlarms=await rt.readClockAlarmSnapshot();
  local.remove=async keys=>{if(Array.isArray(keys)&&keys.includes(rt.START_PAGE_RUNTIME_KEY))throw Error("reset removal denied");return remove(keys)};
  try{
    await assert.rejects(rt.resetStartPageData(),/reset removal denied/);
    assert.deepEqual(await local.get(null),beforeReset);
    assert.deepEqual(await rt.readClockAlarmSnapshot(),beforeResetAlarms);
  }finally{local.remove=remove}
  local.remove=async keys=>{if(Array.isArray(keys)&&keys.includes(rt.START_PAGE_RUNTIME_KEY))throw Error("reset removal denied");return remove(keys)};
  local.set=async values=>{if(Object.hasOwn(values,rt.START_PAGE_RUNTIME_KEY))throw Error("reset rollback denied");return set(values)};
  try{
    await assert.rejects(rt.resetStartPageData(),e=>e instanceof AggregateError&&/restore the previous state/.test(e.message));
  }finally{local.remove=remove;local.set=set}
  await local.set(beforeReset);
  console.log("Runtime: completed timer restart, manual pomodoro phase transition, duplicate completion token and reset rollback");


// A failed layout replacement can have committed alarm cleanup before a
// later storage write fails. Report both errors, preserve the durable data,
// and allow the original alarm set to be restored when the platform recovers.
{
  const s=api.normalizeStartPageSettings(settings);
  await local.set({startPageSettings:s,startPageRuntimeState:rt.normalizeRuntimeState(undefined,s)});
  await local.remove("startPageOnboarding");
  const active=rt.startClockState(rt.defaultClockForBlock(timer),Date.now());
  await rt.updateStartPageRuntimeState(r=>{r.clocks[timer.id]=active;return r});
  await rt.scheduleClockAlarm(timer.id,active);
  const before=await rt.getStartPageViewSnapshot();
  const durable=await local.get(null), snapshot=await rt.readClockAlarmSnapshot();
  const name=rt.clockAlarmName(timer.id,active.completionToken);
  assert.ok(snapshot.some(a=>a.name===name));
  const next={...before.settings,layout:{...before.settings.layout,blocks:before.settings.layout.blocks.filter(b=>b.id!==timer.id)}};
  local.set=async items=>{if(Object.hasOwn(items,"startPageOnboarding"))throw Error("onboarding write unavailable");return set(items)};
  alarms.create=async (id,options)=>{if(id===name)throw Error("old alarm restoration unavailable");return create(id,options)};
  try{
    await assert.rejects(rt.replaceStartPageSettingsWithRuntime(next,before.settings.updatedAt,before.runtime.updatedAt,undefined,true),error=>
      error instanceof AggregateError&&/alarm rollback was incomplete/.test(error.message)&&error.errors[0].message==="onboarding write unavailable"&&error.errors[1].message==="old alarm restoration unavailable");
    assert.deepEqual(await local.get(null),durable);
    assert.equal(control.alarms.has(name),false);
  }finally{local.set=set;alarms.create=create}
  await rt.restoreClockAlarmSnapshot(snapshot);
  assert.deepEqual(await rt.readClockAlarmSnapshot(),snapshot);
  const paused=await rt.resetAllClockRuntimeWithAlarms(Date.now());
  assert.deepEqual(paused,[]);
  assert.equal(control.alarms.has(name),false);
  // A duplicate or empty statistics effect must not publish a write.
  const stats=await import("../src/lib/focus-stats.js");
  const state=await local.get(null);
  let writes=0;
  local.set=async values=>{writes++;return set(values)};
  try{
    await stats.applyFocusClockStatsPatchInExistingTransaction({});
    assert.equal(writes,0);
    assert.deepEqual(await local.get(null),state);
  }finally{local.set=set}
  console.log("Runtime transaction: incomplete alarm rollback, durable data preservation, platform recovery and no-op statistics");
}


 // A fresh profile can have settings but no persisted runtime revision.
 // The first layout mutation must advance beyond the stored data revision
 // rather than issuing a stale token derived only from wall-clock time.
{
  const previous=await local.get(null);
  const initial=api.createDefaultStartPageSettings(100);
  const future=Date.now()+300000;
  await local.set({startPageSettings:initial,startTabDataRevision:{version:1,updatedAt:future}});
  await local.remove([rt.START_PAGE_RUNTIME_KEY,"startPageInstanceRuntime"]);
  try{
    const next=structuredClone(initial);next.layout.gap=18;
    const saved=await rt.replaceStartPageSettingsWithRuntime(next,initial.updatedAt,0);
    const result=await rt.getStartPageViewSnapshot();
    assert.equal(saved.layout.gap,18);
    assert.ok(result.runtime.updatedAt>future);
    assert.equal(result.settings.updatedAt,saved.updatedAt);
  }finally{
    const current=await local.get(null);
    await local.remove(Object.keys(current).filter(key=>!Object.hasOwn(previous,key)));
    await local.set(previous);
  }
}
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

// Durable write guards must reject concurrent values at the last read before
// writing, not restore stale rollback snapshots over a newer extension.
{
  const {commitStorageMutationWithRevision,StartTabDataRevisionConflictError}=await import("../src/lib/data-revision.js");
  const previous=globalThis.chrome;
  const fresh=installChrome({guardOnly:{value:"original"},owned:{value:"original"}});
  const store=fresh.chrome.storage.local;
  try{
    let called=false;
    await assert.rejects(commitStorageMutationWithRevision(["owned"],async()=>{called=true},100,{expectedStorage:{guardOnly:{value:"different"}}}),StartTabDataRevisionConflictError);
    assert.equal(called,false);
    assert.deepEqual(fresh.state.owned,{value:"original"});
    await assert.rejects(commitStorageMutationWithRevision(["owned"],async()=>{
      await store.set({owned:{value:"temporary"},guardOnly:{value:"concurrent"}});
      throw Error("write failed");
    },100,{expectedStorage:{guardOnly:{value:"original"}}}),/write failed/);
    assert.deepEqual(fresh.state.owned,{value:"original"});
    assert.deepEqual(fresh.state.guardOnly,{value:"concurrent"});
  }finally{globalThis.chrome=previous}
}
for(const operation of ["migration","settings-edit","runtime-repair","runtime-edit","runtime-delete","layout-replace"]){
  for(const atFinalRead of [true,false]){
    if(!atFinalRead&&["migration","settings-edit","layout-replace"].includes(operation))continue;
    const previous=globalThis.chrome;
    const s=api.normalizeStartPageSettings(settings);
    const initialRuntime=rt.normalizeRuntimeState(undefined,s);
    initialRuntime.updatedAt=300;
    initialRuntime.notes[note.id]="original text";
    const initialSettings=operation==="migration"?{...s,schemaVersion:0}:s;
    const rawRuntime=operation==="runtime-repair"?{...initialRuntime,version:0}:initialRuntime;
    const fresh=installChrome({startPageSettings:initialSettings,startPageRuntimeState:rawRuntime});
    const store=fresh.chrome.storage.local,read=store.get;
    const changedKey=["migration","settings-edit"].includes(operation)?"startPageSettings":rt.START_PAGE_RUNTIME_KEY;
    const changed=changedKey==="startPageSettings"?{schemaVersion:999,opaque:"future data"}:{...rawRuntime,notes:{...rawRuntime.notes,[note.id]:"concurrent text"}};
    let matches=0,injected=false;
    const trigger=operation==="runtime-delete"?(atFinalRead?3:2):operation==="layout-replace"?2:["migration","settings-edit"].includes(operation)?1:atFinalRead?2:1;
    store.get=async keys=>{
      const relevant=Array.isArray(keys)&&keys.includes("startPageSettings")&&keys.includes("startTabDataRevision")&&
        (changedKey==="startPageSettings"?keys.includes("startPageMigrationReport"):keys.includes(rt.START_PAGE_RUNTIME_KEY));
      if(relevant&&++matches===trigger){
        injected=true;
        await store.set({[changedKey]:changed});
      }
      return read(keys);
    };
    try{
      const next={...s,layout:{...s.layout,blocks:s.layout.blocks.filter(b=>b.id!==note.id)}};
      const run=()=>operation==="migration"?api.getStartPageSettings():
        operation==="settings-edit"?api.updateStartPageSettings(current=>({...current,startTab:{enabled:false}})):
        operation==="runtime-repair"?rt.getStartPageRuntimeState():
        operation==="runtime-edit"?rt.updateStartPageRuntimeState(current=>{current.notes[note.id]="stale write";return current}):
        operation==="runtime-delete"?rt.deleteInstanceRuntime(note.id):
        rt.replaceStartPageSettingsWithRuntime(next,s.updatedAt,rawRuntime.updatedAt);
      await assert.rejects(run(),/changed|newer extension version/,operation);
      assert.equal(injected,true,operation);
      assert.deepEqual(fresh.state[changedKey],structuredClone(changed),operation);
      assert.deepEqual(fresh.state[changedKey==="startPageSettings"?rt.START_PAGE_RUNTIME_KEY:"startPageSettings"],
        structuredClone(changedKey==="startPageSettings"?rawRuntime:initialSettings),operation);
      assert.equal(fresh.state.startTabDataRevision,undefined,operation);
      assert.equal(fresh.alarms.size,0,operation);
    }finally{store.get=read;globalThis.chrome=previous}
  }
}
console.log("Deep audit: storage write boundary conflicts preserve newer data without rollback");

{
  const previous=globalThis.chrome;
  const s=api.normalizeStartPageSettings(settings);
  const initialRuntime=rt.normalizeRuntimeState(undefined,s);
  initialRuntime.updatedAt=300;
  initialRuntime.notes[note.id]="private text";
  const fresh=installChrome({startPageSettings:s,startPageRuntimeState:initialRuntime});
  try{
    const changed={...s,layout:{...s.layout,blocks:s.layout.blocks.map(b=>b.id===note.id?api.createBlockInstance("timer",{id:note.id}):b)}};
    assert.equal(api.layoutReplacementRemovesUserData(s,changed,initialRuntime),true);
    await assert.rejects(rt.replaceStartPageSettingsWithRuntime(changed,s.updatedAt,initialRuntime.updatedAt),/identity and type/);
    assert.deepEqual(fresh.state.startPageRuntimeState,structuredClone(initialRuntime));
    assert.deepEqual(fresh.state.startPageSettings,structuredClone(s));
    await assert.rejects(rt.replaceStartPageSettingsWithRuntime({...s,schemaVersion:999},s.updatedAt,initialRuntime.updatedAt),/newer extension version/);
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,"crypto");
    try{
      Object.defineProperty(globalThis,"crypto",{configurable:true,value:{randomUUID:()=>"collision"}});
      const source={...s,layout:{...s.layout,blocks:[api.createBlockInstance("note",{id:"timer-collision"})]}};
      const next=api.settingsWithLayoutPreset(source,"focus");
      assert.equal(next.layout.blocks.find(b=>b.type==="note").id,"timer-collision");
      assert.equal(next.layout.blocks.find(b=>b.type==="timer").id,"timer-collision-2");
      assert.equal(new Set(next.layout.blocks.map(b=>b.id)).size,next.layout.blocks.length);
      api.prepareStartPageSettingsWrite(next,source,source.updatedAt);
    }finally{Object.defineProperty(globalThis,"crypto",descriptor)}
  }finally{globalThis.chrome=previous}
}
console.log("Deep audit: block identity cannot change type; preset IDs reserve all current owners");

{
  const previous=globalThis.chrome;
  const {isMessage}=await import("../src/lib/messages.js");
  for(const token of ["x".repeat(257),"\ud800","\udc00","valid:\u{1f552}/token"]){
    const s=api.normalizeStartPageSettings(settings);
    const running=rt.normalizeRuntimeState(undefined,s);
    running.updatedAt=123;
    running.clocks[timer.id]={...rt.defaultClockForBlock(timer),running:true,startedAt:100,targetAt:5100,completionToken:token};
    const fresh=installChrome({startPageSettings:s,startPageRuntimeState:running});
    try{
      const normalized=await rt.getStartPageRuntimeState();
      const repaired=normalized.clocks[timer.id].completionToken;
      if(token.startsWith("valid"))assert.equal(repaired,token);
      else assert.match(repaired,/^legacy-timer-/);
      assert.equal(isMessage({type:"complete-clock",instanceId:timer.id,token:repaired}),true);
      assert.deepEqual(rt.parseClockAlarmName(rt.clockAlarmName(timer.id,repaired)),{instanceId:timer.id,token:repaired});
      await rt.reconcileStoredClockAlarms();
      assert.equal(fresh.alarms.has(rt.clockAlarmName(timer.id,repaired)),true);
      const completed=await rt.completeClockInstance(timer.id,repaired,5200);
      assert.equal(completed.completed,true);
      assert.equal(completed.clock.running,false);
      assert.equal(fresh.alarms.size,0);
    }finally{globalThis.chrome=previous}
  }
  const mismatched=rt.normalizeRuntimeState({version:initial.version,clocks:{[timer.id]:{...rt.defaultClockForBlock(pomodoro),running:true,startedAt:100}}},settings);
  assert.deepEqual(mismatched.clocks[timer.id],rt.defaultClockForBlock(timer));
}
console.log("Deep audit: malformed completion tokens repaired, valid Unicode preserved and alarms complete");

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


// A future schema can appear between the initial read and the persistence
// re-read. Automatic canonicalization is not authorization to overwrite it.
for(const reader of ["getStartPageRuntimeState","getStartPageViewSnapshot"]){
  const previous=globalThis.chrome;
  const fresh=installChrome({startPageSettings:api.normalizeStartPageSettings(settings),startPageRuntimeState:{version:0}});
  const store=fresh.chrome.storage.local,read=store.get;
  const future={version:999,updatedAt:100,opaque:{keep:"newer extension data"}};
  let injected=false;
  store.get=async keys=>{
    if(!injected&&Array.isArray(keys)&&keys.includes(rt.START_PAGE_RUNTIME_KEY)&&keys.includes("startTabDataRevision")){
      injected=true;
      await store.set({[rt.START_PAGE_RUNTIME_KEY]:future});
    }
    return read(keys);
  };
  try{
    await assert.rejects(rt[reader](),/newer extension version/);
    assert.equal(injected,true,reader);
    assert.deepEqual(fresh.state[rt.START_PAGE_RUNTIME_KEY],future,reader);
  }finally{store.get=read;globalThis.chrome=previous}
}
console.log("Runtime: automatic normalization refuses a concurrently published future schema");

// An older context or an external writer can bypass the Web Lock. A read
// must not persist a stale normalized projection or remove new legacy data.
for(const reader of ["getStartPageRuntimeState","getStartPageViewSnapshot"]){
  for(const changedKey of [rt.START_PAGE_RUNTIME_KEY,rt.LEGACY_INSTANCE_RUNTIME_KEY,"startPageSettings","future-settings"]){
    const previous=globalThis.chrome;
    const initial=api.normalizeStartPageSettings(settings);
    const fresh=installChrome({startPageSettings:initial,startPageRuntimeState:{version:0}});
    const store=fresh.chrome.storage.local,read=store.get;
    const key=changedKey==="future-settings"?"startPageSettings":changedKey;
    const changed=changedKey==="future-settings"?{version:999,opaque:"future settings"}:
      changedKey==="startPageSettings"?{...initial,updatedAt:initial.updatedAt+1,layout:{...initial.layout,blocks:[]}}:
      changedKey===rt.START_PAGE_RUNTIME_KEY?{version:0,notes:{note:"new private data"}}:{localTasks:{later:[{id:"new",title:"new task"}]}};
    let injected=false;
    store.get=async keys=>{
      if(!injected&&Array.isArray(keys)&&keys.includes(rt.START_PAGE_RUNTIME_KEY)&&keys.includes("startTabDataRevision")){
        injected=true;await store.set({[key]:changed});
      }
      return read(keys);
    };
    try{
      await assert.rejects(rt[reader](),/changed during runtime normalization|newer extension version/);
      assert.ok(injected);
      assert.deepEqual(fresh.state[key],structuredClone(changed));
      if(key!==rt.START_PAGE_RUNTIME_KEY)assert.deepEqual(fresh.state[rt.START_PAGE_RUNTIME_KEY],{version:0});
    }finally{store.get=read;globalThis.chrome=previous}
  }
}


// An old persisted countdown can have a valid deadline/token but no focus
// start timestamp. Do not invent historical work time. Both auto-start modes
// must advance the phase exactly once, including a stale repeat completion.
{
  const {getFocusStats}=await import("../src/lib/focus-stats.js");
  for(const autoStart of [false,true]){
    for(const phase of ["work","break"]){
      for(const hasFocusStart of [false,true]){
        const s=api.createDefaultStartPageSettings(100);
        const p=api.createBlockInstance("pomodoro",{id:"legacy-pomodoro",config:{type:"pomodoro",workSeconds:60,breakSeconds:30,notifyOnComplete:false,autoStartNextPhase:autoStart}});
        s.layout.blocks=[p];
        const runtime=rt.normalizeRuntimeState(undefined,s);
        const startedAt=100000, durationMs=phase==="work"?60000:30000, targetAt=startedAt+durationMs;
        runtime.clocks[p.id]={...rt.defaultClockForBlock(p),phase,running:true,startedAt,durationMs,targetAt,
          completionToken:"persisted-phase",focusSessionStartedAt:hasFocusStart?startedAt:null};
        const fresh=installChrome({startPageSettings:s,startPageRuntimeState:runtime});
        const result=await rt.completeClockInstance(p.id,"persisted-phase",targetAt+500);
        assert.equal(result.completed,true);
        assert.equal(result.clock.phase,phase==="work"?"break":"work");
        assert.equal(result.clock.running,autoStart);
        assert.equal(result.clock.lastCompletedToken,"persisted-phase");
        const completedTime=phase==="work"&&hasFocusStart?durationMs:0;
        assert.equal(result.focusTimeMs,completedTime);
        const before=await getFocusStats();
        assert.equal(before.totals.focusTimeMs,completedTime);
        assert.equal(before.totals.focusSessionsCompleted,completedTime>0?1:0);
        assert.equal(before.totals.focusSessionsStarted,autoStart&&phase==="break"?1:0);
        assert.equal(fresh.alarms.size,autoStart?1:0);
        assert.equal((await rt.completeClockInstance(p.id,"persisted-phase",targetAt+501)).completed,false);
        assert.deepEqual(await getFocusStats(),before);
      }
    }
  }
}
console.log("Pomodoro: legacy missing focus start, work/break, auto-start, exact stats and duplicate token matrix");

// Deadline precision, duplicate persisted completion, and alarm reuse.
// Repeated unrelated reconciliation must not move the alarm into the future.
{
  const previous=globalThis.chrome;
  const realNow=Date.now;
  let now=1_800_000_000_000;
  Date.now=()=>now;
  const s=api.normalizeStartPageSettings(settings);
  const initialRuntime=rt.normalizeRuntimeState(undefined,s);
  const running=rt.startClockState(rt.defaultClockForBlock(timer),now);
  initialRuntime.clocks[timer.id]=running;
  const fresh=installChrome({startPageSettings:s,startPageRuntimeState:initialRuntime});
  try{
    const name=rt.clockAlarmName(timer.id,running.completionToken);
    await rt.reconcileStoredClockAlarms();
    assert.equal(fresh.alarms.get(name).scheduledTime,running.targetAt);
    const originalCreate=fresh.chrome.alarms.create;
    let creates=0;
    fresh.chrome.alarms.create=async (...args)=>{creates++;return originalCreate(...args)};
    now=running.targetAt-500;
    const before=structuredClone(fresh.state);
    const early=await rt.completeClockInstance(timer.id,running.completionToken,now);
    assert.equal(early.completed,false);
    assert.deepEqual(fresh.state,before);
    await rt.reconcileStoredClockAlarms();
    assert.equal(creates,0);
    // Simulate Chrome rounding a short alarm or a retry into the future.
    now=running.targetAt+100;
    const retryAt=now+30000;
    fresh.alarms.set(name,{name,scheduledTime:retryAt});
    for(let index=0;index<5;index++){
      now+=500;
      await rt.reconcileStoredClockAlarms();
      assert.equal(fresh.alarms.get(name).scheduledTime,retryAt);
    }
    assert.equal(creates,0);
    // Periodic or incorrectly scheduled alarms are repaired.
    fresh.alarms.set(name,{name,scheduledTime:retryAt,periodInMinutes:1});
    await rt.reconcileStoredClockAlarms();
    assert.equal(creates,1);
    assert.equal(fresh.alarms.get(name).periodInMinutes,undefined);
    fresh.alarms.set(name,{name,scheduledTime:now+120000});
    await rt.reconcileStoredClockAlarms();
    assert.equal(creates,2);
    fresh.alarms.delete(name);
    await rt.reconcileStoredClockAlarms();
    assert.equal(creates,3);
    const done=await rt.completeClockInstance(timer.id,running.completionToken,now);
    assert.equal(done.completed,true);
    assert.equal(fresh.alarms.has(name),false);
    // Imported inconsistent phases are never replayed. The next deliberate
    // Start allocates a new token and can finish normally.
    for(const b of [timer,pomodoro]){
      const malformed={...rt.startClockState(rt.defaultClockForBlock(b),now),phase:b.type==="pomodoro"?"break":null};
      malformed.lastCompletedToken=malformed.completionToken;
      const raw={...initialRuntime,clocks:{[b.id]:malformed}};
      await fresh.chrome.storage.local.set({[rt.START_PAGE_RUNTIME_KEY]:raw});
      const repaired=await rt.getStartPageRuntimeState();
      const clock=repaired.clocks[b.id];
      assert.equal(clock.running,false);
      assert.equal(clock.completionToken,null);
      assert.equal(clock.lastCompletedToken,malformed.lastCompletedToken);
      assert.equal(clock.phase,malformed.phase);
      assert.equal(clock.accumulatedMs,clock.durationMs);
      assert.equal((await rt.completeClockInstance(b.id,malformed.completionToken,now)).completed,false);
      const started=rt.startClockState(clock,now);
      assert.notEqual(started.completionToken,malformed.completionToken);
      assert.equal(started.accumulatedMs,0);
      await rt.updateStartPageRuntimeState(r=>{r.clocks[b.id]=started;return r});
      assert.equal((await rt.completeClockInstance(b.id,started.completionToken,started.targetAt)).completed,true);
    }
  }finally{Date.now=realNow;globalThis.chrome=previous}
}
console.log("Deep audit: exact deadlines, non-replayed completed tokens and stable one-shot alarms");


 // Malformed positive sub-millisecond timestamps must never become zero
 // and make a running clock change state on the next storage read.
{
  const seed={...rt.defaultClockForBlock(timer),running:true,startedAt:100,targetAt:5100,completionToken:"timestamp-audit"};
  for(const [patch,expected] of [
    [{startedAt:0.1},{running:false,startedAt:null,targetAt:null,completionToken:null}],
    [{targetAt:0.1},{running:true,startedAt:100,targetAt:5100}],
    [{startedAt:Number.MAX_SAFE_INTEGER-1,targetAt:null},{running:true,targetAt:Number.MAX_SAFE_INTEGER}],
    [{startedAt:100.49,targetAt:5100.49},{running:true,startedAt:100,targetAt:5100}],
  ]){
    const normalized=rt.normalizeRuntimeState({...initial,clocks:{[timer.id]:{...seed,...patch}}},settings);
    for(const [key,value] of Object.entries(expected))assert.equal(normalized.clocks[timer.id][key],value,key);
    assert.deepEqual(rt.normalizeRuntimeState(normalized,settings),normalized);
  }
  const raw={...initial,clocks:{[pomodoro.id]:{...rt.defaultClockForBlock(pomodoro),focusSessionStartedAt:0.1}}};
  const normalized=rt.normalizeRuntimeState(raw,settings);
  assert.equal(normalized.clocks[pomodoro.id].focusSessionStartedAt,null);
  assert.deepEqual(rt.normalizeRuntimeState(normalized,settings),normalized);
}
console.log("Clock normalization: reject sub-millisecond zero timestamps and bound derived deadlines");
