import assert from "node:assert/strict";
import { installDom, installChrome, installFetch, host, one, until, delay, i18n } from "./ui-fixture-dom.mjs";
import { createDefaultStartPageSettings, createBlockInstance } from "../src/lib/start-page-settings.js";
import { normalizeRuntimeState } from "../src/lib/start-page-runtime.js";
import * as stats from "../src/lib/focus-stats.js";
import * as sync from "../src/lib/chrome-sync.js";
import * as blocklist from "../src/lib/blocklist.js";
import { withStorageLock } from "../src/lib/storage-lock.js";
import { restoreDeferredSectionAnchor, hashTargetsSection } from "../src/options/deferred-section.js";
import { fetchWidgetJson, MAX_WIDGET_RESPONSE_BYTES } from "../src/newtab/widget-network.js";
import { WidgetRequestCache } from "../src/newtab/widget-request-cache.js";
import { normalizeStartPageSettingsWithReport, hasBlockUserData, validateStartPageSettings } from "../src/lib/start-page-settings-validation.js";
import { consumeNativeNewTabBypass, openNativeNewTab, NATIVE_NEW_TAB_BYPASS_KEY } from "../src/lib/native-new-tab.js";
import { containsSplitViewMarker } from "../src/lib/split-view-markers.js";

const settings=createDefaultStartPageSettings(100);
let control=installChrome({startPageSettings:settings, startPageRuntimeState:normalizeRuntimeState(undefined,settings),blockedSites:[]});
const sha=async value=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,"0")).join("");
const remote=control.chrome.storage.sync;
const local=control.chrome.storage.local;
const metaKey="startTabSyncMeta", localMetaKey="startTabLocalSyncMeta";
assert.equal(await sync.getChromeSyncBackupMeta(),null);
await assert.rejects(sync.restoreChromeSyncBackup(),/No Start Tab backup/);
assert.equal(await sync.syncChromeSyncBackup(),"uploaded");
const original=await remote.get(null);
const meta=original[metaKey];
assert.equal((await sync.getChromeSyncBackupMeta()).snapshotId,meta.snapshotId);
assert.equal(await sync.syncChromeSyncBackup(),"unchanged");
const raw=Array.from({length:meta.chunks},(_,i)=>original["startTabSyncChunk"+i]).join("");
const legacy={version:2,updatedAt:meta.updatedAt,deviceId:meta.deviceId,checksum:meta.checksum,chunks:meta.chunks};
await remote.set({[metaKey]:legacy});
assert.equal((await sync.getChromeSyncBackupMeta()).snapshotId,"legacy-"+meta.checksum.slice(0,16));
assert.equal(await sync.syncChromeSyncBackup(),"unchanged");
assert.equal((await sync.getChromeSyncBackupMeta()).version,3);
await remote.set({...original,[metaKey]:legacy});
await sync.restoreChromeSyncBackup();
assert.equal((await sync.getChromeSyncBackupMeta()).version,3);
await remote.set(original);
await remote.remove("startTabSyncChunk0");
await assert.rejects(sync.restoreChromeSyncBackup(),/incomplete/);
await remote.set(original);
await remote.set({startTabSyncChunk0:"corruption"});
await assert.rejects(sync.restoreChromeSyncBackup(),/checksum mismatch/);
await remote.set(original);
const badJson="{invalid";
await remote.set({[metaKey]:{...meta,chunks:1,checksum:await sha(badJson)},startTabSyncChunk0:badJson});
await assert.rejects(sync.restoreChromeSyncBackup(),/invalid JSON/);
await remote.set(original);
await remote.set({[metaKey]:{...meta,contentChecksum:"0".repeat(64)}});
await assert.rejects(sync.restoreChromeSyncBackup(),/content checksum mismatch/);
await remote.set(original);
for(const version of [4,99]){
  await remote.set({[metaKey]:{...meta,version}});
  await assert.rejects(sync.uploadChromeSyncBackup(),/newer extension version/);
}
await remote.set(original);
await local.set({[localMetaKey]:{...meta,version:99}});
await assert.rejects(sync.syncChromeSyncBackup(),/local.*newer extension version/);
await local.remove(localMetaKey);
await remote.remove(metaKey);
await assert.rejects(sync.syncChromeSyncBackup(),/incomplete/);
await assert.rejects(sync.restoreChromeSyncBackup(),/incomplete/);
await sync.uploadChromeSyncBackup();
assert.equal((await sync.getChromeSyncBackupMeta()).version,3);
remote.QUOTA_BYTES=1;
await assert.rejects(sync.uploadChromeSyncBackup(),/total quota/);
remote.QUOTA_BYTES=102400;
remote.QUOTA_BYTES_PER_ITEM=30;
await assert.rejects(sync.uploadChromeSyncBackup(),/too large|cannot fit/);
remote.QUOTA_BYTES_PER_ITEM=8192;
assert.throws(()=>sync.chunkForChromeSync("x",0),/quota/);
assert.throws(()=>sync.chunkForChromeSync("😀",1),/cannot fit/);
assert.deepEqual(sync.chunkForChromeSync(""),[""]);
assert.equal(sync.chunkForChromeSync("😀\\\"\n".repeat(30),50).join(""),"😀\\\"\n".repeat(30));
assert.throws(()=>sync.completeChromeSyncPayload(meta,[]),/Invalid/);
await remote.set(original);
assert.equal(JSON.parse(raw).app,"Start Tab");
// Verify smart sync's content decisions against real exported frames.
await sync.uploadChromeSyncBackup();
const stableFrame=await remote.get(null);
await remote.set({startTabSyncChunk0:"corrupt matching content"});
assert.equal(await sync.syncChromeSyncBackup(),"uploaded");
assert.equal(await sync.syncChromeSyncBackup(),"unchanged");
const baseState=structuredClone(control.state);
const baseFrame=await remote.get(null);
await blocklist.blockHost("local-edit.example");
assert.equal(await sync.syncChromeSyncBackup(),"uploaded");
assert.ok(control.state.blockedSites.includes("local-edit.example"));
const changedFrame=await remote.get(null);
async function restoreLocal(snapshot){
  const extra=Object.keys(control.state).filter(k=>!Object.hasOwn(snapshot,k));
  if(extra.length)await local.remove(extra);
  await local.set(snapshot);
}
await restoreLocal(baseState);
assert.equal(await sync.syncChromeSyncBackup(),"restored");
assert.ok(control.state.blockedSites.includes("local-edit.example"));
await restoreLocal(baseState);
await blocklist.blockHost("another-local.example");
const oldLegacy={version:2,updatedAt:"2000-01-01T00:00:00.000Z",deviceId:meta.deviceId,checksum:changedFrame[metaKey].checksum,chunks:changedFrame[metaKey].chunks};
await remote.set({...changedFrame,[metaKey]:oldLegacy});
assert.equal(await sync.syncChromeSyncBackup(),"uploaded");
assert.ok(control.state.blockedSites.includes("another-local.example"));
assert.ok(!control.state.blockedSites.includes("local-edit.example"));
await remote.set({...changedFrame,[metaKey]:{...oldLegacy,updatedAt:new Date(Date.now()+60000).toISOString()}});
assert.equal(await sync.syncChromeSyncBackup(),"restored");
assert.ok(control.state.blockedSites.includes("local-edit.example"));
assert.ok(!control.state.blockedSites.includes("another-local.example"));
assert.equal((await sync.getChromeSyncBackupMeta()).version,3);
remote.QUOTA_BYTES=NaN;
remote.QUOTA_BYTES_PER_ITEM=undefined;
await sync.uploadChromeSyncBackup();
remote.QUOTA_BYTES=102400;
remote.QUOTA_BYTES_PER_ITEM=8192;

