import {it,expect} from 'vitest';
import express from 'express';
import request from '../../../../tests/_lib/memory-http/request.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAgendaRuntime} from './composition.mjs';
import {ListMenuProjector} from '../../../../__capabilities/content-catalog/server/list-menu-projector.mjs';
import {EmbeddedListCodec as ListConfigCodec} from '../../../../__capabilities/content-catalog/server/list-codec.mjs';
import {ParticipantConsumerRegistry} from '../../../../__capabilities/content-catalog/server/participant-launch.mjs';

it('installs the actual scoped Agenda admin router with shared provider and source', async () => {
 const dir=mkdtempSync(join(tmpdir(),'agenda-composition-'));
 try {
  const logger={info(){},warn(){},error(){}};
  const runtime=createAgendaRuntime({configService:{getDefaultHouseholdId:()=> 'h',getHouseholdPath:()=>dir},peopleDirectory:{resolve:()=>null},listCodec:ListConfigCodec,listProjector:new ListMenuProjector(),consumerRegistry:new ParticipantConsumerRegistry(),gaming:{resolveTarget:async()=>null,resolveItemImage:async()=>null},logger,clock:()=>new Date('2026-11-17T00:00:00Z')});
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={sub:'host',roles:['parent']};next();});app.use('/api/v1/admin/content/agendas',runtime.adminRouter);
  const response=await request(app).get('/api/v1/admin/content/agendas');
  expect(response.status).toBe(200);expect(response.body).toEqual({series:[]});
  expect(runtime.contentAdapter.source).toBe('agenda');expect(runtime.contextProvider.id).toBe('agenda');expect(runtime.launchStore).toBeTruthy();
 } finally {rmSync(dir,{recursive:true,force:true});}
});

it('rejects a series timezone outside the installed household policy', async () => {
 const dir=mkdtempSync(join(tmpdir(),'agenda-timezone-'));
 try {
  const logger={info(){},warn(){},error(){}};
  const runtime=createAgendaRuntime({configService:{getDefaultHouseholdId:()=> 'h',getHouseholdPath:()=>dir,getHouseholdTimezone:()=> 'America/Los_Angeles'},peopleDirectory:{resolve:()=>null},listCodec:ListConfigCodec,listProjector:new ListMenuProjector(),consumerRegistry:new ParticipantConsumerRegistry(),gaming:{resolveTarget:async()=>null,resolveItemImage:async()=>null},logger});
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={sub:'host',roles:['parent']};next();});app.use('/agendas',runtime.adminRouter);
  const series={schema:'agenda-series/v1',series_id:'s',household_id:'h',revision:0,title:'Together',calendar:{frequency:'weekly',timezone:'UTC',week_starts_on:'monday',default_day:'monday'},status:'active',defaults:{participants:[],list:{sections:[]},activity_settings:{}}};
  expect((await request(app).post('/agendas').send({series})).status).toBe(422);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
