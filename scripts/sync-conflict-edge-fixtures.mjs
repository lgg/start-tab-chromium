import assert from "node:assert/strict";
import { installChrome } from "./ui-fixture-dom.mjs";
import * as sync from "../src/lib/chrome-sync.js";
import * as api from "../src/lib/start-page-settings.js";
import { normalizeRuntimeState } from "../src/lib/start-page-runtime.js";
import { markStartTabDataChanged } from "../src/lib/data-revision.js";
import { blockHost } from "../src/lib/blocklist.js";

const settings=api.createDefaultStartPageSettings(100);
const control=installChrome({startPageSettings:settings,startPageRuntimeState:normalizeRuntimeState(undefined,settings),blockedSites:[]});
const remote=control.chrome.storage.sync,local=control.chrome.storage.local;
const metaKey="startTabSyncMeta",localMetaKey="startTabLocalSyncMeta";
const realGet=remote.get,realSet=remote.set;
await sync.uploadChromeSyncBackup();
const original=await remote.get(null);
const originalLocal=structuredClone(control.state);

// A write acknowledged by the remote store is not confirmed until the
// read-back metadata and content agree with the exact uploaded frame.
remote.set=async values=>{await realSet(values);await remote.remove(metaKey)};
try {
  await assert.rejects(sync.uploadChromeSyncBackup(),/changed concurrently before the upload commit was confirmed/);
  assert.deepEqual(control.state[localMetaKey],originalLocal[localMetaKey]);
} finally {remote.set=realSet;await realSet(original)}
// A concurrent local write at each late revision check exhausts the bounded
// retry loop. The last actual conflict must be returned, not a fake success.
let attempts=0;
remote.get=async keys=>{
  if(keys===null){attempts++;await markStartTabDataChanged();}
  return realGet(keys);
};
try{
  await assert.rejects(sync.uploadChromeSyncBackup(),/changed before the Browser Sync upload could commit/);
  assert.equal(attempts,3);
  assert.deepEqual(await realGet(null),original);
}finally{remote.get=realGet}

// Legacy frame restore is already committed before optional metadata
// upgrade. A failed upgrade must report that distinction and preserve data.
await blockHost("newer-local.example");
const newerLocal=structuredClone(control.state);
const oldMeta=original[metaKey];
const legacy={version:2,updatedAt:oldMeta.updatedAt,deviceId:oldMeta.deviceId,checksum:oldMeta.checksum,chunks:oldMeta.chunks};
await realSet({...original,[metaKey]:legacy});
remote.set=async()=>{throw Error("legacy upload unavailable")};
try{
  await assert.rejects(sync.restoreChromeSyncBackup(),e=>/restore committed, but legacy metadata upgrade failed/.test(e.message)&&e.cause?.message==="legacy upload unavailable");
  assert.deepEqual(control.state.blockedSites,[]);
  assert.notDeepEqual(control.state.blockedSites,newerLocal.blockedSites);
}finally{remote.set=realSet}
await sync.uploadChromeSyncBackup();
assert.equal((await sync.getChromeSyncBackupMeta()).version,3);

// Equal revision tie-breaker is deterministic across devices and independent
// of wall clock. Both copies differ from the common local baseline.
const common=structuredClone(control.state);
const baseFrame=await remote.get(null);
await blockHost("remote-edit.example");
await sync.uploadChromeSyncBackup();
const remoteFrame=await remote.get(null);
const restoreLocal=async state=>{
  const extra=Object.keys(control.state).filter(k=>!Object.hasOwn(state,k));
  if(extra.length)await local.remove(extra);
  await local.set(state);
};
await restoreLocal(common);
await blockHost("local-edit.example");
await sync.uploadChromeSyncBackup();
const localFrame=await remote.get(null);
await local.set({[localMetaKey]:baseFrame[metaKey]});
const equalRevision=control.state.startTabDataRevision.updatedAt;
await realSet({...remoteFrame,[metaKey]:{...remoteFrame[metaKey],contentUpdatedAt:equalRevision}});
const remoteWins=remoteFrame[metaKey].contentChecksum>localFrame[metaKey].contentChecksum;
assert.equal(await sync.syncChromeSyncBackup(),remoteWins?"restored":"uploaded");
assert.deepEqual(control.state.blockedSites,[remoteWins?"remote-edit.example":"local-edit.example"]);
console.log("Browser Sync: failed remote confirmation, bounded retries, post-commit legacy failure and equal-revision conflict");

await sync.uploadChromeSyncBackup();
const verified=await remote.get(null);
const beforeVerify=await local.get(null);
let readChunks=false;
remote.get=async keys=>{
  const result=await realGet(keys);
  if(Array.isArray(keys)&&keys.some(k=>k.startsWith("startTabSyncChunk"))){
    readChunks=true;
    await realSet({[metaKey]:{...verified[metaKey],snapshotId:"new-remote-snapshot"}});
  }
  return result;
};
try{
  await assert.rejects(sync.restoreChromeSyncBackup(),/changed concurrently while it was being verified/);
  assert.equal(readChunks,true);
  assert.deepEqual(await local.get(null),beforeVerify);
}finally{remote.get=realGet;await realSet(verified)}
// An unknown legacy metadata version must never overwrite a newer frame
// that arrives between the initial read and the late commit guard.
let metaReads=0;
remote.get=async keys=>{
  if(keys===metaKey&&++metaReads>=2)return {[metaKey]:{version:999}};
  return realGet(keys);
};
try{
  await assert.rejects(sync.uploadChromeSyncBackup(),/newer extension version/);
}finally{remote.get=realGet}
assert.deepEqual(await realGet(null),verified);
console.log("Browser Sync: remote metadata changes during content verification and late future-version refusal");