// Both devices changed since the same baseline: the newer revision wins,
// while the older remote must not overwrite a newer local edit.
for (const remoteNewer of [false, true]) {
  await restoreLocal(baseState);
  await blocklist.blockHost("two-sided-local.example");
  await remote.set({...changedFrame,[metaKey]:{...changedFrame[metaKey],contentUpdatedAt:remoteNewer?Date.now()+120000:1}});
  assert.equal(await sync.syncChromeSyncBackup(),remoteNewer?"restored":"uploaded");
  assert.ok(control.state.blockedSites.includes(remoteNewer?"local-edit.example":"two-sided-local.example"));
  assert.ok(!control.state.blockedSites.includes(remoteNewer?"two-sided-local.example":"local-edit.example"));
}
// A failed matching-frame read followed by a metadata error must retain
// both causes and must not write a replacement frame.
await sync.uploadChromeSyncBackup();
const verifiedFrame=await remote.get(null);
const realGet=remote.get;
let chunkReadFailed=false;
remote.get=async keys=>{
  if(Array.isArray(keys)&&keys.some(key=>key.startsWith("startTabSyncChunk"))){
    chunkReadFailed=true;
    throw new Error("chunk read failed");
  }
  if(chunkReadFailed&&keys===metaKey)throw new Error("metadata refresh failed");
  return realGet(keys);
};
try {
  await assert.rejects(sync.syncChromeSyncBackup(),error=>error instanceof AggregateError&&error.errors.some(cause=>cause.message==="chunk read failed")&&error.errors.some(cause=>cause.message==="metadata refresh failed"));
} finally {remote.get=realGet;}
assert.deepEqual(await remote.get(null),verifiedFrame);
// A missing remote frame that appears during restore is not an empty backup.
await remote.remove(metaKey);
remote.get=async keys=>{
  if(keys===null)await remote.set(verifiedFrame);
  return realGet(keys);
};
try {await assert.rejects(sync.restoreChromeSyncBackup(),/changed while restore was being prepared/);}
finally {remote.get=realGet;}
assert.deepEqual(await remote.get(null),verifiedFrame);

