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
  // The same session can reappear in a new renderer. Neither detached
  // hidden controls nor old visible retry/discard controls own that draft.
  const staleHidden=button(hidden,"hiddenNoteDiscard");
  const staleRetry=button(third.root,"noteDraftRetry");
  const staleDiscard=button(third.root,"noteDraftDiscard");
  const returned=mount(note);
  renderHiddenNoteDrafts(hidden,new Set([note.id]),new Set([note.id]),context);
  assert.equal(hidden.hidden,true);
  let prompts=0;
  window.confirm=()=>{prompts++;return true};
  const beforeStale=writes.length;
  staleHidden.click();staleRetry.click();staleDiscard.click();
  await delay(20);
  assert.equal(prompts,0);
  assert.equal(writes.length,beforeStale);
  assert.equal(hasUnsavedNoteDrafts(),true);
  assert.equal(one(returned.root,"textarea").value,"hidden unsaved");
  returned.dispose();
  renderHiddenNoteDrafts(hidden,new Set(),new Set(),context);
  button(hidden,"hiddenNoteDiscard").click();
  await until(()=>!hasUnsavedNoteDrafts());
  assert.equal(prompts,1);
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

  const searchModule=await import("../src/newtab/block-renderers-static.js");
  const defaultSearch=createBlockInstance("search");
  const search=createBlockInstance("search",{id:"search-boundaries",title:"My search",config:{...defaultSearch.config,provider:"missing",providers:[{id:"fallback",title:"Fallback",urlTemplate:"https://extension.example/#q={query}"}]}});
  const searchView=mount(search);
  const searchInput=one(searchView.root,"input");
  value(searchInput,"  ");submit(one(searchView.root,"form"));
  assert.equal(location.hash,"");
  value(searchInput,"hello world");submit(one(searchView.root,"form"));
  assert.equal(location.hash,"#q=hello%20world");
  assert.equal(searchModule.hasSearchDrafts(),true);
  searchView.dispose();
  value(searchInput,"stale detached");
  submit(one(searchView.root,"form"));
  assert.equal(location.hash,"#q=hello%20world");
  const hiddenSearch=searchModule.hiddenSearchDrafts(new Set()).find(d=>d.title==="My search");
  assert.equal(hiddenSearch.value,"hello world");
  assert.equal(hiddenSearch.discard(),true);
  const emptySearch=mount({...search,id:"empty-search",config:{...search.config,providers:[]}});
  value(one(emptySearch.root,"input"),"never sent");submit(one(emptySearch.root,"form"));
  assert.equal(location.hash,"#q=hello%20world");
  emptySearch.dispose();

  const oldFetch=globalThis.fetch;
  const oldQuery=control.chrome.tabs.query;
  try{
    globalThis.fetch=async()=>Response.json({ip:"192.0.2.1"});
    const ip=mount(createBlockInstance("ip",{id:"bare-ip"}));
    await until(()=>ip.root.textContent.includes("ipUnknownCountry"));
    assert.match(ip.root.textContent,/192\.0\.2\.1/);
    ip.dispose();
    control.chrome.tabs.query=async()=>{throw Error("pinned tabs unavailable")};
    const pinned=mount(createBlockInstance("browserPinned"));
    await until(()=>pinned.root.textContent==="browserPinnedUnavailable");
    pinned.dispose();
    let finishIp;
    globalThis.fetch=async()=>new Promise(resolve=>finishIp=resolve);
    const staleIp=mount(createBlockInstance("ip",{id:"stale-ip",config:{type:"ip",endpoint:"https://new-ip.example/"}}));
    await until(()=>finishIp);
    const staleDetail=one(staleIp.root,".ip__detail");staleIp.dispose();
    finishIp(Response.json({ip:"192.0.2.99",country:"Test"}));
    await delay(20);
    assert.equal(staleDetail.textContent,"ipLoading");
  }finally{globalThis.fetch=oldFetch;control.chrome.tabs.query=oldQuery}

  // A detached renderer must not submit or overwrite a newer draft.
  {
    const customNote={...note,id:"custom-note-lifecycle",title:"Private note",config:{...note.config,placeholder:"Custom note placeholder"}};
    const customTasks={...tasks,id:"custom-task-lifecycle",title:"Private tasks",config:{...tasks.config,placeholder:"Custom task placeholder"}};
    const old=mount(customNote), live=mount(customNote);
    assert.equal(one(live.root,"textarea").placeholder,"Custom note placeholder");
    assert.equal(one(live.root,"textarea").getAttribute("aria-label"),"Private note");
    const priorWrites=writes.length;
    value(one(old.root,"textarea"),"obsolete note");
    old.dispose();
    await delay(220);
    assert.equal(writes.length,priorWrites);
    assert.equal(one(live.root,"textarea").value,"");
    live.dispose();
    const a=mount(customTasks), b=mount(customTasks);
    assert.equal(one(b.root,"input").placeholder,"Custom task placeholder");
    value(one(a.root,"input"),"obsolete task");
    submit(one(a.root,"form"));
    assert.equal(writes.length,priorWrites);
    assert.equal(one(b.root,"input").value,"");
    a.dispose();
    // Emulate a platform without randomUUID; task IDs must still be unique.
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,"crypto");
    try{
      Object.defineProperty(globalThis,"crypto",{configurable:true,value:undefined});
      write=async m=>{commit(m);return {ok:true,runtimeUpdatedAt:revision,savedTasks:m.tasks}};
      value(one(b.root,"input"),"first fallback task");submit(one(b.root,"form"));
      await until(()=>b.root.querySelectorAll(".task").length===1&&!one(b.root,"form button").disabled);
      value(one(b.root,"input"),"second fallback task");submit(one(b.root,"form"));
      await until(()=>b.root.querySelectorAll(".task").length===2&&!one(b.root,"form button").disabled);
      const saved=context.runtime.tasks[customTasks.id];
      assert.equal(new Set(saved.map(t=>t.id)).size,2);
      assert.ok(saved.every(t=>t.id.startsWith("task-")));
      const checks=b.root.querySelectorAll(".task__check");
      checks[0].checked=true;event(checks[0],"change");
      await until(()=>context.runtime.tasks[customTasks.id][0].done&&!one(b.root,"form button").disabled);
      assert.equal(context.runtime.tasks[customTasks.id][1].done,false);
    }finally{Object.defineProperty(globalThis,"crypto",descriptor)}
    b.dispose();
    const beforeDetached=writes.length;
    value(one(b.root,"input"),"detached draft");submit(one(b.root,"form"));
    assert.equal(writes.length,beforeDetached);
  }
  // A hidden draft with an obsolete generation cannot discard its successor.
  {
    const h=host();let discards=0;
    const drafts=[{kind:"search",title:"",value:"preserved",pending:false,discard:()=>{discards++;return false}}];
    renderHiddenTextDrafts(h,drafts,context);
    assert.equal(one(h,"strong").textContent,"hiddenSearchDraft");
    const select=button(h,"hiddenNoteSelect"),discard=button(h,"hiddenNoteDiscard");
    const before=refreshes;
    discard.click();await delay();
    assert.equal(discards,1);assert.equal(refreshes,before);
    h.remove();select.click();discard.click();await delay();
    assert.equal(discards,1);assert.equal(refreshes,before);
  }
  // A failed completion refresh must retain the acknowledgement and a
  // disposed clock must ignore even synthetic events from its old controls.
  {
    const custom={...timer,id:"clock-disposal"};
    const c=mount(custom);
    const oldButton=button(c.root,"clockStart");
    const before=control.messages.length;
    c.dispose();oldButton.click();await delay();
    assert.equal(control.messages.length,before);
  }

  // A clock acknowledgement is committed even if the following canonical
  // read fails. A renderer replaced during the request must not redraw.
  {
    const b={...timer,id:"clock-refresh-race"};
    settings.layout.blocks.push(b);
    control.state.startPageSettings=structuredClone(settings);
    const initial=mount(b),reset=button(initial.root,"clockReset");
    const previousGet=control.chrome.storage.local.get;
    const originalHandler=control.handler;
    let release;
    control.handler=m=>new Promise(resolve=>{release=()=>resolve({ok:true})});
    try{
      reset.click();await until(()=>release);
      const count=control.messages.length;
      const replacement=mount(b);
      assert.equal(button(replacement.root,"clockReset").disabled,true);
      reset.dispatchEvent(new window.MouseEvent("click",{bubbles:true}));
      assert.equal(control.messages.length,count);
      initial.dispose();
      const previousErrors=errors.length;
      control.chrome.storage.local.get=async()=>{throw Error("clock canonical read unavailable")};
      release();
      await until(()=>errors.length>previousErrors);
      assert.equal(errors.at(-1).message,"runtimeSavedRefreshFailed");
      assert.equal(errors.at(-1).cause.message,"clock canonical read unavailable");
      control.chrome.storage.local.get=previousGet;
      await until(()=>!button(replacement.root,"clockReset").disabled);
      replacement.dispose();
    }finally{control.chrome.storage.local.get=previousGet;control.handler=originalHandler}
  }
  // Failed refresh after completion must not silently report success or
  // immediately repeat the same completion token.
  {
    const b={...timer,id:"clock-completion-refresh"};
    settings.layout.blocks.push(b);
    context.runtime.clocks[b.id]=startClockState(defaultClockForBlock(b),Date.now()-3000);
    control.state.startPageSettings=structuredClone(settings);
    control.state.startPageRuntimeState=structuredClone(context.runtime);
    const previousGet=control.chrome.storage.local.get;
    const originalHandler=control.handler;
    const previousErrors=errors.length;
    control.handler=async m=>{
      if(m.type==="complete-clock"){
        context.runtime.clocks[b.id]={...defaultClockForBlock(b),lastCompletedToken:m.token};
        control.state.startPageRuntimeState=structuredClone(context.runtime);
        control.chrome.storage.local.get=async()=>{throw Error("completion refresh unavailable")};
      }
      return {ok:true};
    };
    try{
      const view=mount(b);
      await until(()=>errors.length>previousErrors);
      assert.equal(errors.at(-1).cause.message,"completion refresh unavailable");
      await until(()=>!button(view.root,"clockStart").disabled);
      assert.equal(control.messages.filter(m=>m.type==="complete-clock"&&m.instanceId===b.id).length,1);
      view.dispose();
    }finally{control.chrome.storage.local.get=previousGet;control.handler=originalHandler}
  }
  // Legacy task acknowledgements without savedTasks still commit; an
  // unavailable subsequent read does not destroy a newly typed draft.
  {
    const b={...tasks,id:"tasks-legacy-refresh-failure"};
    settings.layout.blocks.push(b);
    const view=mount(b),input=one(view.root,"input");
    const previousGet=control.chrome.storage.local.get;
    const previousErrors=errors.length;
    let finish;
    write=m=>new Promise(resolve=>{finish=()=>{commit(m);control.chrome.storage.local.get=async()=>{throw Error("task refresh unavailable")};resolve({ok:true})}});
    try{
      value(input,"committed task");submit(one(view.root,"form"));
      await until(()=>finish);
      value(input,"next unsaved task");finish();
      await until(()=>errors.length>previousErrors&&!one(view.root,"form button").disabled);
      assert.equal(errors.at(-1).cause.message,"task refresh unavailable");
      assert.equal(input.value,"next unsaved task");
      assert.equal(context.runtime.tasks[b.id][0].title,"committed task");
      view.dispose();
    }finally{control.chrome.storage.local.get=previousGet;write=async m=>{commit(m);return {ok:true}}}
  }

  // A hidden note must remain recoverable while a detached renderer's
  // write is pending, and a stale discard button must not erase its successor.
  {
    const b={...note,id:"hidden-pending-note"};
    settings.layout.blocks.push(b);
    control.state.startPageSettings=structuredClone(settings);
    let release;
    const previous=write;
    write=m=>new Promise(resolve=>{release=()=>{commit(m);resolve({ok:true,runtimeUpdatedAt:revision})}});
    try{
      const view=mount(b);
      value(one(view.root,"textarea"),"pending note");
      await until(()=>release);
      view.dispose();
      const h=host();
      renderHiddenNoteDrafts(h,new Set(),new Set([b.id]),context);
      const discard=button(h,"hiddenNoteDiscard");
      assert.equal(discard.disabled,true);
      event(discard,"click");await delay(20);
      assert.equal(hasUnsavedNoteDrafts(),true);
      assert.equal(one(h,"textarea").value,"pending note");
      const prior=refreshes;
      release();
      await until(()=>context.runtime.notes[b.id]==="pending note"&&!hasUnsavedNoteDrafts());
      assert.ok(refreshes>prior);
      renderHiddenNoteDrafts(h,new Set(),new Set(),context);
      assert.equal(h.hidden,true);
      const newView=mount(b);
      value(one(newView.root,"textarea"),"new note");
      event(discard,"click");
      assert.equal(one(newView.root,"textarea").value,"new note");
      newView.dispose();
      await until(()=>writes.at(-1)?.value==="new note");
      release();
      await until(()=>!hasUnsavedNoteDrafts());
      assert.equal(context.runtime.notes[b.id],"new note");
    }finally{write=previous}
  }

  // A legacy ACK may arrive just as another tab deletes the corresponding
  // widget. Canonical readback must accept the removed instance, not revive
  // its old tasks/link page, and stale detached buttons cannot issue writes.
  for(const original of [tasks,links]){
    const id="removed-while-saving-"+original.type;
    const b={...structuredClone(original),id};
    settings.layout.blocks.push(b);
    control.state.startPageSettings=structuredClone(settings);
    context.runtime.updatedAt=++revision;
    if(b.type==="localTasks")context.runtime.tasks[id]=[{id:"keep",title:"Old task",done:false,createdAt:1,updatedAt:1}];
    else context.runtime.linkPages[id]=0;
    control.state.startPageRuntimeState=structuredClone(context.runtime);
    const mounted=mount(b);
    let release;
    const previousWrite=write;
    const before=errors.length;
    write=m=>new Promise(resolve=>{release=()=>{
      commit(m);
      // The mock worker has committed; the later settings transaction
      // removes the widget and prunes its corresponding runtime map.
      settings.layout.blocks=settings.layout.blocks.filter(item=>item.id!==id);
      control.state.startPageSettings=structuredClone(settings);
      delete context.runtime.tasks[id];delete context.runtime.linkPages[id];
      context.runtime.updatedAt=++revision;
      control.state.startPageRuntimeState=structuredClone(context.runtime);
      resolve({ok:true});
    }});
    try{
      const stale=b.type==="localTasks"?one(mounted.root,".task__check"):button(mounted.root,"nextPage");
      if(b.type==="localTasks"){stale.checked=true;event(stale,"change")}else stale.click();
      await until(()=>release);
      const count=writes.length;
      mounted.dispose();
      release();
      await until(()=>control.state.startPageSettings.layout.blocks.every(item=>item.id!==id));
      await delay(40);
      if(b.type==="localTasks")event(stale,"change");else event(stale,"click");
      await delay(20);
      assert.equal(writes.length,count);
      assert.equal(errors.length,before);
      assert.equal(control.state.startPageRuntimeState.tasks[id],undefined);
      assert.equal(control.state.startPageRuntimeState.linkPages[id],undefined);
    }finally{write=previousWrite}
  }

  // A transient save rejection with no competing edit must retry without an
  // overwrite confirmation. A deliberate discard must prompt, and only the
  // accepted confirmation may replace the private draft with stored text.
  {
    const b={...note,id:"note-explicit-recovery"};
    settings.layout.blocks.push(b);
    control.state.startPageSettings=structuredClone(settings);
    context.runtime.notes[b.id]="committed baseline";
    context.runtime.updatedAt=++revision;
    control.state.startPageRuntimeState=structuredClone(context.runtime);
    const originalWrite=write, originalConfirm=window.confirm;
    const view=mount(b);
    const input=one(view.root,"textarea"),status=one(view.root,".note-save-status");
    const retry=button(view.root,"noteDraftRetry"),discard=button(view.root,"noteDraftDiscard");
    let prompts=0;
    try{
      write=async()=>{throw Error("temporarily offline")};
      value(input,"retry without conflict");
      await until(()=>!status.hidden);
      const beforeRetry=writes.length;
      window.confirm=()=>{prompts++;return false};
      write=async m=>{commit(m);return {ok:true,runtimeUpdatedAt:revision}};
      retry.click();
      await until(()=>status.hidden&&context.runtime.notes[b.id]==="retry without conflict");
      assert.equal(prompts,0);
      assert.equal(writes.length,beforeRetry+1);
      assert.equal(writes.at(-1).expectedValue,"committed baseline");
      write=async()=>{throw Error("temporarily offline again")};
      value(input,"private rejected draft");
      await until(()=>!status.hidden);
      const beforeDiscard=writes.length;
      discard.click();
      await until(()=>prompts===1&&!discard.disabled);
      assert.equal(input.value,"private rejected draft");
      assert.equal(status.hidden,false);
      assert.equal(writes.length,beforeDiscard);
      window.confirm=()=>{prompts++;return true};
      discard.click();
      await until(()=>status.hidden&&!discard.disabled);
      assert.equal(prompts,2);
      assert.equal(input.value,"retry without conflict");
      assert.equal(context.runtime.notes[b.id],"retry without conflict");
      assert.equal(writes.length,beforeDiscard);
    }finally{
      view.dispose();write=originalWrite;window.confirm=originalConfirm;
    }
  }
  console.log("Widgets: fallback search, disconnected controls, hidden search drafts, absent IP country and pinned failure");
  console.log("Widget races: pending notes, explicit overwrite, hidden drafts, legacy ACKs, failed refresh and timer completion");
}finally{dom.window.close()}
