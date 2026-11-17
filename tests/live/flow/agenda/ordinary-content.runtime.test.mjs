import {test,expect} from './agendaTest.mjs';
import {randomUUID} from 'node:crypto';

test.use({actionTimeout:10000});
test('ordinary content keeps its own actions and queue children across independent plans',async({page,request,agendaFixture:fixture})=>{
 const displayId=process.env.AGENDA_TEST_ORDINARY_DISPLAY,queueId=process.env.AGENDA_TEST_ORDINARY_QUEUE;
 if(!displayId || !queueId)throw Error('AGENDA_TEST_ORDINARY_DISPLAY and AGENDA_TEST_ORDINARY_QUEUE are required');
 const get=async path=>{const response=await request.get(path,{headers:fixture.headers});expect(response.ok()).toBe(true);return response;};
 for(const [id,action] of [[displayId,'display'],[queueId,'queue']]){
  const response=await request.post('/api/v1/participant-launches/describe',{headers:fixture.headers,data:{target:{kind:'content',id},action}});expect(response.ok()).toBe(true);expect(await response.json()).toBeNull();
 }
 const series=await get(`${fixture.base}/${fixture.id}`),context=await get(`${fixture.base}/${fixture.id}/planning-context`);const seriesDoc=await series.json(),dates=await context.json();
 const create=await request.post(`${fixture.base}/${fixture.id}/plans`,{headers:fixture.headers,data:{weekOf:dates.thisWeek,requestId:randomUUID(),sourceRevision:seriesDoc.revision}});expect(create.status()).toBe(201);
 const plan=await create.json(),planPath=`${fixture.base}/${fixture.id}/plans/${plan.plan_id}`;
 plan.list={sections:[{uid:`section_${randomUUID()}`,title:'Ordinary',items:[{uid:`display_${randomUUID()}`,title:'Ordinary display',display:{contentId:displayId}},{uid:`queue_${randomUUID()}`,title:'Ordinary queue',queue:{contentId:queueId}}]}]};
 const saved=await request.put(planPath,{headers:{...fixture.headers,'If-Match':create.headers().etag},data:{plan}});expect(saved.ok()).toBe(true);
 const published=await request.post(`${planPath}/publish`,{headers:{...fixture.headers,'If-Match':saved.headers().etag},data:{}});expect(published.ok()).toBe(true);const publishedPlan=await published.json();
 const menuPath=`/api/v1/list/agenda/${fixture.id}/plans/${plan.plan_id}`;
 const menu=async path=>{const response=await request.get(path,{headers:{...fixture.headers,'X-Daylight-Participant-Launch-Version':'1'}});expect(response.ok()).toBe(true);expect(response.headers()['cache-control']).toBe('private, no-store');expect(response.headers().vary).toMatch(/X-Daylight-Participant-Launch-Version/i);expect(response.headers().vary).toMatch(/Authorization/i);expect(response.headers().vary).toMatch(/Cookie/i);return response.json();};
 const current=await menu(menuPath);const display=current.items.find(row=>row.label==='Ordinary display'),queue=current.items.find(row=>row.label==='Ordinary queue');expect(display.display.contentId).toBe(displayId);expect(queue.queue.contentId).toBe(queueId);expect(display.participantLaunches).toBeUndefined();expect(queue.participantLaunches).toBeUndefined();
 const children=await get(`/api/v1/list/${queueId.replace(':','/')}`);const childrenDoc=await children.json();expect(childrenDoc.items.length).toBeGreaterThan(0);
 const noAmbient=value=>{if(!value || typeof value!=='object')return;for(const [key,child] of Object.entries(value)){expect(['participantLaunches','participant_context']).not.toContain(key);noAmbient(child);}};
 for(const child of childrenDoc.items)noAmbient(child);
 const next=await request.post(`${fixture.base}/${fixture.id}/plans`,{headers:fixture.headers,data:{weekOf:dates.nextWeek,requestId:randomUUID(),sourcePlanId:plan.plan_id,sourceRevision:publishedPlan.revision}});expect(next.status()).toBe(201);const nextPlan=await next.json();
 const nextPublished=await request.post(`${fixture.base}/${fixture.id}/plans/${nextPlan.plan_id}/publish`,{headers:{...fixture.headers,'If-Match':next.headers().etag},data:{}});expect(nextPublished.ok()).toBe(true);
 const preview=await menu(`/api/v1/list/agenda/${fixture.id}/plans/${nextPlan.plan_id}`);expect(preview.preview).toBe(true);for(const label of ['Ordinary display','Ordinary queue']){const row=preview.items.find(item=>item.label===label);expect(row.disabled).toBe(true);expect(row.display).toBeUndefined();expect(row.queue).toBeUndefined();expect(row.participantLaunches).toBeUndefined();}
 let inspections=0;page.on('request',req=>{if(new URL(req.url()).pathname.endsWith('/participant-launches/inspect'))inspections++;});
 await page.goto(`/tv?list=${encodeURIComponent(`agenda:${fixture.id}/plans/${plan.plan_id}`)}`);await expect(page.getByText('Ordinary display',{exact:true})).toBeVisible();
 const fresh=await get(planPath),changed=await fresh.json();changed.title='Ordinary plan revised';const updated=await request.put(planPath,{headers:{...fixture.headers,'If-Match':fresh.headers().etag},data:{plan:changed}});expect(updated.ok()).toBe(true);
 await page.getByText('Ordinary display',{exact:true}).click();await expect(page.locator('.displayer img')).toBeVisible();expect(inspections).toBe(0);
});