console.log("Browser Sync: verified matching frame repair, local/remote changes and legacy winner decisions");
console.log("Browser Sync: legacy upgrade, unchanged sync, corruption, future schema, quota, partial frame and recovery");

await stats.resetFocusStats();
await stats.recordFocusSessionStarted();
await stats.recordFocusSessionCompleted(1000,"id");
await stats.recordFocusSessionCompleted(1000,"id");
await stats.recordFocusSessionCompleted(0);
await stats.recordFocusSessionInterrupted(250);
await stats.recordFocusSessionsInterrupted([100,200,NaN,-1,0]);
await stats.recordFocusSessionsInterrupted([]);
await stats.recordUnblockAfterCountdown("example.com");
await stats.recordBlockedNavigation("example.com");
await stats.recordBlockedNavigation("example.com");
let result=await stats.getFocusStats();
assert.equal(result.totals.focusSessionsStarted,1);
assert.equal(result.totals.focusSessionsCompleted,1);
assert.equal(result.totals.focusSessionsInterrupted,3);
assert.equal(result.totals.focusTimeMs,1550);
assert.equal(result.byDomain["example.com"].blockHits,2);
assert.equal(result.byDomain["example.com"].avoidedVisits,1);
assert.equal(result.totals.unblocksAfterCountdown,1);
await assert.rejects(stats.applyFocusClockStatsPatchInExistingTransaction({startedSessions:1,occurredAt:-1}),/timestamp/);
assert.deepEqual(await stats.getFocusStats(),result);
await local.set({focusStats:{version:99}});
await assert.rejects(stats.recordFocusSessionStarted(),/newer extension/);
await stats.resetFocusStats();
assert.equal((await stats.getFocusStats()).totals.focusTimeMs,0);
const normalized=stats.normalizeFocusStats({version:1,totals:{blockHits:Infinity},byDay:{"":{},a:null},byDomain:{"":{},a:null},processedClockCompletions:{a:1,b:-1,["x".repeat(521)]:10}});
assert.equal(normalized.totals.blockHits,0);
assert.deepEqual(Object.keys(normalized.byDay),["a"]);
assert.deepEqual(Object.keys(normalized.byDomain),["a"]);
assert.deepEqual(Object.keys(normalized.processedClockCompletions),["a"]);
console.log("Focus stats: public mutation APIs, deduplication, invalid timestamps, future schema, normalization");

