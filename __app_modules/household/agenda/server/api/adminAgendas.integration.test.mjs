import {it,expect} from 'vitest';
import express from 'express';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import request from '../../../../../tests/_lib/memory-http/request.mjs';
import {YamlAgendaRepository} from '../adapters/YamlAgendaRepository.mjs';
import {AgendaPlanningService} from '../application/AgendaPlanningService.mjs';
import {createAdminAgendasRouter} from './adminAgendas.mjs';
const series={schema:'agenda-series/v1',series_id:'family',household_id:'home',revision:0,title:'Together',calendar:{frequency:'weekly',timezone:'UTC',week_starts_on:'monday',default_day:'monday'},status:'active',defaults:{participants:[],list:{sections:[]},activity_settings:{}}};
it('dispatches scoped persistence, conflict, validation and read-only preview',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-http-'));let n=0;
 try {
  const repository=new YamlAgendaRepository({pathForHousehold:id=>path.join(dir,id)});
  const planning=new AgendaPlanningService({repository,clock:()=>new Date('2026-11-16T20:00:00Z'),ids:Object.fromEntries(['plan','section','item','rosterEntry'].map(k=>[k,()=>`${k}_${++n}`])),resolveItemImage:async()=>null,validateActivities:async()=>({valid:false,errors:[{field:'activity_settings.item',message:'Incomplete'}]}),logger:{info(){}}});
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={sub:'host',roles:['parent']};next();});app.use('/agendas',createAdminAgendasRouter({householdId:'home',planning,logger:{info(){},warn(){},error(){}}}));
  expect((await request(app).post('/agendas').send({series})).status).toBe(201);
  expect(await request(app).post('/agendas/family/artwork/resolve').send({itemUids:['item']})).toMatchObject({status:200,body:{images:{}}});
  expect((await request(app).post('/agendas/family/artwork/resolve').send({itemUids:['../bad']})).status).toBe(422);
  expect(await request(app).get('/agendas/family/defaults/artwork')).toMatchObject({status:200,body:{revision:0,images:{}}});
  expect(await request(app).get('/agendas/family/planning-context')).toMatchObject({status:200,body:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}});
  expect(await repository.listPlans({householdId:'home',seriesId:'family'})).toHaveLength(0);
  const created=await request(app).post('/agendas/family/plans').send({weekOf:'2026-11-16',requestId:'create',sourceRevision:0});expect(created.status).toBe(201);const plan=created.body;
  const pathToPlan=`/agendas/family/plans/${plan.plan_id}`;
  const preview=await request(app).post(`${pathToPlan}/validate`).send({plan});expect(preview).toMatchObject({status:422,body:{errors:[{field:'activity_settings.item'}]}});
  expect((await request(app).get(pathToPlan)).headers.etag).toBe(created.headers.etag);
  expect((await request(app).put(pathToPlan).set('If-Match','"stale"').send({plan}))).toMatchObject({status:409,body:{code:'revision_conflict'}});
  expect((await request(app).get(`/agendas/foreign/plans/${plan.plan_id}`)).status).toBe(404);
  expect((await request(app).post('/agendas/family/plans').send({weekOf:'2026-11-23',requestId:'copy',sourcePlanId:plan.plan_id,sourceRevision:42})).status).toBe(409);
  expect((await request(app).post('/agendas/family/plans').send({weekOf:'2026-11-23',requestId:'create',sourceRevision:0}))).toMatchObject({status:409,body:{code:'idempotency_conflict'}});
  expect((await repository.listPlans({householdId:'home',seriesId:'family'}))).toHaveLength(1);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
