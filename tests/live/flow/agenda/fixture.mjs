import {expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';

/** Owns only its uniquely named series, plans and guest; retained launch journals remain history. */
export async function createAgendaFixture({page,request},testInfo) {
 const token=process.env.AGENDA_TEST_TOKEN,household=process.env.AGENDA_TEST_HOUSEHOLD;
 if (!process.env.BASE_URL || !token || !household) throw Error('BASE_URL, AGENDA_TEST_TOKEN and AGENDA_TEST_HOUSEHOLD are required for managed Agenda acceptance');
 const id=`acceptance-${randomUUID()}`, guestName=`Visitor ${randomUUID()}`, headers={Authorization:`Bearer ${token}`};
 const base='/api/v1/admin/content/agendas';
 const check=async response=>{expect(response.ok(),`${response.url()} returned ${response.status()}: ${await response.text()}`).toBe(true);return response;};
 const series={schema:'agenda-series/v1',series_id:id,household_id:household,revision:0,title:`Agenda ${id}`,calendar:{frequency:'weekly',timezone:process.env.AGENDA_TEST_TIMEZONE || 'UTC',week_starts_on:'monday',default_day:'monday'},status:'active',defaults:{participants:[],list:{sections:[]},activity_settings:{}}};
 await check(await request.post(base,{headers,data:{series}}));
 await page.addInitScript(value=>localStorage.setItem('ds_token',value),token);
 const manifest={seriesId:id,planIds:[],guestIds:[],sessionIds:[]};
 const saveManifest=()=>writeFile(testInfo.outputPath('agenda-fixture-private.json'),JSON.stringify(manifest,null,2));
 await saveManifest();
 async function cleanup() {
  const response=await check(await request.get(`${base}/${id}/plans`,{headers}));const plans=(await response.json()).plans;
  for (const {document} of plans) {
   manifest.planIds.push(document.plan_id);
   const path=`${base}/${id}/plans/${document.plan_id}`;const current=await check(await request.get(path,{headers}));
   if ((await current.json()).state!=='archived') await check(await request.post(`${path}/archive`,{headers:{...headers,'If-Match':current.headers().etag},data:{}}));
  }
  const directory=await check(await request.get('/api/v1/admin/people?includeArchived=true',{headers}));
  for (const entry of (await directory.json()).people.filter(p=>p.person.kind==='guest' && p.display.name===guestName)) {
   manifest.guestIds.push(entry.person.id);
   if (entry.active) {const fresh=await check(await request.get('/api/v1/admin/people?includeArchived=true',{headers}));await check(await request.post(`/api/v1/admin/people/guests/${encodeURIComponent(entry.person.id)}/archive`,{headers:{...headers,'If-Match':fresh.headers().etag},data:{}}));}
  }
  const current=await check(await request.get(`${base}/${id}`,{headers}));await check(await request.post(`${base}/${id}/archive`,{headers:{...headers,'If-Match':current.headers().etag},data:{}}));
  await saveManifest();
 }
 return {id,guestName,headers,base,manifest,saveManifest,cleanup};
}