const report=normalizeStartPageSettingsWithReport({schemaVersion:1,appearance:{backgroundColor:"#123456"},layout:{mode:"free",profile:" ",blocks:[null,{type:"commands"},{type:"commands"},{type:"note",id:"n"},{type:"note",id:"n"}]}});
assert.equal(report.report.skippedBlocks,2);
assert.equal(report.settings.layout.profile,"custom");
assert.equal(report.settings.themes.selectedThemeId,"migrated-legacy-theme");
assert.equal(new Set(report.settings.layout.blocks.map(b=>b.id)).size,3);
assert.ok(validateStartPageSettings({layout:{blocks:[{type:"bogus"}]}}).issues.length);
for(const type of ["note","localTasks","links","startPinned","timer","commands"]){
  const b=createBlockInstance(type,{id:"b"});
  assert.equal(hasBlockUserData(b,{notes:{b:"test"},tasks:{b:[{}]}}),["note","localTasks","links","startPinned"].includes(type));
}
assert.equal(hasBlockUserData(createBlockInstance("note"),{}),false);
assert.equal(hasBlockUserData(createBlockInstance("localTasks"),{}),false);
assert.equal(containsSplitViewMarker(""),false);


const backup=await import("../src/lib/backup.js");
const defaults=await import("../src/lib/start-page-defaults.js");
const primitives=await import("../src/lib/start-page-validation-primitives.js");
const beforeBackup=await backup.exportBackup();
for(const [key,future] of [["startPageSettings",{schemaVersion:999}],["startPageRuntimeState",{version:999}],["focusStats",{version:999}]]){
  assert.throws(()=>backup.migrateBackup({...beforeBackup,storage:{...beforeBackup.storage,[key]:future}}),/newer extension version/);
}
assert.throws(()=>backup.migrateBackup(null),/Invalid Start Tab backup/);
await assert.rejects(backup.importBackup(null),/Invalid Start Tab backup/);
assert.equal(backup.backupModifiedAt({...beforeBackup,storage:{}}),0);
assert.equal(backup.backupModifiedAt({...beforeBackup,storage:{startPageSettings:{updatedAt:123}}}),123);
assert.equal(backup.backupModifiedAt({...beforeBackup,storage:{startPageRuntimeState:{updatedAt:456}}}),456);
// A real full-format export may not silently become a partial destructive
// restore. Only legacy/headerless partial imports can omit whole sections.
{
  const full=await backup.exportBackup();
  const stored=await local.get(null);
  const rules=await control.chrome.declarativeNetRequest.getDynamicRules();
  const alarmNames=[...control.alarms.keys()];
  assert.doesNotThrow(()=>backup.migrateBackup(full));
  for(const key of ["blockedSites","startPageSettings","startPageRuntimeState","lastBlockedUrls","startPageOnboarding"]){
    const missing=structuredClone(full);
    delete missing.storage[key];
    assert.throws(()=>backup.migrateBackup(missing),/Invalid Start Tab backup section/,key);
    await assert.rejects(backup.importBackup(missing),/Invalid Start Tab backup section/,key);
  }
  for(const [parent,field] of [
    ["startPageSettings","layout"],["startPageSettings","themes"],["startPageSettings","startTab"],
    ["startPageSettings","settingsButton"],["startPageSettings","focusStats"],
    ["startPageSettings.layout","blocks"],["startPageSettings.themes","customThemes"],
    ["startPageSettings.themes","selectedThemeId"],["startPageRuntimeState","clocks"],
    ["startPageRuntimeState","notes"],["startPageRuntimeState","tasks"],["startPageRuntimeState","linkPages"]
  ]){
    const missing=structuredClone(full);
    const owner=parent.split(".").reduce((value,key)=>value[key],missing.storage);
    delete owner[field];
    await assert.rejects(backup.importBackup(missing),/Invalid Start Tab backup section/,parent+"."+field);
  }
  for(const [key,invalid] of [["lastBlockedUrls",[]],["lastBlockedUrls",{example:42}],["startPageOnboarding",{}],["localeOverride","invalid"],["focusStats",{version:1}]]){
    await assert.rejects(backup.importBackup({...full,storage:{...full.storage,[key]:invalid}}),/Invalid Start Tab backup section/,key);
  }
  for(const schema of [null,{}, {version:999,storageKeys:[]},{version:4,storageKeys:"invalid"},{version:4,storageKeys:[123]},{version:4,storageKeys:["blockedSites"]}]){
    await assert.rejects(backup.importBackup({...full,schema}),/Invalid Start Tab backup (schema|section)/);
  }
  assert.deepEqual(await local.get(null),stored);
  assert.deepEqual(await control.chrome.declarativeNetRequest.getDynamicRules(),rules);
  assert.deepEqual([...control.alarms.keys()],alarmNames);
  const partial={app:"Start Tab",version:4,exportedAt:full.exportedAt,storage:{blockedSites:["legacy.example"]}};
  assert.deepEqual(backup.migrateBackup(partial).storage.blockedSites,["legacy.example"]);
  const optional=structuredClone(full);
  delete optional.storage.localeOverride;delete optional.storage.focusStats;
  assert.doesNotThrow(()=>backup.migrateBackup(optional));
}
console.log("Deep audit: declared backup truncation rejected without modifying local storage, rules or alarms");

