import assert from "node:assert/strict";
import { installDom, installChrome, host, one, button, field, value, event, key, pointer, submit, until, i18n } from "./ui-fixture-dom.mjs";
import { LayoutEditor } from "../src/newtab/layout-editor.js";
import { editBlockInstance } from "../src/lib/block-settings-editor.js";
import { editTheme } from "../src/lib/theme-editor.js";
import { applyTheme } from "../src/newtab/theme-runtime.js";
import { BLOCK_DESCRIPTORS, createBlockInstance, createDefaultStartPageSettings, cloneSettings, getTheme } from "../src/lib/start-page-settings.js";
import { normalizeRuntimeState } from "../src/lib/start-page-runtime.js";

const dom = await installDom();
const control = installChrome();
try {
  const settings = createDefaultStartPageSettings(100);
  const note = createBlockInstance("note", { id: "layout-note", column: 1, row: 1, free: { x: 50, y: 50, width: 300, height: 250 } });
  const command = createBlockInstance("commands", { id: "layout-commands", column: 8, row: 1 });
  settings.layout.blocks = [note, command];
  settings.layout.mode = "grid";
  const runtime = normalizeRuntimeState(undefined, settings);
  runtime.updatedAt = 123;
  runtime.notes[note.id] = "Important";
  const toolbarHost = host(), paletteHost = host(), grid = host();
  let renders = 0, previews = 0, persisted, errors = [];
  const editor = new LayoutEditor(settings, { i18n, toolbarHost, paletteHost, getRuntime: () => runtime,
    requestRender: () => renders++, previewBlock: () => previews++, onSaved: s => persisted = s, onError: e => errors.push(e) });
  const block = () => editor.settings.layout.blocks.find(b => b.id === note.id);
  const card = (id = note.id) => {
    grid.replaceChildren();
    const el = document.createElement("article");
    grid.append(el);
    grid.getBoundingClientRect = () => ({ width: 1200 });
    editor.decorateCard(el, editor.settings.layout.blocks.find(b => b.id === id));
    return el;
  };
  const mode = m => value(one(toolbarHost, '[aria-label="layoutMode"]'), m, "change");
  const zone = z => value(one(toolbarHost, '[aria-label="layoutZone"]'), z, "change");
  const controls = () => card();
  assert.equal(editor.isActive, false);
  assert.equal(paletteHost.hidden, true);
  assert.equal(card().dataset.blockId, note.id);
  button(toolbarHost, "editLayout").click();
  editor.enter(); // idempotent
  assert.equal(editor.isActive, true);
  assert.equal(editor.hasUnsavedChanges, false);
  assert.equal(paletteHost.hidden, false);
  assert.ok([...paletteHost.querySelectorAll("button")].some(b => b.disabled && b.title === "singletonAlreadyAdded"));
  const addNote = [...paletteHost.querySelectorAll("button")].find(b => b.textContent.includes("blockTitleNote"));
  addNote.click();
  assert.equal(editor.settings.layout.blocks.filter(b => b.type === "note").length, 2);
  button(controls(), "duplicateBlock").click();
  assert.equal(editor.settings.layout.blocks.filter(b => b.type === "note").length, 3);
  assert.equal(new Set(editor.settings.layout.blocks.map(b => b.id)).size, 4);
  assert.equal(card(command.id).querySelector('[aria-label="duplicateBlock"]'), null);
  button(controls(), "disableBlock").click();
  assert.equal(block().enabled, false);
  button(controls(), "enableBlock").click();
  assert.equal(block().enabled, true);
  const beforeKey = block().column;
  key(card(), "ArrowRight");
  assert.ok(block().column > beforeKey);
  const beforeWidth = block().width;
  key(card(), "ArrowRight", { shiftKey: true });
  assert.ok(block().width >= beforeWidth);
  const beforeGrid = cloneSettings(editor.settings);
  let el = card();
  pointer(one(el, ".card__drag-handle"), "pointerdown", 100, 100);
  assert.equal(editor.isPointerActive, true);
  pointer(el, "pointermove", 200, 200, 2);
  assert.deepEqual(editor.settings, beforeGrid);
  pointer(el, "pointermove", 200, 200);
  assert.ok(previews > 0);
  editor.cancelPointer();
  assert.deepEqual(editor.settings, beforeGrid);
  el = card();
  pointer(one(el, ".card__resize-handle"), "pointerdown", 100, 100);
  pointer(el, "pointerup", 200, 160);
  assert.equal(editor.isPointerActive, false);
  assert.ok(block().height >= beforeGrid.layout.blocks[0].height);
  mode("free");
  assert.equal(editor.settings.layout.mode, "free");
  zone("full");
  assert.ok(editor.settings.layout.blocks.every(b => b.zone === "full"));
  const beforeFree = block().free.x;
  key(card(), "ArrowRight", { altKey: true });
  assert.equal(block().free.x, beforeFree + 1);
  const beforeFreeWidth = block().free.width;
  key(card(), "ArrowRight", { shiftKey: true });
  assert.equal(block().free.width, beforeFreeWidth + 10);
  el = card();
  const start = { ...block().free };
  pointer(one(el, ".card__drag-handle"), "pointerdown", 10, 10, 4, 2);
  assert.equal(editor.isPointerActive, false);
  pointer(one(el, ".card__drag-handle"), "pointerdown", 10, 10, 4);
  await editor.save();
  assert.equal(control.messages.length, 0, "Saving during drag must be ignored");
  pointer(el, "pointerup", 35, 45, 4);
  assert.equal(block().free.x, start.x + 25);
  assert.equal(block().free.y, start.y + 35);
  el = card();
  const resized = block().free.width;
  pointer(one(el, ".card__resize-handle"), "pointerdown", 0, 0, 5);
  pointer(el, "pointerup", 30, 20, 5);
  assert.equal(block().free.width, resized + 30);
  el = card();
  const beforeCancel = cloneSettings(editor.settings);
  pointer(one(el, ".card__drag-handle"), "pointerdown", 0, 0);
  pointer(el, "pointermove", 50, 20);
  pointer(el, "pointercancel", 50, 20);
  assert.deepEqual(editor.settings, beforeCancel);
  button(card(), "editBlock").click();
  const dialog = one(document, "dialog[open]");
  value(field(dialog, "instanceName"), "Updated note");
  submit(one(dialog, "form"));
  await until(() => block().title === "Updated note", "configured block");
  const count = editor.settings.layout.blocks.length;
  window.confirm = () => false;
  button(card(), "deleteBlock").click();
  assert.equal(editor.settings.layout.blocks.length, count);
  editor.cancel();
  assert.equal(editor.isActive, true);
  window.confirm = () => true;
  button(card(), "deleteBlock").click();
  assert.equal(editor.settings.layout.blocks.length, count - 1);
  assert.ok(!editor.settings.layout.blocks.some(b => b.id === note.id));
  const remote = cloneSettings(settings); remote.updatedAt = 200;
  editor.replaceSavedSettings(remote);
  assert.equal(editor.settings.layout.blocks.length, count - 1, "Dirty draft survives external update");
  control.handler = async () => ({ ok: false, error: "conflict" });
  await assert.rejects(() => editor.save(), /conflict/);
  assert.equal(editor.isActive, true);
  assert.equal(editor.hasUnsavedChanges, true);
  control.handler = async m => ({ ok: true, savedSettings: { ...m.settings, updatedAt: 300 } });
  await editor.save();
  assert.equal(control.messages.at(-1).expectedSettingsUpdatedAt, settings.updatedAt);
  assert.equal(control.messages.at(-1).expectedRuntimeUpdatedAt, 123);
  assert.equal(editor.isActive, false);
  assert.equal(persisted.updatedAt, 300);
  assert.equal(editor.hasUnsavedChanges, false);
  editor.enter(); mode("grid"); zone("contained"); editor.cancel();
  assert.equal(editor.settings.layout.mode, "free");
  assert.equal(editor.settings.layout.zone, "full");
  assert.ok(renders > 10);
  assert.equal(errors.length, 0);
  // Fresh clean editor: no-op gestures, deferred external baseline,
  // capture failures, stale dialogs, and acknowledgement without payload.
  const stableSettings=cloneSettings(settings);
  const stableToolbar=host(),stablePalette=host(),stableGrid=host();
  let stableSaved,stableErrors=[];
  const stable=new LayoutEditor(stableSettings,{i18n,toolbarHost:stableToolbar,paletteHost:stablePalette,getRuntime:()=>runtime,
    requestRender:()=>{},previewBlock:()=>{},onSaved:s=>stableSaved=s,onError:e=>stableErrors.push(e)});
  const stableCard=()=>{
    stableGrid.replaceChildren();
    const el=document.createElement("article");stableGrid.append(el);
    stableGrid.getBoundingClientRect=()=>({width:1200});
    stable.decorateCard(el,stable.settings.layout.blocks.find(b=>b.id===note.id));
    return el;
  };
  await stable.save();
  stable.cancel();
  stable.enter();
  let target=stableCard();
  const untouched=cloneSettings(stable.settings);
  key(one(target,".card__drag-handle"),"ArrowRight");
  key(target,"Enter");
  assert.deepEqual(stable.settings,untouched);
  target.setPointerCapture=()=>{throw Error("no capture")};
  pointer(one(target,".card__drag-handle"),"pointerdown",0,0);
  assert.equal(stable.isPointerActive,false);
  target=stableCard();
  pointer(one(target,".card__drag-handle"),"pointerdown",0,0);
  pointer(target,"pointerup",0,0);
  assert.equal(stable.hasUnsavedChanges,false);
  assert.deepEqual(stable.settings,untouched);
  target=stableCard();
  pointer(one(target,".card__drag-handle"),"pointerdown",0,0);
  const external=cloneSettings(stableSettings);external.updatedAt=500;external.layout.gap=19;
  stable.replaceSavedSettings(external);
  assert.notEqual(stable.settings.updatedAt,500);
  pointer(target,"lostpointercapture",0,0);
  assert.equal(stable.settings.updatedAt,500);
  assert.equal(stable.settings.layout.gap,19);
  assert.equal(stable.hasUnsavedChanges,false);
  target=stableCard();button(target,"editBlock").click();
  const staleDialog=one(document,"dialog[open]");
  value(field(staleDialog,"instanceName"),"Stale dialog");
  key(stableCard(),"ArrowDown");
  submit(one(staleDialog,"form"));
  await until(()=>stableErrors.some(e=>/settings changed/.test(e.message)));
  assert.notEqual(stable.settings.layout.blocks.find(b=>b.id===note.id).title,"Stale dialog");
  stable.cancel();
  stable.enter();
  value(one(stableToolbar,'[aria-label="layoutZone"]'),"full","change");
  value(one(stableToolbar,'[aria-label="layoutMode"]'),"grid","change");
  const previous=control.chrome.storage.local.get;
  control.handler=async()=>({ok:true});
  control.chrome.storage.local.get=async()=>{throw Error("refresh unavailable")};
  await stable.save();
  control.chrome.storage.local.get=previous;
  assert.equal(stable.isActive,false);
  assert.ok(stableSaved);
  assert.ok(stableErrors.some(e=>e.message==="layoutSavedRefreshFailed"));
  console.log("Layout edge cases: clean gesture, capture failure, external revision, stale dialog and committed refresh failure");
  console.log("Layout editor: palette, geometry, keyboard, pointer, cancellation, save, stale state");

  // Every widget's real settings dialog, including each config reader.
  for (const descriptor of BLOCK_DESCRIPTORS) {
    const original = createBlockInstance(descriptor.type, { id: "dialog-" + descriptor.type });
    const pending = editBlockInstance(original, i18n);
    const d = one(document, "dialog[open]");
    assert.equal(await editBlockInstance(original, i18n), null, "Duplicate dialog must be refused");
    value(field(d, "instanceName"), "Custom " + descriptor.type);
    field(d, "blockEnabled").checked = !original.enabled;
    if (["links", "startPinned"].includes(descriptor.type)) {
      button(d, "addLink").click();
      const row = [...d.querySelectorAll(".collection-row")].at(-1);
      value(one(row, '[aria-label="linkTitle"]'), "New link");
      value(one(row, '[aria-label="linkUrl"]'), "https://new.example/");
      value(one(row, '[aria-label="linkIcon"]'), "N");
      button(row, "removeLink").click();
      button(d, "addLink").click();
      const added = [...d.querySelectorAll(".collection-row")].at(-1);
      value(one(added, '[aria-label="linkTitle"]'), "New link");
      value(one(added, '[aria-label="linkUrl"]'), "https://new.example/");
    }
    if (descriptor.type === "search") {
      button(d, "addSearchProvider").click();
      const row = [...d.querySelectorAll(".collection-row")].at(-1);
      value(one(row, '[aria-label="searchProviderId"]'), "new");
      value(one(row, '[aria-label="searchProviderTitle"]'), "New");
      value(one(row, '[aria-label="searchProviderTemplate"]'), "https://new.example/?q={query}");
      value(field(d, "searchProvider"), "new", "change");
      button(row, "removeSearchProvider").click();
      assert.notEqual(field(d, "searchProvider").value, "new");
    }
    submit(one(d, "form"));
    assert.equal(d.isConnected, false, descriptor.type + " dialog validation: " + one(d, ".form-error").textContent);
    const result = await pending;
    assert.equal(result.title, "Custom " + descriptor.type);
    assert.equal(result.enabled, !original.enabled);
    assert.equal(result.config.type, descriptor.type);
    assert.notEqual(original.title, result.title);
    if (["links", "startPinned"].includes(descriptor.type)) assert.ok(result.config.items.some(i => i.url === "https://new.example/"));
  }
  const pending = editBlockInstance(createBlockInstance("timer"), i18n);
  let d = one(document, "dialog[open]");
  value(field(d, "timerSeconds"), "0");
  submit(one(d, "form"));
  assert.equal(d.isConnected, true);
  window.confirm = () => false;
  button(d, "cancel").click();
  assert.equal(d.isConnected, true);
  window.confirm = () => true;
  button(d, "close").click();
  assert.equal(await pending, null);

  // Preserve the default localization key on an unedited localized title;
  // a blank custom title intentionally returns to the default.
  for(const original of [createBlockInstance("note"),createBlockInstance("note",{title:""}),createBlockInstance("note",{title:"Custom title"})]){
    const pending=editBlockInstance(original,i18n);
    const d=one(document,"dialog[open]");
    if(original.title==="Custom title")value(field(d,"instanceName"),"   ");
    submit(one(d,"form"));
    assert.equal((await pending).title,"blockTitleNote");
  }
  const linkDialogPromise=editBlockInstance(createBlockInstance("links"),i18n);
  const linkDialog=one(document,"dialog[open]");
  const linkRow=one(linkDialog,".collection-row");
  value(one(linkRow,'[aria-label="linkUrl"]'),"ftp://example.com/");
  submit(one(linkDialog,"form"));
  assert.equal(linkDialog.isConnected,true);
  assert.match(one(linkDialog,".form-error").textContent,/validationInvalidLink/);
  window.confirm=()=>false;
  const cancelLink=new window.Event("cancel",{cancelable:true});
  linkDialog.dispatchEvent(cancelLink);
  assert.equal(cancelLink.defaultPrevented,true);
  value(one(linkRow,'[aria-label="linkUrl"]'),"https://example.com/");
  submit(one(linkDialog,"form"));
  assert.ok((await linkDialogPromise).config.items.some(i=>i.url==="https://example.com/"));
  window.confirm=()=>true;
  console.log("Block dialog: default title preservation, invalid link rejection and repair");
  console.log("Block settings: all 16 types, collections, provider removal, modal exclusivity, validation and discard");

  const theme = getTheme(settings);
  const background = host();
  for (const kind of ["solid", "gradient", "image", "effect"]) {
    const effects = kind === "effect" ? ["animated-gradient", "aurora", "mesh", "spotlight", "noise", "matrix", "cyberpunk"] : [null];
    for (const effect of effects) {
      const promise = editTheme(theme, i18n);
      d = one(document, "dialog[open]");
      value(field(d, "themeName"), "Custom " + (effect ?? kind));
      value(field(d, "backgroundTile"), kind, "change");
      if (kind === "image") value(field(d, "backgroundImageUrl"), "https://example.com/background.png");
      if (effect) {
        value(field(d, "backgroundEffect"), effect, "change");
        value(field(d, "effectIntensity"), 0.42);
        value(field(d, "backgroundEffect"), effect === "mesh" ? "aurora" : "mesh", "change");
        value(field(d, "backgroundEffect"), effect, "change");
        assert.equal(field(d, "effectIntensity").value, "0.42", "Effect draft must survive panel switches");
      }
      assert.equal(field(d, "themeHeadingScale").checkValidity(), true, "Built-in heading scale must remain valid");
      submit(one(d, "form"));
      assert.equal(d.isConnected, false, "Theme validation (" + kind + "/" + effect + "): " + one(d, ".form-error").textContent + " " + [...d.querySelectorAll(":invalid")].map(e => e.value + ": " + e.validationMessage).join("; "));
      const edited = await promise;
      assert.equal(edited.background.kind, kind);
      assert.equal(edited.builtIn, false);
      assert.equal(edited.tokens.headingScale, theme.tokens.headingScale);
      applyTheme(edited, background);
      assert.equal(background.dataset.effect, effect ?? undefined);
      assert.equal(document.documentElement.style.getPropertyValue("--accent"), edited.tokens.accent);
      if (effect) {
        assert.equal(edited.background.config.effect, effect);
        assert.equal(document.documentElement.style.getPropertyValue("--effect-intensity"), "0.42");
      }
    }
  }
  const cancelTheme = editTheme(theme, i18n);
  d = one(document, "dialog[open]");
  assert.equal(await editTheme(theme, i18n), null);
  value(field(d, "themeName"), "Discard this");
  window.confirm = () => false;
  button(d, "cancel").click();
  assert.ok(d.isConnected);
  window.confirm = () => true;
  button(d, "cancel").click();
  assert.equal(await cancelTheme, null);
  applyTheme({ ...theme, background: { kind: "solid", color: "#112233" } }, background);
  assert.equal(background.dataset.effect, undefined);
  assert.equal(document.documentElement.style.getPropertyValue("--effect-intensity"), "");
  // Round-trip every built-in and fractional values permitted by the schema.
  const { BUILT_IN_THEMES } = await import("../src/lib/start-page-defaults.js");
  for (const source of BUILT_IN_THEMES) {
    const pending=editTheme(source,i18n);
    const d=one(document,"dialog[open]");
    assert.equal(one(d,"form").checkValidity(),true,source.name);
    submit(one(d,"form"));
    const saved=await pending;
    assert.equal(saved.name,source.name);
    assert.deepEqual(saved.background,source.background);
    assert.deepEqual(saved.tokens,source.tokens);
  }
  for(const config of [
    {effect:"animated-gradient",speed:1.037,intensity:0.423,angle:125.4,colors:["#111827","#312e81"]},
    {effect:"aurora",speed:1.037,intensity:0.423,blur:72.4},
    {effect:"mesh",speed:1.037,intensity:0.423,scale:1.234},
    {effect:"spotlight",speed:1.037,intensity:0.423,size:62.4},
    {effect:"noise",speed:1.037,intensity:0.423,animated:true},
    {effect:"matrix",speed:1.037,intensity:0.423,density:0.554},
    {effect:"cyberpunk",speed:1.037,intensity:0.423,scanlines:false},
  ]){
    const source={...theme,background:{kind:"effect",baseColor:"#08111f",config},tokens:{...theme.tokens,cardOpacity:0.823,baseFontSize:16.4,borderRadius:18.4,spacing:16.4}};
    const pending=editTheme(source,i18n);
    const d=one(document,"dialog[open]");
    assert.equal(one(d,"form").checkValidity(),true,config.effect);
    submit(one(d,"form"));
    const saved=await pending;
    assert.deepEqual(saved.background,source.background);
    assert.deepEqual(saved.tokens,source.tokens);
  }
  const invalidTheme=editTheme(theme,i18n);
  const invalidDialog=one(document,"dialog[open]");
  value(field(invalidDialog,"backgroundTile"),"image","change");
  value(field(invalidDialog,"backgroundImageUrl"),"ftp://example.com/image.png");
  submit(one(invalidDialog,"form"));
  assert.equal(one(invalidDialog,".form-error").hidden,false);
  assert.match(one(invalidDialog,".form-error").textContent,/validationInvalidUrl/);
  const escape=new window.Event("cancel",{cancelable:true});
  window.confirm=()=>false;invalidDialog.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented,true);
  window.confirm=()=>true;button(invalidDialog,"cancel").click();
  assert.equal(await invalidTheme,null);

  const existingImage={...theme,background:{kind:"image",url:"https://example.com/existing.png",fit:"contain",position:"left top"}};
  const imageEdit=editTheme(existingImage,i18n);
  const imageDialog=one(document,"dialog[open]");
  assert.equal(field(imageDialog,"backgroundImageUrl").value,existingImage.background.url);
  assert.equal(field(imageDialog,"backgroundImageFit").value,"contain");
  value(field(imageDialog,"themeHeadingScale"),"5");
  submit(one(imageDialog,"form"));
  assert.equal(imageDialog.isConnected,true);
  value(field(imageDialog,"themeHeadingScale"),existingImage.tokens.headingScale);
  submit(one(imageDialog,"form"));
  assert.deepEqual((await imageEdit).background,existingImage.background);

  // A free-form layout needs the same editing protections as grid mode.
  const freeSettings=cloneSettings(settings);
  freeSettings.layout.mode="free";
  freeSettings.layout.blocks=[createBlockInstance("note",{id:"free-note"}),createBlockInstance("timer",{id:"free-timer",enabled:false})];
  const freeRuntime=normalizeRuntimeState(undefined,freeSettings);
  const freeToolbar=host(),freePalette=host(),freeGrid=host();
  const freeEditor=new LayoutEditor(freeSettings,{i18n,toolbarHost:freeToolbar,paletteHost:freePalette,getRuntime:()=>freeRuntime,
    requestRender:()=>{},previewBlock:()=>{},onSaved:()=>{},onError:e=>errors.push(e)});
  const freeCard=id=>{
    freeGrid.replaceChildren();
    const card=document.createElement("article");freeGrid.append(card);
    freeGrid.getBoundingClientRect=()=>({width:1200});
    freeEditor.decorateCard(card,freeEditor.settings.layout.blocks.find(b=>b.id===id));
    return card;
  };
  freeEditor.enter();
  const freeNote=()=>freeEditor.settings.layout.blocks.find(b=>b.id==="free-note");
  const originalFree={...freeNote().free};
  key(freeCard("free-note"),"ArrowLeft");key(freeCard("free-note"),"ArrowUp");
  assert.equal(freeNote().free.x,Math.max(0,originalFree.x-10));
  assert.equal(freeNote().free.y,Math.max(0,originalFree.y-10));
  const oldCount=freeEditor.settings.layout.blocks.length;
  [...freePalette.querySelectorAll("button")].find(b=>b.textContent.includes("blockTitleNote")).click();
  assert.equal(freeEditor.settings.layout.blocks.length,oldCount+1);
  button(freeCard("free-note"),"duplicateBlock").click();
  assert.equal(freeEditor.settings.layout.blocks.length,oldCount+2);
  button(freeCard("free-timer"),"enableBlock").click();
  assert.equal(freeEditor.settings.layout.blocks.find(b=>b.id==="free-timer").enabled,true);
  button(freeCard("free-note"),"editBlock").click();
  button(one(document,"dialog[open]"),"cancel").click();
  await Promise.resolve();
  assert.equal(freeNote().title,freeSettings.layout.blocks[0].title);
  const preDelete=freeEditor.settings.layout.blocks.length;
  window.confirm=()=>false;
  button(freeCard("free-timer"),"deleteBlock").click();
  assert.equal(freeEditor.settings.layout.blocks.length,preDelete);
  window.confirm=()=>true;
  button(freeCard("free-timer"),"deleteBlock").click();
  assert.equal(freeEditor.settings.layout.blocks.length,preDelete-1);
  const captured=freeCard("free-note");
  captured.releasePointerCapture=()=>{throw Error("browser already released pointer")};
  pointer(one(captured,".card__drag-handle"),"pointerdown",0,0);
  pointer(captured,"pointerup",20,20);
  assert.equal(freeEditor.isPointerActive,false);
  freeEditor.cancel();
  assert.deepEqual(freeEditor.settings,freeSettings);
  const limit=(await import("../src/lib/platform-limits.js")).MAX_START_PAGE_BLOCKS;
  const saturated={...freeSettings,layout:{...freeSettings.layout,blocks:Array.from({length:limit},(_,i)=>createBlockInstance("note",{id:"cap-"+i}))}};
  const limitToolbar=host(),limitPalette=host(),limitEditor=new LayoutEditor(saturated,{i18n,toolbarHost:limitToolbar,paletteHost:limitPalette,getRuntime:()=>freeRuntime,requestRender:()=>{},previewBlock:()=>{},onSaved:()=>{},onError:e=>errors.push(e)});
  limitEditor.enter();
  assert.ok([...limitPalette.querySelectorAll("button")].every(b=>b.disabled));
  const limitCard=host();limitEditor.decorateCard(limitCard,saturated.layout.blocks[0]);
  assert.ok([...limitCard.querySelectorAll("button")].some(b=>b.disabled&&b.title.startsWith("blockCapacityReached")));
  limitEditor.cancel();
  console.log("Layout editor: free-mode add/duplicate, no-data delete confirmation, pointer release failure and capacity");

  // A saved layout may change while old cards are still mounted. Every old
  // card action must be harmless when the target no longer exists.
  {
    const s=cloneSettings(settings);
    const staleToolbar=host(),stalePalette=host(),staleGrid=host();
    const staleEditor=new LayoutEditor(s,{i18n,toolbarHost:staleToolbar,paletteHost:stalePalette,getRuntime:()=>runtime,requestRender:()=>{},previewBlock:()=>{},onSaved:()=>{},onError:e=>errors.push(e)});
    staleEditor.enter();
    const oldCard=document.createElement("article");
    staleGrid.append(oldCard);staleEditor.decorateCard(oldCard,s.layout.blocks[0]);
    const latest=cloneSettings(s);latest.updatedAt=s.updatedAt+1;
    latest.layout.blocks=latest.layout.blocks.filter(b=>b.id!==note.id);
    staleEditor.replaceSavedSettings(latest);
    const before=cloneSettings(staleEditor.settings);
    let confirms=0;const oldConfirm=window.confirm;window.confirm=()=>{confirms++;return true};
    try{
      for(const action of ["editBlock","disableBlock","duplicateBlock","deleteBlock"])button(oldCard,action).click();
      key(oldCard,"ArrowRight");
      pointer(one(oldCard,".card__drag-handle"),"pointerdown",10,10);
      await Promise.resolve();
      assert.equal(staleEditor.isPointerActive,false);
      assert.equal(document.querySelector("dialog[open]"),null);
      assert.equal(confirms,0);
      assert.deepEqual(staleEditor.settings,before);
      assert.equal(staleEditor.hasUnsavedChanges,false);
    }finally{window.confirm=oldConfirm;staleEditor.cancel()}
  }
  // Saving is a single in-flight transaction; stale controls cannot start
  // another save, change geometry, or abandon the draft during the request.
  {
    const s=cloneSettings(settings), t=host(), p=host(), g=host();
    const ed=new LayoutEditor(s,{i18n,toolbarHost:t,paletteHost:p,getRuntime:()=>runtime,requestRender:()=>{},previewBlock:()=>{},onSaved:()=>{},onError:e=>errors.push(e)});
    ed.enter();const c=document.createElement("article");g.append(c);ed.decorateCard(c,s.layout.blocks[0]);
    let finish;const previousHandler=control.handler;
    control.handler=m=>new Promise(resolve=>{finish=()=>resolve({ok:true,savedSettings:{...m.settings,updatedAt:999}})});
    try{
      const saving=ed.save();await until(()=>finish);
      const before=cloneSettings(ed.settings),n=control.messages.length;
      await ed.save();ed.cancel();ed.enter();
      button(c,"editBlock").click();button(c,"disableBlock").click();
      key(c,"ArrowDown");
      pointer(one(c,".card__drag-handle"),"pointerdown",10,10);
      assert.equal(control.messages.length,n);assert.equal(ed.isPointerActive,false);
      assert.equal(document.querySelector("dialog[open]"),null);assert.deepEqual(ed.settings,before);
      finish();await saving;
      assert.equal(ed.isActive,false);
      assert.equal(ed.settings.updatedAt,999);
    }finally{control.handler=previousHandler}
  }
  // Generated collection item IDs remain available in browsers without
  // crypto.randomUUID, and edits preserve the IDs on subsequent saves.
  {
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,"crypto");
    try{
      Object.defineProperty(globalThis,"crypto",{configurable:true,value:undefined});
      const editing=editBlockInstance(createBlockInstance("links"),i18n);
      const dialog=one(document,"dialog[open]");
      button(dialog,"addLink").click();
      const row=[...dialog.querySelectorAll(".collection-row")].at(-1);
      value(one(row,'[aria-label="linkTitle"]'),"Fallback link");
      value(one(row,'[aria-label="linkUrl"]'),"https://fallback.example/");
      submit(one(dialog,"form"));
      const item=(await editing).config.items.find(i=>i.title==="Fallback link");
      assert.match(item.id,/^link-/);
      assert.equal(item.url,"https://fallback.example/");
    }finally{Object.defineProperty(globalThis,"crypto",descriptor)}
  }

  // Switch from a non-effect theme to an effect, then round-trip a custom
  // aurora with non-default values; an empty name cannot be saved.
  {
    const solid={...theme,background:{kind:"solid",color:"#123456"}};
    let promise=editTheme(solid,i18n);
    let dialog=one(document,"dialog[open]");
    value(field(dialog,"backgroundTile"),"effect","change");
    assert.equal(field(dialog,"backgroundEffect").value,"aurora");
    assert.equal(field(dialog,"effectBlur").value,"72");
    value(field(dialog,"effectBlur"),43);
    value(field(dialog,"effectSpeed"),2.25);
    submit(one(dialog,"form"));
    const custom=await promise;
    assert.deepEqual(custom.background.config,{effect:"aurora",speed:2.25,intensity:0.65,blur:43});
    promise=editTheme(custom,i18n);dialog=one(document,"dialog[open]");
    assert.equal(field(dialog,"effectBlur").value,"43");
    assert.equal(field(dialog,"effectSpeed").value,"2.25");
    value(field(dialog,"themeName")," ");
    submit(one(dialog,"form"));
    assert.equal((await promise).name,custom.name);
    // A malformed draft with no valid fallback name requires repair.
    promise=editTheme({...custom,name:""},i18n);dialog=one(document,"dialog[open]");
    submit(one(dialog,"form"));
    assert.equal(dialog.isConnected,true);
    assert.equal(one(dialog,".form-error").hidden,false);
    value(field(dialog,"themeName"),"Restored aurora");
    submit(one(dialog,"form"));
    assert.equal((await promise).name,"Restored aurora");
  }
  // Configuring a free-mode block must retain free geometry rather than
  // attempting grid placement or silently dropping its custom title.
  {
    const s=cloneSettings(settings);s.layout.mode="free";
    const t=host(),p=host(),g=host();
    const ed=new LayoutEditor(s,{i18n,toolbarHost:t,paletteHost:p,getRuntime:()=>runtime,requestRender:()=>{},previewBlock:()=>{},onSaved:()=>{},onError:e=>errors.push(e)});
    ed.enter();
    const card=document.createElement("article");g.append(card);ed.decorateCard(card,s.layout.blocks[0]);
    const original=structuredClone(s.layout.blocks[0].free);
    button(card,"editBlock").click();
    const dialog=one(document,"dialog[open]");
    value(field(dialog,"instanceName"),"Free configured note");submit(one(dialog,"form"));
    await until(()=>ed.settings.layout.blocks[0].title==="Free configured note");
    assert.deepEqual(ed.settings.layout.blocks[0].free,original);
    assert.equal(ed.settings.layout.mode,"free");
    ed.cancel();
  }

  // A grid-mode configuration must resolve collisions against the current
  // draft rather than replacing a block with stale free-mode coordinates.
  {
    const s=cloneSettings(settings);s.layout.mode="grid";
    s.layout.blocks=[createBlockInstance("note",{id:"grid-config",column:1,row:1,width:2,height:2}),createBlockInstance("timer",{id:"grid-neighbor",column:3,row:1,width:2,height:2})];
    const t=host(),p=host(),g=host();
    const ed=new LayoutEditor(s,{i18n,toolbarHost:t,paletteHost:p,getRuntime:()=>runtime,requestRender:()=>{},previewBlock:()=>{},onSaved:()=>{},onError:e=>errors.push(e)});
    ed.enter();
    const card=document.createElement("article");g.append(card);ed.decorateCard(card,s.layout.blocks[0]);
    button(card,"editBlock").click();
    const dialog=one(document,"dialog[open]");
    value(field(dialog,"instanceName"),"Grid configured note");submit(one(dialog,"form"));
    await until(()=>ed.settings.layout.blocks[0].title==="Grid configured note");
    assert.equal(ed.settings.layout.blocks.length,2);
    assert.equal(ed.settings.layout.mode,"grid");
    assert.equal(ed.settings.layout.blocks[0].id,"grid-config");
    assert.deepEqual(ed.settings.layout.blocks[1],s.layout.blocks[1]);
    ed.cancel();
  }
  console.log("Theme editor: 4 background kinds, 7 effects, panel preservation, DOM CSS application, cancel");
} finally { dom.window.close(); }
