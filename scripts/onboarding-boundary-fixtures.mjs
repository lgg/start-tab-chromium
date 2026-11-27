import assert from "node:assert/strict";
import { installDom, installChrome, installFetch, one, button, until, delay } from "./ui-fixture-dom.mjs";
import { createDefaultStartPageSettings, createBlockInstance, settingsWithLayoutPreset } from "../src/lib/start-page-settings.js";
import { normalizeRuntimeState } from "../src/lib/start-page-runtime.js";
import { loadI18n } from "../src/lib/i18n.js";

const restoreFetch=installFetch();
let serial=0;
try{
  // Onboarding must preserve private data when replacing the layout, and
  // cannot repeat a mutation after another tab completed the onboarding.
  const dom=await installDom("newtab/newtab.html","https://extension.example/newtab.html");
  const settings=createDefaultStartPageSettings(100);
  const note=createBlockInstance("note",{id:"private-onboarding-note",title:"Private onboarding note"});
  settings.layout.blocks.push(note);
  const runtime=normalizeRuntimeState(undefined,settings);
  runtime.notes[note.id]="private data";
  const control=installChrome({startPageSettings:settings,startPageRuntimeState:runtime,localeOverride:"en",startPageOnboarding:{onboarded:false}});
  try{
    const t=await loadI18n();
    await import("../src/newtab/newtab.ts?onboarding="+(++serial));
    const modal=()=>document.getElementById("onboarding");
    await until(()=>modal());
    const presets=[...modal().querySelectorAll(".onboarding__presets button")];
    const {LAYOUT_PRESETS}=await import("../src/lib/start-page-settings.js");
    const index=LAYOUT_PRESETS.findIndex(p=>!settingsWithLayoutPreset(settings,p.id).layout.blocks.some(b=>b.id===note.id));
    assert.ok(index>=0);
    let confirmations=[];
    window.confirm=message=>{confirmations.push(message);return false};
    presets[index].click();
    await until(()=>confirmations.length>0&&presets.every(b=>!b.disabled));
    assert.ok(confirmations.includes(t.t("applyPresetWithDataConfirm")));
    assert.equal(control.messages.length,0);
    assert.equal(control.state.startPageRuntimeState.notes[note.id],"private data");
    // No storage event is needed: the transaction itself rechecks.
    control.state.startPageOnboarding={onboarded:true};
    presets[index].click();await until(()=>!modal());
    assert.equal(control.messages.length,0);
    assert.equal(control.state.startPageRuntimeState.notes[note.id],"private data");

    // Real page integration: free-position preview is wired through
    // LayoutEditor, and a resize event cannot replace a card mid-drag.
    const {value,pointer}=await import("./ui-fixture-dom.mjs");
    button(one(document,"#editorToolbar"),t.t("editLayout")).click();
    await until(()=>one(document,"#startPage").dataset.editorActive==="true");
    value(one(document,"#editorToolbar select"),"free","change");
    await until(()=>one(document,"#startPage").dataset.layoutMode==="free");
    const zone=one(document,'#editorToolbar select[aria-label="'+t.t("layoutZone")+'"]');
    value(zone,"full","change");
    await until(()=>one(document,"#startPage").dataset.layoutZone==="full");
    const card=()=>one(document,'[data-block-id="'+note.id+'"]');
    const dragging=card();
    assert.equal(one(dragging,".card__title").textContent,"Private onboarding note");
    const before=Number.parseFloat(dragging.style.left);
    pointer(one(dragging,".card__drag-handle"),"pointerdown",10,10);
    pointer(dragging,"pointermove",35,30);
    assert.equal(Number.parseFloat(dragging.style.left),before+25);
    window.dispatchEvent(new window.Event("resize"));await delay(40);
    assert.equal(card(),dragging);
    pointer(dragging,"pointerup",35,30);
    await until(()=>card()!==dragging);
    assert.equal(Number.parseFloat(card().style.left),before+25);
    window.confirm=()=>true;
    button(one(document,"#editorToolbar"),t.t("cancel")).click();
    await until(()=>one(document,"#startPage").dataset.editorActive==="false");
    assert.equal(control.state.startPageRuntimeState.notes[note.id],"private data");
    window.dispatchEvent(new window.Event("pagehide"));
  }finally{dom.window.close()}
  console.log("Onboarding: destructive preset cancelled, cross-tab completion and no duplicate writes");
}finally{restoreFetch()}