const previousRecovery=control.state[backup.PRE_IMPORT_BACKUP_KEY];
await local.remove(backup.PRE_IMPORT_BACKUP_KEY);
await assert.rejects(backup.restorePreImportBackup(),/No pre-import recovery/);
if(previousRecovery!==undefined)await local.set({[backup.PRE_IMPORT_BACKUP_KEY]:previousRecovery});
const originalStorageSet=local.set;
const backupBaseline=await local.get(null);
local.set=async()=>{throw Error("storage write refused")};
try{
  await assert.rejects(backup.importBackup(beforeBackup),e=>e instanceof AggregateError&&/rollback was incomplete/.test(e.message));
}finally{local.set=originalStorageSet}
assert.deepEqual(await local.get(null),backupBaseline);
const cryptoDescriptor=Object.getOwnPropertyDescriptor(globalThis,"crypto");
try{
  Object.defineProperty(globalThis,"crypto",{configurable:true,value:undefined});
  const generated=backup.migrateBackup({...beforeBackup,snapshotId:undefined});
  assert.match(generated.snapshotId,/^[a-z0-9]+-[a-z0-9]+$/);
}finally{Object.defineProperty(globalThis,"crypto",cryptoDescriptor)}
for(const preset of defaults.LAYOUT_PRESETS){
  const blocks=defaults.blocksFromPreset(preset,"full");
  assert.equal(blocks.length,preset.blocks.length);
  assert.ok(blocks.every((block,index)=>block.zone==="full"&&block.order===index&&block.type===preset.blocks[index].type&&block.enabled===(preset.blocks[index].enabled??true)));
  assert.equal(new Set(blocks.map(b=>b.id)).size,blocks.length);
}
assert.equal(primitives.normalizeEntityId("","fallback"),"fallback");
assert.equal(primitives.safeCssToken("<script>","safe"),"safe");
assert.equal(primitives.normalizeSearchProviders([{title:"title",urlTemplate:"https://example.com/?q={query}"}],[],"providers",[]).length,1);
assert.deepEqual(primitives.legacyConfigSource("timer",{timers:{durationSeconds:7}}),{durationSeconds:7});
assert.deepEqual(primitives.legacyConfigSource("startPinned",{}),{});
console.log("Backup: future schemas, invalid input, missing recovery, rollback failure, generated ID and preset defaults");


