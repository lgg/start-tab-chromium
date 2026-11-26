import assert from "node:assert/strict";
import { installDom, installChrome, installFetch } from "./ui-fixture-dom.mjs";
import * as i18n from "../src/lib/i18n.js";
import * as google from "../src/lib/google-integration.js";

const dom=await installDom();
const control=installChrome();
const restoreFetch=installFetch();
const catalogFetch=globalThis.fetch;
try {
  const nav=window.navigator;
  Object.defineProperty(nav,"languages",{configurable:true,value:["xx-XX","ru_RU","en"]});
  assert.equal((await i18n.loadI18nForPreference("auto")).locale,"ru");
  Object.defineProperty(nav,"languages",{configurable:true,value:[]});
  Object.defineProperty(nav,"language",{configurable:true,value:"xx-XX"});
  assert.equal((await i18n.loadI18nForPreference("auto")).locale,"en");
  assert.equal(i18n.localePreferenceFromStored("RU_ru"),"ru");
  assert.equal(i18n.localePreferenceFromStored(null),"auto");
  assert.equal(i18n.renderTemplate("{x} {missing}",{x:"{missing}"}),"{missing} {missing}");
  await i18n.setLocalePreference("ru","auto");
  await assert.rejects(i18n.setLocalePreference("en","auto"),/language changed/);
  await i18n.setLocalePreference("auto","ru");
  assert.equal(control.state.localeOverride,undefined);
  await assert.rejects(i18n.setLocalePreference("bad"),/Unsupported locale preference/);
  globalThis.fetch=async url=>String(url).includes("/ru/")?new Response("",{status:404}):catalogFetch(url);
  assert.equal((await i18n.loadI18nForPreference("ru")).locale,"en");
  globalThis.fetch=async url=>String(url).endsWith("/messages.json")?new Response("",{status:404}):catalogFetch(url);
  await assert.rejects(i18n.loadI18nForPreference("en"),/Unable to load locale catalog/);
  globalThis.fetch=catalogFetch;

  assert.equal(google.isGoogleIntegrationConfigured(),false);
  await assert.rejects(google.listCalendarEvents(),/not configured/);
  control.oauth=true;
  for(const token of [undefined,null,"","  ",{}, {token:""}]) {
    control.chrome.identity.getAuthToken=async()=>token;
    await assert.rejects(google.listCalendarEvents(),/Unable to get Google OAuth token/);
  }
  control.chrome.identity.getAuthToken=async()=>"plain-token";
  const response=value=>Response.json(value);
  const allDay={id:"all",summary:"  All day ",start:{date:"2027-01-01"},end:{date:"2027-01-02"}};
  const timed={id:"time",start:{dateTime:"2027-01-01T10:00:00Z"},end:{dateTime:"2027-01-01T11:00:00Z"}};
  let requests=0;
  globalThis.fetch=async(url,init)=>{
    assert.equal(init.headers.get("Authorization"),"Bearer plain-token");
    assert.equal(new URL(url).searchParams.get("maxResults"),"8");
    requests++;
    return response({items:[null,[],1,{id:"bad",summary:1},{id:" "},{...allDay,id:"bad1",end:{date:"2027-01-01"}},{...allDay,id:"bad2",start:{date:"bad"}},{...allDay,id:"bad3",end:{date:"bad"}},{...timed,id:"bad4",start:{}},{...timed,id:"bad5",end:{}},{...timed,id:"bad6",end:{dateTime:"2027-01-01T09:00:00Z"}},allDay,allDay,timed]});
  };
  const events=await google.listCalendarEvents(" ",NaN);
  assert.deepEqual(events.map(x=>x.id),["all","time"]);
  assert.equal(events[0].title,"All day");assert.equal(events[0].allDay,true);
  assert.equal(events[1].title,"");assert.equal(events[1].allDay,false);assert.equal(requests,1);
  for(const invalid of [undefined,null,[],1,{items:{}}]) {
    globalThis.fetch=async()=>invalid===undefined?new Response(null,{status:204}):response(invalid);
    await assert.rejects(google.listCalendarEvents(),/invalid event listing/);
  }
  let removed=0;
  control.chrome.identity.removeCachedAuthToken=async()=>{removed++};
  requests=0;
  globalThis.fetch=async()=>++requests===1?new Response(null,{status:403}):response({items:[]});
  assert.deepEqual(await google.listCalendarEvents(),[]);assert.equal(removed,1);assert.equal(requests,2);
  globalThis.fetch=async()=>new Response(null,{status:500});
  await assert.rejects(google.listCalendarEvents(),/500/);
  globalThis.fetch=async()=>new Response("x".repeat(4*1024*1024+1));
  await assert.rejects(google.listCalendarEvents(),/exceeds the size limit/);
  for(const invalid of [null,[],{files:{}},{files:[null]},{files:[{id:" ",name:"start-tab-backup.json"}]},{files:[{id:"x",name:"wrong"}]}]) {
    globalThis.fetch=async()=>response(invalid);
    await assert.rejects(google.restoreDriveBackup(),/invalid backup/);
  }
  globalThis.fetch=async()=>response({files:[],nextPageToken:""});
  await assert.rejects(google.restoreDriveBackup(),/No Start Tab backup/);
  globalThis.fetch=async()=>response({files:[],nextPageToken:"loop"});
  await assert.rejects(google.restoreDriveBackup(),/did not advance/);

  globalThis.fetch=async()=>response({});
  assert.deepEqual(await google.listCalendarEvents(),[]);
  globalThis.fetch=async()=>response({items:[{...allDay,start:{date:"2027-01-01",dateTime:"2027-01-01T10:00:00Z"},end:{dateTime:"2027-01-01T11:00:00Z"}}]});
  assert.equal((await google.listCalendarEvents())[0].allDay,false);
  let pages=0;
  globalThis.fetch=async()=>response({files:[],nextPageToken:"page-"+(++pages)});
  await assert.rejects(google.restoreDriveBackup(),/safe pagination limit/);
  assert.equal(pages,100);
  const backup=await import("../src/lib/backup.js");
  const bundle=await backup.exportBackup();
  bundle.storage.blockedSites=["restored.example"];
  let mediaReads=0;
  globalThis.fetch=async url=>{
    const parsed=new URL(url);
    if(parsed.searchParams.get("alt")==="media"){mediaReads++;return response(bundle)}
    return response({files:[{id:"test-file",name:"start-tab-backup.json"}]});
  };
  await google.restoreDriveBackup();
  assert.deepEqual(control.state.blockedSites,["restored.example"]);
  assert.equal(mediaReads,1);
  console.log("Google: absent items, timed event precedence, bounded pagination and successful media restore");
  console.log("Locale and Google failure matrix: auto detection, fallback, CAS, malformed responses, invalid tokens, retry, size limit, calendar dates and Drive listing");
} finally {restoreFetch();dom.window.close();}
