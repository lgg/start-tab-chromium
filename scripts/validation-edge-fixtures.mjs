import assert from "node:assert/strict";
import { installChrome } from "./ui-fixture-dom.mjs";
import { isMessage, sendMessage } from "../src/lib/messages.js";
import { createDefaultStartPageSettings } from "../src/lib/start-page-settings.js";
import { defaultBlockConfig, BLOCK_DESCRIPTORS, BUILT_IN_THEMES } from "../src/lib/start-page-defaults.js";
import { normalizeBlockConfig } from "../src/lib/start-page-block-validation.js";
import { normalizeTheme, normalizeThemeBundle, themeBundle } from "../src/lib/start-page-theme-validation.js";
import * as v from "../src/lib/start-page-validation-primitives.js";
import * as limits from "../src/lib/platform-limits.js";

const control = installChrome();
const settings = createDefaultStartPageSettings(100);
let checks = 0;
function same(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
function check(actual, label) { assert.ok(actual, label); checks++; }
function invalidField(message, field, values) {
  for (const value of values) same(isMessage({ ...message, [field]: value }), false, message.type + "." + field + ": " + String(value));
}
const revisionValues = [undefined, null, "1", NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1];
const invalidId = [undefined, null, 0, "", "x".repeat(257)];
for (const message of [null, undefined, false, [], {}, { type: 0 }, { type: "unknown" }]) same(isMessage(message), false);
for (const type of ["block","unblock","blocked-original-url","record-unblock"]) {
  same(isMessage({type,host:"example.com"}),true);
  invalidField({type,host:"example.com"},"host",[undefined, null, 1, "x".repeat(2049)]);
}
for (const type of ["clear", "replace-blocked-sites"]) {
  const key = type === "clear" ? "expectedSites" : "sites";
  const m = { type, [key]: ["example.com"] };
  same(isMessage(m), true);
  invalidField(m, key, [undefined, {}, "x", [1], ["x".repeat(2049)], Array(limits.MAX_BLOCKED_SITES + 1).fill("example.com")]);
  same(isMessage({type,[key]:[]}),true);
}
same(isMessage({type:"clear",expectedSites:[""]}), false);
for (const type of ["open-native-new-tab","reset-start-page","reset-clocks","reset-stats"]) same(isMessage({type}), true);
const replace = { type:"replace-start-page-settings", settings, expectedSettingsUpdatedAt:0,expectedRuntimeUpdatedAt:0 };
same(isMessage(replace), true);
for (const key of ["expectedSettingsUpdatedAt","expectedRuntimeUpdatedAt"]) invalidField(replace,key,revisionValues);
for (const value of [null, {}, {layout:null}, {layout:{blocks:[]}}, {layout:{blocks:[]},themes:{customThemes:null}}, {...settings, layout:{...settings.layout,blocks:Array(limits.MAX_START_PAGE_BLOCKS+1).fill({})}}, {...settings,themes:{...settings.themes,customThemes:Array(limits.MAX_CUSTOM_THEMES+1).fill({})}}]) same(isMessage({...replace,settings:value}),false);
for (const expected of ["en","ru","auto"]) for (const preference of ["en","ru","auto"]) same(isMessage({...replace,localeChange:{expected,preference}}),true);
invalidField(replace,"localeChange",[null, "en", {}, {expected:"en",preference:"bad"}, {expected:"bad",preference:"en"}]);
same(isMessage({...replace,completeOnboarding:true}),true);
invalidField(replace,"completeOnboarding",[false,1,null]);
const clock = {type:"clock-action",instanceId:"timer",action:"start"};
for (const action of ["toggle","start","pause","reset"]) same(isMessage({...clock,action}),true);
invalidField(clock,"instanceId",invalidId); invalidField(clock,"action",[undefined,"bad",1]);
const complete = {type:"complete-clock",instanceId:"timer",token:"t"};
same(isMessage(complete),true); invalidField(complete,"instanceId",invalidId); invalidField(complete,"token",invalidId);
const note = {type:"runtime-note",instanceId:"note",value:"",expectedValue:""};
same(isMessage(note),true); invalidField(note,"instanceId",invalidId);
for (const key of ["value","expectedValue"]) invalidField(note,key,[undefined,null,1,"x".repeat(limits.MAX_NOTE_LENGTH+1)]);
const item = {id:"a",title:"task",done:false,createdAt:0,updatedAt:0};
const tasks = {type:"runtime-tasks",instanceId:"tasks",tasks:[item],expectedTasks:[item]};
same(isMessage(tasks),true); invalidField(tasks,"instanceId",invalidId);
for (const key of ["tasks","expectedTasks"]) {
  invalidField(tasks,key,[undefined,null,{},[null],Array(limits.MAX_LOCAL_TASKS_PER_INSTANCE+1).fill(item)]);
  for (const [field,values] of Object.entries({id:invalidId,title:[null,1,"x".repeat(limits.MAX_LOCAL_TASK_TITLE_LENGTH+1)],done:[null,1,"false"],createdAt:[null,NaN,Infinity,"1"],updatedAt:[null,NaN,Infinity,"1"]})) {
    for (const value of values) same(isMessage({...tasks,[key]:[{...item,[field]:value}]}),false,key+"."+field);
  }
}
const page = {type:"runtime-link-page",instanceId:"links",page:10000,expectedPage:0};
same(isMessage(page),true); invalidField(page,"instanceId",invalidId);
for (const key of ["page","expectedPage"]) invalidField(page,key,[undefined,null,NaN,1.5,-1,10001,"1"]);
const del = {type:"delete-instance-runtime",instanceId:"note",expectedBlockUpdatedAt:0,expectedRuntimeUpdatedAt:0};
same(isMessage(del),true); invalidField(del,"instanceId",invalidId);
for (const key of ["expectedBlockUpdatedAt","expectedRuntimeUpdatedAt"]) invalidField(del,key,revisionValues);
control.handler=async()=>undefined;
await assert.rejects(sendMessage({type:"reset-stats"}),/did not acknowledge/);
control.handler=async()=>({ok:false,error:"test refusal"});
await assert.rejects(sendMessage({type:"reset-stats"}),/test refusal/);
control.handler=async()=>({ok:true,changed:false});
same(await sendMessage({type:"reset-stats"}),{ok:true,changed:false});

for(const {type} of BLOCK_DESCRIPTORS) {
  const fallback=defaultBlockConfig(type);
  same(normalizeBlockConfig(type,undefined),fallback,type+" defaults");
  same(normalizeBlockConfig(type,fallback),fallback,type+" round trip");
  same(normalizeBlockConfig(type,[],{[type]:fallback}),fallback,type+" legacy root");
}
let issues=[];
same(normalizeBlockConfig("ip",{endpoint:"javascript:bad()"},{},"config",issues).endpoint,defaultBlockConfig("ip").endpoint);
same(issues[0].messageKey,"validationInvalidUrl");
issues=[];
const weather=normalizeBlockConfig("weather",{latitude:100,longitude:-200,displayMode:"bad",forecastEndpoint:"file:///tmp/x",geocodingEndpoint:"bad"},{},"config",issues);
same(weather.latitude,90);same(weather.longitude,-180);same(weather.displayMode,defaultBlockConfig("weather").displayMode);same(issues.length,2);
same(normalizeBlockConfig("timer",null,{timers:{timerSeconds:20,notifyOnComplete:false}}).durationSeconds,20);
same(normalizeBlockConfig("timer",{durationSeconds:0}).durationSeconds,1);
same(normalizeBlockConfig("pomodoro",null,{timers:{pomodoroWorkSeconds:1,pomodoroBreakSeconds:90000}}).workSeconds,60);
same(normalizeBlockConfig("pomodoro",{breakSeconds:90000}).breakSeconds,43200);
same(normalizeBlockConfig("dateTime",{fontSize:200}).timeFontSize,160);
same(normalizeBlockConfig("googleCalendar",{calendarId:" ",maxResults:999}).calendarId,"primary");
same(normalizeBlockConfig("googleCalendar",{maxResults:999}).maxResults,25);
same(normalizeBlockConfig("recent",{maxResults:0}).maxResults,1);
for(const type of ["links","startPinned"]) {
  issues=[];
  const out=normalizeBlockConfig(type,{columns:0,rows:99,pageDirection:"vertical",fontSize:-1,iconSize:999,items:[null,{title:"",url:"https://example.com"},{title:"Bad",url:"javascript:bad()"},{title:" Test ",url:"https://example.com"}]},{},"config",issues);
  same(out.columns,1);same(out.rows,12);same(out.fontSize,8);same(out.iconSize,128);same(out.pageDirection,"vertical");same(out.items.length,1);same(out.items[0].title,"Test");same(out.items[0].icon,"TE");same(issues.length,3);
}
issues=[];
const search=normalizeBlockConfig("search",{provider:"missing",providers:[null,{id:"",title:"blank",urlTemplate:"https://example.com?q={query}"},{id:"x",title:"X",urlTemplate:"bad"},{id:"y",title:"Y",urlTemplate:"https://example.com?q={query}"},{id:"y",title:"duplicate",urlTemplate:"https://example.com?q={query}"}]},{},"config",issues);
same(search.provider,"y");same(search.providers.length,1);same(issues.length,4);
same(normalizeBlockConfig("search",{providers:[]}).providers,defaultBlockConfig("search").providers);
// Malformed but JSON-compatible provider titles must not crash the whole
// settings/backup normalization, even when the explicit ID is valid.
{
  const providers = JSON.parse('[{"id":"explicit","title":{"toString":null,"valueOf":null},"urlTemplate":"https://example.com/?q={query}"},{"title":{"toString":null,"valueOf":null},"urlTemplate":"https://second.example/?q={query}"},{"id":"valid","title":"Valid","urlTemplate":"https://third.example/?q={query}"}]');
  const input = {provider:"valid",providers};
  const result = normalizeBlockConfig("search",input);
  same(result.provider,"valid");
  same(result.providers.length,3);
  same(result.providers[0].title,"explicit");
  same(result.providers[1].title,result.providers[1].id);
  same(result.providers[2].title,"Valid");
  same(normalizeBlockConfig("search",result),result);
  same(normalizeBlockConfig("search",input),result);
}

same(v.safeWebUrl(" "),null);same(v.safeWebUrl("https://example.com"),"https://example.com");same(v.safeWebUrl("ftp://example.com"),null);
same(v.safeWebUrlTemplate("https://example.com"),null);
same(v.buildSearchUrl("https://example.com/?q={query}","a & b"),"https://example.com/?q=a%20%26%20b");
same(v.buildSearchUrl("https://{query}.example/","a b"),null);
same(v.safeGradient(" conic-gradient(red, blue) ","fallback"),"conic-gradient(red, blue)");
same(v.safeCssToken("<bad>","fallback"),"fallback");same(v.safeCssToken(" ","fallback"),"fallback");
same(v.normalizeEntityId(" ","fallback"),"fallback");
same(v.uniqueEntityId("x",new Set(["x","x-2"]),new Set(["x-3"])),"x-4");
same(v.normalizeTimeZone("UTC","", "tz", []),"UTC");
issues=[];same(v.normalizeTimeZone("Invalid/Zone","UTC","tz",issues),"UTC");same(issues.length,1);
same(v.normalizeTimeZone("","UTC","tz",[]),"");
same({...v.normalizeDomainMinutes({" Example.COM ":60,"":1,foo:NaN,bar:"1",a:-1,b:9999})},{"example.com":60,a:0,b:1440});
const fallback=BUILT_IN_THEMES[0];
const solid=normalizeTheme({background:{kind:"solid",color:"#123456"}},fallback);
const gradient=normalizeTheme({background:{kind:"gradient",css:"linear-gradient(red, blue)"}},solid);
same(gradient.background.kind,"gradient");
const image=normalizeTheme({background:{kind:"image",url:"https://example.com/a.png",fit:"contain",position:"top"}},gradient);
same(image.background.kind,"image");same(image.background.fit,"contain");
issues=[];same(normalizeTheme({background:{kind:"image",url:"invalid"}},image,"theme",issues).background.url,image.background.url);same(issues.length,1);
for(const effect of ["animated-gradient","aurora","mesh","spotlight","noise","matrix","cyberpunk"]) {
  const first=normalizeTheme({background:{kind:"effect",config:{effect}}},solid);
  const again=normalizeTheme({background:{kind:"effect",config:{effect}}},first);
  same(again.background,first.background,effect+" retains default config");
  const bad=normalizeTheme({background:{kind:"effect",config:{effect,speed:-100,intensity:-1,colors:[null,"#fff"],angle:500,blur:500,scale:100,size:999,density:0,animated:"bad",scanlines:"bad"}}},first);
  same(bad.background.config.effect,effect);same(bad.background.config.intensity,0);same(bad.background.config.speed,0.05);
  if(effect==="animated-gradient") same(bad.background.config.colors,first.background.config.colors);
}
same(normalizeThemeBundle(themeBundle(image)).issues.length,0);
check(normalizeThemeBundle(null).issues.some(x=>x.messageKey==="validationInvalidThemeFile"));

 // An envelope alone is not a theme. Failed imports must not create a
 // fallback theme, select it, or touch any stored settings/revision.
{
  const {importCustomTheme}=await import("../src/lib/start-page-settings.js");
  const before=structuredClone(control.state);
  for(const theme of [undefined,null,false,0,"theme",[],{}, {...image,schemaVersion:999}]){
    const envelope={app:"Start Tab Theme",version:1,theme};
    check(normalizeThemeBundle(envelope).issues.some(x=>x.messageKey==="validationInvalidThemeFile"));
    await assert.rejects(importCustomTheme(envelope),/Invalid Start Tab theme file/);
    same(control.state,before);
  }
  const exported=themeBundle(image);
  same(normalizeThemeBundle(exported).value.theme,exported.theme);
}


 // Destructive layout changes must protect actual data, not merely block type.
{
  const api=await import("../src/lib/start-page-settings.js");
  const rt=await import("../src/lib/start-page-runtime.js");
  const clock=api.createBlockInstance("timer",{id:"validation-clock"});
  const link=api.createBlockInstance("links",{id:"validation-link",config:{...defaultBlockConfig("links"),items:[{id:"link",title:"Example",url:"https://example.com/",icon:"EX"}]}});
  const emptyLink={...link,config:{...link.config,items:[]}};
  const pinned=api.createBlockInstance("startPinned",{id:"validation-pinned",config:{...defaultBlockConfig("startPinned"),items:link.config.items}});
  const blockSettings={...settings,layout:{...settings.layout,blocks:[clock,link,pinned]}};
  const runtime=rt.normalizeRuntimeState(undefined,blockSettings);
  same(api.blockDeletionRequiresDataConfirmation(emptyLink,runtime),false);
  same(api.blockDeletionRequiresDataConfirmation(link,runtime),true);
  same(api.blockDeletionRequiresDataConfirmation(pinned,runtime),true);
  same(api.blockDeletionRequiresDataConfirmation(clock,runtime),false);
  runtime.clocks[clock.id]=rt.startClockState(rt.defaultClockForBlock(clock),100);
  same(api.blockDeletionRequiresDataConfirmation(clock,runtime),true);
  same(api.layoutReplacementRemovesUserData(blockSettings,{...blockSettings,layout:{...blockSettings.layout,blocks:[link,pinned]}},runtime),true);
  runtime.clocks[clock.id]=rt.pauseClockState(runtime.clocks[clock.id],200);
  same(api.blockDeletionRequiresDataConfirmation(clock,runtime),true);
  delete runtime.clocks[clock.id];
  same(api.blockDeletionRequiresDataConfirmation(clock,runtime),false);
  same(api.layoutReplacementRemovesUserData(blockSettings,blockSettings,runtime),false);
  const tasks=api.createBlockInstance("localTasks",{id:"validation-tasks",config:{...defaultBlockConfig("localTasks"),confirmDeleteWithContent:false}});
  runtime.tasks[tasks.id]=[{id:"task",title:"Preserve me",done:false,createdAt:1,updatedAt:1}];
  same(api.blockDeletionRequiresDataConfirmation(tasks,runtime),false);
  same(api.layoutReplacementRemovesUserData({...blockSettings,layout:{...blockSettings.layout,blocks:[tasks]}},{...blockSettings,layout:{...blockSettings.layout,blocks:[]}},runtime),true);
}
 // Preserve the currently selected valid theme and legacy identifiers.
{
  const themeApi=await import("../src/lib/start-page-theme-validation.js");
  const {normalizeStartPageSettingsWithReport}=await import("../src/lib/start-page-settings-validation.js");
  const base=BUILT_IN_THEMES[0];
  const effect=normalizeTheme({background:{kind:"effect",config:{effect:"aurora",speed:2,intensity:0.5,blur:44}}},base);
  same(normalizeTheme({background:{kind:"effect",config:null}},effect).background,effect.background);
  same(normalizeTheme({name:"  "},base).name,base.name);
  const custom=normalizeTheme({...base,id:"validation-custom",builtIn:false,name:"Custom"},base);
  same(themeApi.normalizeCustomThemes([custom],[])[0].id,custom.id);
  same(normalizeStartPageSettingsWithReport({...settings,themes:{selectedThemeId:custom.id,customThemes:[custom]}}).settings.themes.selectedThemeId,custom.id);
  same(normalizeStartPageSettingsWithReport({...settings,themes:{selectedThemeId:"missing-custom",customThemes:[custom]}}).settings.themes.selectedThemeId,settings.themes.selectedThemeId);
  const legacyId="a".repeat(160)+"-99";
  same(v.normalizeEntityId(legacyId,"fallback"),legacyId);
  same(v.normalizeEntityId("a".repeat(170),"fallback"),"a".repeat(160));
  const used=new Set(["unique","unique-2"]);
  const reserved=new Set(["unique-3"]);
  same(v.uniqueEntityId("unique",used,reserved),"unique-4");
  same(v.uniqueEntityId("available",used,reserved),"available");
}

 // Effect switches from an unrelated fallback must use the target effect's
 // defaults and preserve valid supplied colors; a malformed palette must
 // not inherit colors from another effect.
{
  const base=normalizeTheme({background:{kind:"effect",config:{effect:"aurora",speed:3,intensity:0.4,blur:45}}},BUILT_IN_THEMES[0]);
  const gradient=normalizeTheme({background:{kind:"effect",config:{effect:"animated-gradient",colors:["#abc","<bad>","#def",null],angle:180}}},base);
  same(gradient.background.config,{effect:"animated-gradient",speed:1,intensity:0.8,angle:180,colors:["#abc","#111827","#def"]});
  const noPalette=normalizeTheme({background:{kind:"effect",config:{effect:"animated-gradient",colors:[]}}},base);
  same(noPalette.background.config.colors,["#111827","#312e81","#0f766e","#111827"]);
  const kept=normalizeTheme({background:{kind:"effect",config:{effect:"animated-gradient",colors:[]}}},gradient);
  same(kept.background.config.colors,gradient.background.config.colors);
  const image=normalizeTheme({background:{kind:"image",url:"https://example.com/a.png"}},base);
  const invalid=[];
  same(normalizeTheme({background:{kind:"image",url:"javascript:bad()"}},image,"theme",invalid).background.url,image.background.url);
  same(invalid[0].messageKey,"validationInvalidUrl");
  const api=await import("../src/lib/start-page-settings.js");
  const rt=await import("../src/lib/start-page-runtime.js");
  const task=api.createBlockInstance("localTasks",{id:"missing-runtime-task"});
  const initial={...settings,layout:{...settings.layout,blocks:[task]}};
  const empty={...initial,layout:{...initial.layout,blocks:[]}};
  const runtime=rt.normalizeRuntimeState(undefined,initial);
  delete runtime.tasks[task.id];
  same(api.blockDeletionRequiresDataConfirmation(task,runtime),false);
  // No runtime entry does not exempt a customized block from the preset
  // replacement confirmation.
  same(api.layoutReplacementRemovesUserData({...initial,layout:{...initial.layout,blocks:[{...task,title:"My tasks"}]}},empty,runtime),true);
}

 // Public validation must normalize malformed persisted collection shapes
 // without accepting their entries as capacity violations.
{
  const api=await import("../src/lib/start-page-settings.js");
  const base=api.createDefaultStartPageSettings(100);
  for(const malformed of [null,[],{layout:null,themes:null},{layout:[],themes:[]}]) {
    const prepared=api.prepareStartPageSettingsWrite(malformed,base,base.updatedAt);
    check(prepared.settings.layout.blocks.length>0);
    check(prepared.settings.updatedAt>base.updatedAt);
    check(Array.isArray(prepared.settings.themes.customThemes));
  }
  const custom={...base,layout:{...base.layout,blocks:[structuredClone(base.layout.blocks.find(block=>block.type==="note"))]}};
  const empty={...custom,layout:{...custom.layout,blocks:[]}};
  const runtime=(await import("../src/lib/start-page-runtime.js")).normalizeRuntimeState(undefined,custom);
  // An explicitly customized block remains protected even when its runtime
  // has no data; a default untouched block may be removed without warning.
  same(api.layoutReplacementRemovesUserData(custom,empty,runtime),false);
  custom.layout.blocks[0].title="My custom note";
  same(api.layoutReplacementRemovesUserData(custom,empty,runtime),true);
  same(v.buildSearchUrl("https://example.com/?q={query}","\ud800"),"https://example.com/?q=%EF%BF%BD");
}

 // Switching back to aurora from a different effect must not inherit its
 // incompatible speed/intensity/blur, and malformed CSS stays at fallback.
{
  const base=normalizeTheme({background:{kind:"effect",config:{effect:"matrix",speed:3,intensity:0.2,density:0.9}}},BUILT_IN_THEMES[0]);
  const aurora=normalizeTheme({background:{kind:"effect",config:{effect:"aurora"}}},base);
  same(aurora.background.config,{effect:"aurora",speed:1,intensity:0.65,blur:72});
  same(v.safeGradient("url(javascript:bad())","linear-gradient(red, blue)"),"linear-gradient(red, blue)");
  same(v.safeGradient("   ","radial-gradient(red, blue)"),"radial-gradient(red, blue)");
  const pinned={items:[{id:"legacy-link",title:"Legacy",url:"https://example.com/",icon:"L"}]};
  same(v.legacyConfigSource("startPinned",{startPinned:pinned}),pinned);
}

{
  const {canonicalJsonValue,jsonContentEqual}=await import("../src/lib/json-content.js");
  const original={"я":2,"a":{z:4,A:1},"__proto__":null,"😀":5,"10":10,"2":2};
  const reinserted=Object.fromEntries(Object.entries(original).reverse());
  check(jsonContentEqual(original,reinserted),"canonical key order including Unicode and integer keys");
  same(canonicalJsonValue(reinserted),canonicalJsonValue(original));
  check(!jsonContentEqual([original,reinserted],[{...original,"я":3},reinserted]));
}
{
  // Large collision sets must terminate at the first free bounded ID, not
  // reuse a later explicitly reserved suffix or discard the base prefix.
  const base="x".repeat(160);
  const used=new Set([base]),reserved=new Set();
  for(let i=2;i<=2000;i++){
    const ending="-"+i;
    (i%2?used:reserved).add(base.slice(0,160-ending.length)+ending);
  }
  const candidate=v.uniqueEntityId(base,used,reserved);
  same(candidate,base.slice(0,155)+"-2001");
  same(candidate.length,160);
  check(!used.has(candidate)&&!reserved.has(candidate));
}
console.log("Validation matrix:",checks,"assertions — message boundaries, all widget configs, URL sanitization, legacy and theme fallback branches");



// Legacy aliases and modern explicit values must normalize independently.
// A valid old timer field must not override a modern zero (which is clamped).
{
  const legacy = {timers:{pomodoroWorkSeconds:1200,pomodoroBreakSeconds:180}};
  same(normalizeBlockConfig("pomodoro",null,legacy).workSeconds,1200);
  same(normalizeBlockConfig("pomodoro",null,legacy).breakSeconds,180);
  const modern = normalizeBlockConfig("pomodoro",{workSeconds:0,breakSeconds:0,pomodoroWorkSeconds:1200,pomodoroBreakSeconds:180});
  same(modern.workSeconds,60);
  same(modern.breakSeconds,30);
  const mixed = normalizeBlockConfig("pomodoro",{workSeconds:600,pomodoroBreakSeconds:90});
  same(mixed.workSeconds,600);
  same(mixed.breakSeconds,90);
  same(normalizeBlockConfig("pomodoro",{pomodoroWorkSeconds:300,breakSeconds:60}).workSeconds,300);
  same(normalizeBlockConfig("timer",{durationSeconds:0,timerSeconds:90}).durationSeconds,1);
  same(normalizeBlockConfig("startPinned",null,{startPinned:"invalid"}),defaultBlockConfig("startPinned"));
}

// An invalid image cannot change a non-image fallback into a broken image.
// When already using an image, retain its known safe URL and fit.
{
  const base=normalizeTheme({background:{kind:"solid",color:"#112233"}},BUILT_IN_THEMES[0]);
  const invalid=[];
  const rejected=normalizeTheme({background:{kind:"image",url:"javascript:alert(1)"}},base,"theme",invalid);
  same(rejected.background,base.background);
  same(invalid.map(i=>i.messageKey),["validationInvalidUrl"]);
  const valid=normalizeTheme({background:{kind:"image",url:"https://example.com/p.png",fit:"contain",position:"top"}},base);
  const repaired=normalizeTheme({background:{kind:"image",url:""}},valid);
  same(repaired.background,valid.background);
}
console.log("Round 158: validation assertions", checks);


// Canonicalization must be byte-stable for distinct UTF-16 keys, integer-like
// keys and data properties whose names also exist on Object.prototype.
{
  const {canonicalJsonValue,jsonContentEqual}=await import("../src/lib/json-content.js");
  const keys=["\uffff","😀","a","A","__proto__","constructor","10","2","01","é","e\u0301"];
  const original=Object.fromEntries(keys.map((key,index)=>[key,{index,nested:[null,{z:2,a:1}]}]));
  const reversed=Object.fromEntries(Object.entries(original).reverse());
  same(JSON.stringify(canonicalJsonValue(original)),JSON.stringify(canonicalJsonValue(reversed)));
  check(jsonContentEqual(original,reversed));
  check(Object.hasOwn(canonicalJsonValue(original),"__proto__"));
  check(!jsonContentEqual(original,{...original,A:{index:-1}}));
  const {formatDateParts}=await import("../src/newtab/date-pattern.js");
  same(formatDateParts("dddd YYYY MMMM DD HH:mm:ss / literal",{
    weekday:"YYYY",year:"2026",month:"DD",day:"27",hour:"01",minute:"02",second:"03"
  }),"YYYY 2026 DD 27 01:02:03 / literal");
  same(formatDateParts("YYYYYYYY-HH-mm-ss",{}),"---");
}
console.log("Round 159: canonical UTF-16 ordering and exact date-token substitution",checks);


// The checked runtime target is returned to its caller. No second lookup
// with a different rule set is necessary; every allowed and disallowed
// block kind is validated against the same identity.
{
  const {runtimeMutationTargetExists,assertRuntimeMutationTarget}=await import("../src/lib/runtime-mutation-target.js");
  const {createBlockInstance}=await import("../src/lib/start-page-settings.js");
  const types={clock:["timer","stopwatch","pomodoro"],note:["note"],tasks:["localTasks"],linkPage:["links","startPinned"]};
  const blocks=BLOCK_DESCRIPTORS.map(({type})=>createBlockInstance(type,{id:"target-"+type}));
  const targetSettings={...settings,layout:{...settings.layout,blocks}};
  for(const [kind,allowed] of Object.entries(types)){
    for(const block of blocks){
      const valid=allowed.includes(block.type);
      same(runtimeMutationTargetExists(targetSettings,block.id,kind),valid);
      if(valid)check(assertRuntimeMutationTarget(targetSettings,block.id,kind)===block);
      else assert.throws(()=>assertRuntimeMutationTarget(targetSettings,block.id,kind),/changed or was removed/);
    }
    same(runtimeMutationTargetExists(targetSettings,"missing",kind),false);
    assert.throws(()=>assertRuntimeMutationTarget(targetSettings,"missing",kind),/changed or was removed/);
  }
}
console.log("Round 160: complete runtime mutation target matrix",checks);


 // A legacy appearance must not create a 1001st custom theme or silently
 // change the selected theme on the next normalization.
{
  const {normalizeStartPageSettingsWithReport}=await import("../src/lib/start-page-settings-validation.js");
  const base=BUILT_IN_THEMES[0];
  const customThemes=Array.from({length:limits.MAX_CUSTOM_THEMES},(_,index)=>({...base,id:"capacity-theme-"+index,name:"Theme "+index,builtIn:false}));
  const legacy={...settings,schemaVersion:1,appearance:{backgroundColor:"#123456"},themes:{selectedThemeId:customThemes[0].id,customThemes}};
  const full=normalizeStartPageSettingsWithReport(legacy);
  same(full.settings.themes.customThemes.length,limits.MAX_CUSTOM_THEMES);
  same(full.settings.themes.customThemes.map(x=>x.id),customThemes.map(x=>x.id));
  same(full.settings.themes.selectedThemeId,customThemes[0].id);
  check(full.report.issues.some(x=>x.path==="appearance"));
  same(full.report.skippedBlocks,0);
  same(normalizeStartPageSettingsWithReport(full.settings).settings,full.settings);
  const room=normalizeStartPageSettingsWithReport({...legacy,themes:{customThemes:customThemes.slice(1)}}).settings;
  same(room.themes.customThemes.length,limits.MAX_CUSTOM_THEMES);
  same(room.themes.selectedThemeId,"migrated-legacy-theme");
  same(normalizeStartPageSettingsWithReport(room).settings,room);
}