// Only canonical rules owned by this extension's blocker may be removed.
// Malformed or near-match redirects are foreign even when the action targets
// blocked.html. Reconcile must preserve them and migrate exact legacy rules.
{
  await local.set({blockedSites:["ownership.example"]});
  await blocklist.syncRulesInCurrentTransaction();
  const dnr=control.chrome.declarativeNetRequest;
  const owned=(await blocklist.readDynamicRulesSnapshot())[0];
  assert.equal(owned.condition.requestDomains[0],"ownership.example");
  const cloneRule=(id,modify)=>{
    const rule=structuredClone(owned);
    rule.id=id;modify(rule);return rule;
  };
  const page=control.chrome.runtime.getURL("blocked.html");
  const foreign=[
    cloneRule(6001,r=>{r.action.redirect.url="not a URL"}),
    cloneRule(6002,r=>{r.action.redirect.url=page+"?owner=start-tab-blocklist-v1"}),
    cloneRule(6003,r=>{r.action.redirect.url=page+"?site=ownership.example&site=other.example&owner=start-tab-blocklist-v1"}),
    cloneRule(6004,r=>{r.action.redirect.url=page+"?site=OWNERSHIP.example&owner=start-tab-blocklist-v1"}),
    cloneRule(6005,r=>{r.action.redirect.url=page+"?site=ownership.example&owner=foreign"}),
    cloneRule(6006,r=>{r.condition.resourceTypes=["sub_frame"]}),
    cloneRule(6007,r=>{r.condition.requestDomains=["another.example"]}),
    cloneRule(6008,r=>{r.priority+=1}),
    cloneRule(6009,r=>{r.action.redirect.url+="&extra=1"}),
    cloneRule(6010,r=>{r.action.redirect.url+="#fragment"}),
    cloneRule(6011,r=>{delete r.action.redirect}),
    cloneRule(6012,r=>{r.action.redirect.url=page+"?site=&owner=start-tab-blocklist-v1"}),
    cloneRule(6013,r=>{r.action.redirect.url=page+"?site=ownership.example&owner=start-tab-blocklist-v1";r.action.redirect.extensionPath="/blocked.html"}),
    cloneRule(6014,r=>{r.action.redirect.url=page.replace("blocked.html","other.html")+"?site=ownership.example&owner=start-tab-blocklist-v1"})
  ];
  const legacy=cloneRule(4321,r=>{
    r.action.redirect.url=page+"?site=legacy.example";
    r.condition.requestDomains=["legacy.example"];
  });
  await dnr.updateDynamicRules({addRules:[...foreign,legacy]});
  const before=await blocklist.readDynamicRulesSnapshot();
  assert.deepEqual(new Set(before.map(rule=>rule.id)),new Set([owned.id,legacy.id]));
  await blocklist.syncRulesInCurrentTransaction();
  const after=await dnr.getDynamicRules();
  assert.deepEqual(after.filter(rule=>foreign.some(f=>f.id===rule.id)).sort((a,b)=>a.id-b.id),foreign);
  assert.equal(after.some(rule=>rule.id===legacy.id),false);
  assert.deepEqual((await blocklist.readDynamicRulesSnapshot()).map(rule=>rule.condition.requestDomains[0]),["ownership.example"]);
  console.log("DNR ownership: malformed URLs, duplicate sites, noncanonical hosts, foreign owners, resource and domain mismatch, legacy migration");
}


 // Exhausted concurrent rule-ID claims must not overwrite the foreign
 // rules or publish the requested site in durable storage.
{
  const dnr=control.chrome.declarativeNetRequest;
  const realUpdate=dnr.updateDynamicRules;
  const before=await local.get(null);
  const own=await blocklist.readDynamicRulesSnapshot();
  const foreignIds=[];
  dnr.updateDynamicRules=async ({removeRuleIds=[],addRules=[]})=>{
    const contested=addRules.find(r=>r.condition.requestDomains?.includes("always-contested.example"));
    if(!contested)return realUpdate({removeRuleIds,addRules});
    foreignIds.push(contested.id);
    await realUpdate({addRules:[{id:contested.id,priority:1,action:{type:"block"},condition:{urlFilter:"||foreign-"+foreignIds.length+".example^"}}]});
    throw Error("another feature claimed the ID");
  };
  try{
    await assert.rejects(blocklist.blockHost("always-contested.example"),/claimed concurrently/);
    assert.equal(foreignIds.length,4);
    assert.equal(new Set(foreignIds).size,foreignIds.length);
    assert.deepEqual(await local.get(null),before);
    assert.deepEqual(await blocklist.readDynamicRulesSnapshot(),own);
    const all=await dnr.getDynamicRules();
    assert.ok(foreignIds.every(id=>all.some(r=>r.id===id&&r.action.type==="block")));
  }finally{dnr.updateDynamicRules=realUpdate}
}
 // A no-op storage repair can fail at DNR reconciliation and again during
 // rollback. Both failures must remain visible, even without a storage write.
{
  const dnr=control.chrome.declarativeNetRequest;
  const realUpdate=dnr.updateDynamicRules;
  const before=await local.get(null);
  const snapshot=await blocklist.readDynamicRulesSnapshot();
  const host="repair-only.example";
  await local.set({blockedSites:[host]});
  await local.remove("lastBlockedUrls");
  const stored=await local.get(null);
  let attempts=0;
  dnr.updateDynamicRules=async ({removeRuleIds=[],addRules=[]})=>{
    attempts++;
    if(attempts===1){
      // Simulate a platform which changed rules but returned a rejection.
      await realUpdate({removeRuleIds,addRules});
      throw Error("repair acknowledgement unavailable");
    }
    throw Error("repair rollback unavailable");
  };
  try{
    await assert.rejects(blocklist.replaceBlockedSites([host]),e=>e instanceof AggregateError&&/DNR repair failed/.test(e.message)&&e.errors[0].message==="repair acknowledgement unavailable"&&e.errors[1].message==="repair rollback unavailable");
    assert.equal(attempts,2);
    assert.deepEqual(await local.get(null),stored);
  }finally{
    dnr.updateDynamicRules=realUpdate;
    await blocklist.restoreDynamicRulesSnapshot(snapshot);
    await local.set(before);
  }
}

