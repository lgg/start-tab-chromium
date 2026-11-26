import assert from "node:assert/strict";
import { installDom, installChrome, host, one, button, value, event, submit, until, delay, i18n } from "./ui-fixture-dom.mjs";
import { createBlockInstance, createDefaultStartPageSettings } from "../src/lib/start-page-settings.js";
import { normalizeRuntimeState, startClockState, defaultClockForBlock } from "../src/lib/start-page-runtime.js";
import { renderBlockContent } from "../src/newtab/block-renderers.js";
import { renderHiddenNoteDrafts, hasUnsavedNoteDrafts, hiddenTaskDrafts } from "../src/newtab/block-renderers-runtime.js";
import { renderHiddenTextDrafts } from "../src/newtab/hidden-text-drafts.js";
import { formatDateParts } from "../src/newtab/date-pattern.js";

const dom=await installDom();
const settings=createDefaultStartPageSettings(100);
const note=createBlockInstance("note",{id:"race-note"});
const tasks=createBlockInstance("localTasks",{id:"race-tasks"});
const links=createBlockInstance("links",{id:"race-links",config:{type:"links",columns:1,rows:1,pageDirection:"horizontal",fontFamily:"inherit",fontSize:13,iconSize:28,items:[{id:"a",title:"A",url:"https://a.example/",icon:"A"},{id:"b",title:"B",url:"https://b.example/",icon:"B"}]}});
const timer=createBlockInstance("timer",{id:"race-timer",config:{type:"timer",durationSeconds:1,notifyOnComplete:true}});
const pomodoro=createBlockInstance("pomodoro",{id:"race-pomodoro"});
settings.layout.blocks=[note,tasks,links,timer,pomodoro];
const runtime=normalizeRuntimeState(undefined,settings);
runtime.updatedAt=Date.now();
const control=installChrome({startPageSettings:settings,startPageRuntimeState:runtime});
const errors=[],writes=[],cleanups=[];
let refreshes=0,revision=runtime.updatedAt;
function commit(m){
  const r=context.runtime;
  r.updatedAt=++revision;
  if(m.kind==="note")r.notes[m.instanceId]=m.value;
  if(m.kind==="tasks")r.tasks[m.instanceId]=structuredClone(m.tasks);
  if(m.kind==="linkPage")r.linkPages[m.instanceId]=m.page;
  control.state.startPageRuntimeState=structuredClone(r);
}
let write=async m=>{commit(m);return {ok:true}};
const context={i18n,settings,runtime,registerCleanup:f=>cleanups.push(f),reportError:e=>errors.push(e),requestRender:()=>refreshes++,setRuntime:async m=>{writes.push(structuredClone(m));return write(m)}};
function mount(block){
  const root=host();const start=cleanups.length;
  renderBlockContent(block,root,context);
  const owned=cleanups.slice(start);
  return {root,dispose(){root.remove();for(const f of owned)f()}};
}
assert.equal(formatDateParts("HH:mm:ss",{}),"::");
assert.equal(formatDateParts("dddd/YYYY/MMMM/DD",{}),"///");
try{
  // Re-render while the first note write is pending. Preserve the user's
  // newer draft and send it with the first acknowledgement as baseline.
  let firstResolve;
  write=m=>new Promise(resolve=>{firstResolve=()=>{commit(m);resolve({ok:true,runtimeUpdatedAt:revision})}});
  const first=mount(note);
  value(one(first.root,"textarea"),"first");
  await until(()=>firstResolve,"first note save");
  value(one(first.root,"textarea"),"second");
  const second=mount(note);
  assert.equal(one(second.root,"textarea").value,"second");
  first.dispose();
  const originalFirstResolve=firstResolve;
  write=async m=>{commit(m);return {ok:true}};
  originalFirstResolve();
  await until(()=>context.runtime.notes[note.id]==="second"&&!hasUnsavedNoteDrafts(),"queued successor");
  assert.deepEqual(writes.filter(m=>m.kind==="note").map(m=>[m.expectedValue,m.value]),[["","first"],["first","second"]]);
  // Explicit conflict resolution must ask before overwriting newer stored text.
  write=async()=>{throw Error("write conflict")};
  value(one(second.root,"textarea"),"local draft");
  await until(()=>!one(second.root,".note-save-status").hidden);
  context.runtime.notes[note.id]="remote note";context.runtime.updatedAt=++revision;
  control.state.startPageRuntimeState=structuredClone(context.runtime);
  const third=mount(note);second.dispose();
  window.confirm=()=>false;
  button(third.root,"noteDraftRetry").click();
  await until(()=>!button(third.root,"noteDraftRetry").disabled);
  assert.equal(one(third.root,"textarea").value,"local draft");
  assert.equal(context.runtime.notes[note.id],"remote note");
  window.confirm=()=>true;
  write=async m=>{commit(m);return {ok:true,runtimeUpdatedAt:revision}};
  button(third.root,"noteDraftRetry").click();
  await until(()=>context.runtime.notes[note.id]==="local draft"&&!hasUnsavedNoteDrafts());
  assert.equal(writes.at(-1).expectedValue,"remote note");
  write=async()=>{throw Error("offline")};
  value(one(third.root,"textarea"),"hidden unsaved");
  await until(()=>!one(third.root,".note-save-status").hidden);
  third.dispose();
  const hidden=host();
  renderHiddenNoteDrafts(hidden,new Set(),new Set(),context);
  assert.equal(one(hidden,"textarea").value,"hidden unsaved");
  window.confirm=()=>false;button(hidden,"hiddenNoteDiscard").click();await delay();
  assert.equal(hasUnsavedNoteDrafts(),true);
  window.confirm=()=>true;button(hidden,"hiddenNoteDiscard").click();
  await until(()=>!hasUnsavedNoteDrafts());
  renderHiddenNoteDrafts(hidden,new Set(),new Set(),context);assert.equal(hidden.hidden,true);

  // Old worker acks are committed even without savedTasks/savedLinkPage.
  write=async m=>{commit(m);return {ok:true}};
  const taskView=mount(tasks);
  value(one(taskView.root,"input"),"test task");submit(one(taskView.root,"form"));
  await until(()=>taskView.root.querySelector(".task__title")?.textContent==="test task");
  assert.equal(one(taskView.root,"input").value,"");
  const linkView=mount(links);
  button(linkView.root,"nextPage").click();
  await until(()=>one(linkView.root,"a").href==="https://b.example/");
  assert.equal(context.runtime.linkPages[links.id],1);
  const oldGet=control.chrome.storage.local.get;
  write=async m=>{commit(m);control.chrome.storage.local.get=async()=>{throw Error("read failed")};return {ok:true}};
  button(linkView.root,"nextPage").click();
  await until(()=>errors.some(e=>e.message==="runtimeSavedRefreshFailed"));
  assert.equal(context.runtime.linkPages[links.id],0);
  control.chrome.storage.local.get=oldGet;
  await until(()=>!button(linkView.root,"nextPage").disabled);
  // Hidden task text is recoverable without submitting to a different widget.
  value(one(taskView.root,"input"),"hidden task");
  const textHost=host();renderHiddenTextDrafts(textHost,hiddenTaskDrafts(new Set()),context);
  assert.equal(one(textHost,"textarea").value,"hidden task");
  button(textHost,"hiddenNoteDiscard").click();await delay();
  assert.equal(hiddenTaskDrafts(new Set()).length,0);
  taskView.dispose();linkView.dispose();
  // Timer completion notification failure is a committed completion, not
  // an endlessly retried action. Render the actual break phase as well.
  context.runtime.clocks[timer.id]=startClockState(defaultClockForBlock(timer),Date.now()-2000);
  control.state.startPageRuntimeState=structuredClone(context.runtime);
  control.handler=async m=>{
    if(m.type==="complete-clock"){
      context.runtime.clocks[timer.id]={...defaultClockForBlock(timer),lastCompletedToken:m.token};
      control.state.startPageRuntimeState=structuredClone(context.runtime);
      return {ok:true,notificationFailed:true};
    }
    return {ok:true};
  };
  const clock=mount(timer);
  await until(()=>errors.some(e=>e.message==="clockCompletedNotificationFailed"));
  await until(()=>!button(clock.root,"clockStart").disabled);
  assert.equal(control.messages.filter(m=>m.type==="complete-clock").length,1);
  context.runtime.clocks[pomodoro.id]={...defaultClockForBlock(pomodoro),phase:"break"};
  const phase=mount(pomodoro);
  assert.equal(one(phase.root,".clock__phase").textContent,"pomodoroBreak");
  clock.dispose();phase.dispose();
  console.log("Widget races: pending notes, explicit overwrite, hidden drafts, legacy ACKs, failed refresh and timer completion");
}finally{dom.window.close()}
