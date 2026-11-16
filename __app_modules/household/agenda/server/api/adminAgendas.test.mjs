import { describe, it, expect } from 'vitest';
import express from 'express';
import request from '../../../../../tests/_lib/memory-http/request.mjs';
import { createAdminAgendasRouter } from './adminAgendas.mjs';
const series={schema:'agenda-series/v1',series_id:'s',household_id:'h',revision:0,title:'Together',calendar:{frequency:'weekly',timezone:'UTC',week_starts_on:'monday',default_day:'monday'},status:'active',defaults:{participants:[],list:{sections:[]},activity_settings:{}}};
const record={document:series,etag:'"one"'};
function app(role='parent', service={}) { const app=express(); app.use(express.json()); app.use((req,_res,next)=>{if(role) req.user={sub:'alice',roles:[role]}; next();}); app.use('/agendas',createAdminAgendasRouter({householdId:'h',planning:service,logger:{info(){},warn(){},error(){}}})); return app; }
describe('agenda HTTP authority and preconditions',()=>{
 it('requires authenticated host authority and an installed service',async()=>{expect((await request(app(null)).get('/agendas')).status).toBe(401); expect((await request(app('member')).get('/agendas')).status).toBe(403); expect((await request(app('parent',null)).get('/agendas')).status).toBe(503);});
 it('reads scoped series and returns the strong ETag',async()=>{const res=await request(app('parent',{readSeries:async input=>input.householdId==='h'?record:null})).get('/agendas/s'); expect(res.status).toBe(200); expect(res.headers.etag).toBe('"one"');});
 it('requires If-Match and reports conflicts',async()=>{const service={validateSeriesDocument:()=>({valid:true}),readSeries:async()=>record,saveSeries:async()=>{throw Object.assign(new Error('changed'),{code:'revision_conflict'});}}; expect((await request(app('parent',service)).put('/agendas/s').send({series:{}})).status).toBe(428); expect(await request(app('parent',service)).put('/agendas/s').set('If-Match','"old"').send({series})).toMatchObject({status:409,body:{code:'revision_conflict'}});});
 it('rejects untrusted body fields before writes',async()=>{const res=await request(app()).post('/agendas/s/plans').send({weekOf:'2026-11-16',requestId:'r',householdId:'foreign'}); expect(res).toMatchObject({status:422,body:{errors:[{field:'householdId'}]}});});
});
