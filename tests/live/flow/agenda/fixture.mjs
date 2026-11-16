import {expect,request as playwrightRequest} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {attemptCleanup,withCleanup} from './cleanup.mjs';

/** Owns a unique series, plans, guest and optional caller menu; launch journals remain history. */
export async function createAgendaFixture({page,request,createCleanupContext=()=>playwrightRequest.newContext({baseURL:process.env.BASE_URL,timeout:15000})},testInfo) {
 const token=process.env.AGENDA_TEST_TOKEN,household=process.env.AGENDA_TEST_HOUSEHOLD;
 if (!process.env.BASE_URL || !token || !household) throw Error('BASE_URL, AGENDA_TEST_TOKEN and AGENDA_TEST_HOUSEHOLD are required for managed Agenda acceptance');
 const id=`acceptance-${randomUUID()}`, guestName=`Visitor ${randomUUID()}`, headers={Authorization:`Bearer ${token}`};
 const base='/api/v1/admin/content/agendas';
 const check=async response=>{expect(response.ok(),`${response.url()} returned ${response.status()}: ${await response.text()}`).toBe(true);return response;};
 const manifest={seriesId:id,guestName,seriesCreateAttempted:false,seriesCreated:false,planIds:[],guestIds:[],sessionIds:[],callerMenu:null,cleanupFailures:[]};
 const saveManifest=()=>writeFile(testInfo.outputPath('agenda-fixture-private.json'),JSON.stringify(manifest,null,2));
 const recordFailure=(label,work)=>async()=>{try {await work();} catch(error) {manifest.cleanupFailures.push({operation:label,message:error.message});throw error;}};
 async function cleanup() {
  const cleanupRequest=await createCleanupContext();
  const steps=[];
  if (manifest.callerMenu?.created) steps.push(recordFailure('caller-menu',async()=>{
   const path=`/api/v1/admin/content/lists/menus/${encodeURIComponent(manifest.callerMenu.name)}`;
   const current=await cleanupRequest.get(path,{headers});
   if(current.status()!==404) {
    await check(current);
    const owned=manifest.callerMenu;
    // After an acknowledged update only its verified readback is applicable.
    // A lost/rejected update may clean the original only if it is unchanged.
    const expected=owned.updateSucceeded ? owned.postUpdateState : owned.preUpdateState;
    expect(expected,'Caller menu has no proven unchanged state').toBeTruthy();
    expect(await current.json(),'Caller menu changed since the proven owned state').toEqual(expected);
    await check(await cleanupRequest.delete(path,{headers}));
   }
   const absent=await cleanupRequest.get(path,{headers});expect(absent.status()).toBe(404);
   manifest.callerMenu.cleanupVerified=true;
  }));

  if (manifest.seriesCreated) steps.push(recordFailure('plans',async()=>{
   const response=await check(await cleanupRequest.get(`${base}/${id}/plans`,{headers}));const plans=(await response.json()).plans;
   manifest.planIds=[...new Set([...manifest.planIds,...plans.map(({document})=>document.plan_id)])];
   await attemptCleanup([recordFailure('manifest:plans',saveManifest),...plans.map(({document})=>recordFailure(`plan:${document.plan_id}`,async()=>{
    const path=`${base}/${id}/plans/${document.plan_id}`;const current=await check(await cleanupRequest.get(path,{headers}));
    if ((await current.json()).state!=='archived') await check(await cleanupRequest.post(`${path}/archive`,{headers:{...headers,'If-Match':current.headers().etag},data:{}}));
   }))]);
  }));
  steps.push(recordFailure('guests',async()=>{
   const directory=await check(await cleanupRequest.get('/api/v1/admin/people?includeArchived=true',{headers}));
   const guests=(await directory.json()).people.filter(p=>p.person.kind==='guest' && p.display.name===guestName);
   manifest.guestIds=[...new Set([...manifest.guestIds,...guests.map(entry=>entry.person.id)])];
   await attemptCleanup([recordFailure('manifest:guests',saveManifest),...guests.map(entry=>recordFailure(`guest:${entry.person.id}`,async()=>{
    if (entry.active) {const fresh=await check(await cleanupRequest.get('/api/v1/admin/people?includeArchived=true',{headers}));await check(await cleanupRequest.post(`/api/v1/admin/people/guests/${encodeURIComponent(entry.person.id)}/archive`,{headers:{...headers,'If-Match':fresh.headers().etag},data:{}}));}
   }))]);
  }));
  if (manifest.seriesCreated) steps.push(recordFailure('series',async()=>{
   const current=await check(await cleanupRequest.get(`${base}/${id}`,{headers}));
   if ((await current.json()).status!=='archived') await check(await cleanupRequest.post(`${base}/${id}/archive`,{headers:{...headers,'If-Match':current.headers().etag},data:{}}));
  }));
  try {await attemptCleanup(steps);} finally {try {await saveManifest();} finally {await cleanupRequest.dispose();}}
 }
 async function createCallerMenu(contentId) {
  if(contentId!==`agenda:${id}/current`) throw Error('Caller menu must reference its own current series');
  const name=`agenda-caller-${randomUUID()}`,path=`/api/v1/admin/content/lists/menus/${name}`;
  const before=await request.get(path,{headers});expect(before.status()).toBe(404);
  manifest.callerMenu={name,created:false,createAttempted:true};await saveManifest();
  const created=await request.post('/api/v1/admin/content/lists/menus',{headers,data:{name}});
  expect(created.status()).toBe(201);const result=await created.json();
  expect(result).toMatchObject({ok:true,type:'menus',list:name,path:`content/lists/menus/${name}.yml`});
  manifest.callerMenu={name,contentId,created:true,createAttempted:true,createResponse:result};await saveManifest();
  const initial=await (await check(await request.get(path,{headers}))).json();
  // GET returns the complete normalized Admin document, including derived
  // indices/action labels. Retain all fields so metadata edits cannot disappear.
  expect(initial).toEqual({type:'menus',name,title:name,metadata:{},sections:[{items:[],index:0}],household});
  manifest.callerMenu.preUpdateState=initial;
  manifest.callerMenu.updateAttempted=true;await saveManifest();
  const updated=await check(await request.put(path,{headers,data:{items:[{title:'Open week',list:{contentId}}]}}));
  manifest.callerMenu.updateSucceeded=true;await saveManifest();
  expect(await updated.json()).toEqual({ok:true,type:'menus',list:name,count:1});
  const document=await (await check(await request.get(path,{headers}))).json();
  const expected={...initial,sections:[{items:[{title:'Open week',list:{contentId},label:'Open week',input:contentId,action:'List',sectionIndex:0,itemIndex:0}],index:0}]};
  expect(document).toEqual(expected);
  manifest.callerMenu.postUpdateState=document;await saveManifest();
  return name;
 }
 const series={schema:'agenda-series/v1',series_id:id,household_id:household,revision:0,title:`Agenda ${id}`,calendar:{frequency:'weekly',timezone:process.env.AGENDA_TEST_TIMEZONE || 'UTC',week_starts_on:'monday',default_day:'monday'},status:'active',defaults:{participants:[],list:{sections:[]},activity_settings:{}}};
 await saveManifest();
 try {
  manifest.seriesCreateAttempted=true;await saveManifest();
  const created=await request.post(base,{headers,data:{series}});manifest.seriesCreated=created.status()===201;await saveManifest();await check(created);
  await page.addInitScript(value=>localStorage.setItem('ds_token',value),token);
  return {id,guestName,headers,base,manifest,saveManifest,cleanup,createCallerMenu};
 } catch (error) {
  return withCleanup(async()=>{throw error;},async()=>{if (manifest.seriesCreated) await cleanup();});
 }
}