const dom=await installDom();
const restoreFetch=installFetch();
try {
  const el=host();el.id="statistics";
  let scrolls=0;el.scrollIntoView=opts=>{assert.equal(opts.block,"start");scrolls++};
  assert.equal(restoreDeferredSectionAnchor(el,"#statistics"),true);
  assert.equal(restoreDeferredSectionAnchor(el,"#%73tatistics"),true);
  assert.equal(restoreDeferredSectionAnchor(el,"#wrong"),false);
  assert.equal(hashTargetsSection("#%","%"),true);
  assert.equal(scrolls,2);
  const calls=[];
  Object.defineProperty(navigator,"locks",{configurable:true,value:{request:async(name,opts,cb)=>{calls.push([name,opts.mode]);return cb();}}});
  assert.equal(await withStorageLock("test",async()=>42),42);
  assert.deepEqual(calls,[["start-tab:test","exclusive"]]);
  delete navigator.locks;
  let release;
  const first=withStorageLock("queue",()=>new Promise(resolve=>{release=resolve}));
  const second=withStorageLock("queue",async()=>7);
  await until(()=>release);release(5);
  assert.equal(await first,5);assert.equal(await second,7);
  await assert.rejects(withStorageLock("queue",async()=>{throw Error("fail")}),/fail/);
  assert.equal(await withStorageLock("queue",async()=>9),9);

  globalThis.fetch=async()=>new Response(null,{status:204});
  await assert.rejects(fetchWidgetJson("https://example.com"),/empty response/);
  globalThis.fetch=async()=>new Response("x".repeat(MAX_WIDGET_RESPONSE_BYTES+1));
  await assert.rejects(fetchWidgetJson("https://example.com"),/size limit/);
  globalThis.fetch=async()=>new Response("{broken");
  await assert.rejects(fetchWidgetJson("https://example.com"),SyntaxError);
  globalThis.fetch=async()=>new Response(null,{status:503});
  await assert.rejects(fetchWidgetJson("https://example.com"),/503/);
  globalThis.fetch=async()=>new Response('{"ok":true}');
  assert.deepEqual(await fetchWidgetJson("https://example.com"),{ok:true});
  const cache=new WidgetRequestCache(1);
  assert.equal(await cache.get("one",1000,async()=>1),1);
  assert.equal(await cache.get("two",1000,async()=>2),2);
  assert.equal(await cache.get("one",1000,async()=>3),3);
  console.log("Settings validation, deferred anchor, Web Locks and provider response failure coverage");
} finally {restoreFetch();dom.window.close();}