// First synchronization with no common baseline: a genuinely pristine
// installation should accept an older remote backup, but each kind of local
// user data must independently prevent that destructive decision.
const pristine=api.createDefaultStartPageSettings(100);
const pristineRuntime=normalizeRuntimeState(undefined,pristine);
const noteId=pristine.layout.blocks.find(b=>b.type==="note").id;
const remoteSeed=installChrome({startPageSettings:pristine,startPageRuntimeState:pristineRuntime,blockedSites:["remote-only.example"]});
await sync.uploadChromeSyncBackup();
const remoteSeedFrame=await remoteSeed.chrome.storage.sync.get(null);
const oldFrame={...remoteSeedFrame,[metaKey]:{...remoteSeedFrame[metaKey],contentUpdatedAt:1}};
for(const kind of ["pristine","settings","note","blocked","onboarding","locale","statistics"]){
  const s=structuredClone(pristine),runtime=structuredClone(pristineRuntime);
  const initial={startPageSettings:s,startPageRuntimeState:runtime,blockedSites:[],startTabDataRevision:{version:1,updatedAt:Date.now()+10000}};
  if(kind==="settings")s.layout.gap+=1;
  if(kind==="note")runtime.notes[noteId]="locally written";
  if(kind==="blocked")initial.blockedSites=["local-only.example"];
  if(kind==="onboarding")initial.startPageOnboarding={onboarded:true};
  if(kind==="locale")initial.localeOverride="ru";
  const fresh=installChrome(initial);
  if(kind==="statistics"){
    const stats=await import("../src/lib/focus-stats.js");
    await stats.recordUnblockAfterCountdown("local.example");
  }
  await fresh.chrome.storage.sync.set(oldFrame);
  const result=await sync.syncChromeSyncBackup();
  assert.equal(result,kind==="pristine"?"restored":"uploaded",kind);
  if(kind==="pristine")assert.deepEqual(fresh.state.blockedSites,["remote-only.example"]);
  else {
    assert.deepEqual(fresh.state.blockedSites,initial.blockedSites);
    if(kind==="note")assert.equal(fresh.state.startPageRuntimeState.notes[noteId],"locally written");
    if(kind==="settings")assert.equal(fresh.state.startPageSettings.layout.gap,s.layout.gap);
    if(kind==="locale")assert.equal(fresh.state.localeOverride,"ru");
    if(kind==="onboarding")assert.equal(fresh.state.startPageOnboarding.onboarded,true);
    if(kind==="statistics")assert.equal((await (await import("../src/lib/focus-stats.js")).getFocusStats()).totals.unblocksAfterCountdown,1);
  }
}
// A remote frame may arrive exactly at the final absence check. The smart
// operation must retry its decision instead of overwriting newly arrived data.
const race=installChrome({startPageSettings:pristine,startPageRuntimeState:pristineRuntime,blockedSites:[]});
const raceSync=race.chrome.storage.sync;
const raceGet=raceSync.get;
let fullReads=0;
raceSync.get=async keys=>{
  if(keys===null&&++fullReads===2)await raceSync.set(oldFrame);
  return raceGet(keys);
};
assert.equal(await sync.syncChromeSyncBackup(),"restored");
assert.ok(fullReads>=2);
assert.deepEqual(race.state.blockedSites,["remote-only.example"]);
console.log("Browser Sync: first-contact pristine/non-pristine decision matrix and a frame arriving at the final absence guard");


// A successful legacy restore must never overwrite a new local edit made
// immediately after import commit while the optional metadata upgrade runs.
{
  const fresh=installChrome({startPageSettings:pristine,startPageRuntimeState:pristineRuntime,blockedSites:["local-before-legacy.example"]});
  const local=fresh.chrome.storage.local,remote=fresh.chrome.storage.sync;
  const meta=remoteSeedFrame[metaKey];
  const legacy={version:2,updatedAt:meta.updatedAt,deviceId:meta.deviceId,checksum:meta.checksum,chunks:meta.chunks};
  await remote.set({...remoteSeedFrame,[metaKey]:legacy});
  const originalSet=local.set,originalGet=local.get;
  let imported=false,edited=false;
  local.set=async values=>{
    await originalSet(values);
    if(values[localMetaKey]?.snapshotId?.startsWith("legacy-"))imported=true;
  };
  local.get=async keys=>{
    if(imported&&!edited){
      edited=true;
      await originalSet({blockedSites:["edited-after-legacy.example"]});
    }
    return originalGet(keys);
  };
  try{
    await sync.restoreChromeSyncBackup();
    assert.equal(imported,true);assert.equal(edited,true);
    assert.deepEqual(fresh.state.blockedSites,["edited-after-legacy.example"]);
    assert.equal((await remote.get(metaKey))[metaKey].version,2);
    assert.match(fresh.state[localMetaKey].snapshotId,/^legacy-/);
  }finally{local.set=originalSet;local.get=originalGet}
}

// An invalid local durable revision must be refused by the shared reader
// before an upload can replace any remote frame or local sync metadata.
for (const updatedAt of [1.25, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER+1]) {
  const fresh=installChrome({startPageSettings:pristine,startPageRuntimeState:pristineRuntime,
    startTabDataRevision:{version:1,updatedAt}});
  const remote=fresh.chrome.storage.sync;
  await remote.set(oldFrame);
  const original=await remote.get(null), before=structuredClone(fresh.state);
  await assert.rejects(sync.uploadChromeSyncBackup(),/safe integer range/);
  assert.deepEqual(await remote.get(null),original);
  assert.deepEqual(fresh.state,before);
}
