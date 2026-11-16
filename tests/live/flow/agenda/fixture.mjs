import {expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {attemptCleanup,withCleanup} from './cleanup.mjs';

/** Owns only its uniquely named series, plans and guest; retained launch journals remain history. */
export async function createAgendaFixture({page,request},testInfo) {
 const token=process.env.AGENDA_TEST_TOKEN,household=process.env.AGENDA_TEST_HOUSEHOLD;
 if (!process.env.BASE_URL || !token || !household) throw Error('BASE_URL, AGENDA_TEST_TOKEN and AGENDA_TEST_HOUSEHOLD are required for managed Agenda acceptance');
 const id=`acceptance-${randomUUID()}`, guestName=`Visitor ${randomUUID()}`, headers={Authorization:`Bearer ${token}`};
 const base='/api/v1/admin/content/agendas';
 const check=async response=>{expect(response.ok(),`${response.url()} returned ${response.status()}: ${await response.text()}`).toBe(true);return response;};
 const manifest={seriesId:id,guestName,seriesCreateAttempted:false,seriesCreated:false,planIds:[],guestIds:[],sessionIds:[],cleanupFailures:[]};
 const saveManifest=()=>writeFile(testInfo.outputPath('agenda-fixture-private.json'),JSON.stringify(manifest,null,2));
 const recordFailure=(label,work)=>async()=>{try {await work();} catch(error) {manifest.cleanupFailures.push({operation:label,message:error.message});throw error;}};
 async function cleanup() {
  const steps=[];
  if (manifest.seriesCreated) steps.push(recordFailure('plans',async()=>{
   const response=await check(await request.get(`${base}/${id}/plans`,{headers}));const plans=(await response.json()).plans;
   manifest.planIds=[...new Set([...manifest.planIds,...plans.map(({document})=>document.plan_id)])];await saveManifest();
   await attemptCleanup(plans.map(({document})=>recordFailure(`plan:${document.plan_id}`,async()=>{
    const path=`${base}/${id}/plans/${document.plan_id}`;const current=await check(await request.get(path,{headers}));
    if ((await current.json()).state!=='archived') await check(await request.post(`${path}/archive`,{headers:{...headers,'If-Match':current.headers().etag},data:{}}));
   })));
  }));
  steps.push(recordFailure('guests',async()=>{
   const directory=await check(await request.get('/api/v1/admin/people?includeArchived=true',{headers}));
   const guests=(await directory.json()).people.filter(p=>p.person.kind==='guest' && p.display.name===guestName);
   manifest.guestIds=[...new Set([...manifest.guestIds,...guests.map(entry=>entry.person.id)])];await saveManifest();
   await attemptCleanup(guests.map(entry=>recordFailure(`guest:${entry.person.id}`,async()=>{
    if (entry.active) {const fresh=await check(await request.get('/api/v1/admin/people?includeArchived=true',{headers}));await check(await request.post(`/api/v1/admin/people/guests/${encodeURIComponent(entry.person.id)}/archive`,{headers:{...headers,'If-Match':fresh.headers().etag},data:{}}));}
   })));
  }));
  if (manifest.seriesCreated) steps.push(recordFailure('series',async()=>{
   const current=await check(await request.get(`${base}/${id}`,{headers}));
   if ((await current.json()).status!=='archived') await check(await request.post(`${base}/${id}/archive`,{headers:{...headers,'If-Match':current.headers().etag},data:{}}));
  }));
  try {await attemptCleanup(steps);} finally {await saveManifest();}
 }
 const series={schema:'agenda-series/v1',series_id:id,household_id:household,revision:0,title:`Agenda ${id}`,calendar:{frequency:'weekly',timezone:process.env.AGENDA_TEST_TIMEZONE || 'UTC',week_starts_on:'monday',default_day:'monday'},status:'active',defaults:{participants:[],list:{sections:[]},activity_settings:{}}};
 await saveManifest();
 try {
  manifest.seriesCreateAttempted=true;await saveManifest();
  const created=await request.post(base,{headers,data:{series}});manifest.seriesCreated=created.status()===201;await saveManifest();await check(created);
  await page.addInitScript(value=>localStorage.setItem('ds_token',value),token);
  return {id,guestName,headers,base,manifest,saveManifest,cleanup};
 } catch (error) {
  return withCleanup(async()=>{throw error;},async()=>{if (manifest.seriesCreated) await cleanup();});
 }
}
