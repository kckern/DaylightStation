import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import express from 'express';
import request from '../../../../tests/_lib/memory-http/request.mjs';
import {installParticipantRuntime} from './installedRuntime.mjs';
import {GamingApplication} from '../../../../__app_modules/games/party-games/server/application/runtime/GamingApplication.mjs';

it.each([
 ['casual','charades','activity-party',false,true],
 ['competitive','charades','activity-party',true,false],
 ['jeopardy','jeopardy','quiz',false,false],
 ['unspecified','charades','activity-party',undefined,false],
])('uses authoritative %s eligibility for describe, publication and projection',async(id,experience,rules,competition,eligible)=>{
 const dir=mkdtempSync(join(tmpdir(),'agenda-eligibility-'));
 try {
  const definition={experience:{id:experience,version:1},rule_module:{id:rules,version:1},competition,challenges:[{id:'word',prompt:'Bird'}]};
  const definitions={getCurrent:async()=>({definition,hash:'a'.repeat(64),artifacts:{rules_definition:{id,hash:'b'.repeat(64)}}})};
  const manifestStore={get:()=>({id:experience,version:1,hash:'c'.repeat(64),surfaces:[{id:'party-games',authority_modes:['remote']}]})};
  const gamingApplication=new GamingApplication({definitions,manifestStore});
  const runtime=installParticipantRuntime({enabled:true,configService:{getDefaultHouseholdId:()=> 'h',getHouseholdPath:()=>dir,getMediaDir:()=>dir},peopleDirectory:{resolve:()=>null},contentRegistry:{register(){},resolve:()=>null},contentServices:{contentIdResolver:{resolve:()=>null},contentCatalog:{getItem:async()=>null,capabilities:()=>[]}},gaming:{gamingApplication,definitions,manifestStore},logger:{info(){},warn(){},error(){}},clock:()=>new Date('2026-11-17T00:00:00Z')});
  const viewer={participant_id:'host',householdId:'h',role:'host'};
  const described=await runtime.service.describe({action:'open',target:{kind:'app',appId:'party-games',definitionId:id,participantConsumer:{id:'party-games',version:1}},viewer});
  if(eligible) expect(described).toBeTruthy(); else expect(described).toBeNull();
  const prepare=vi.spyOn(runtime.registry.get({id:'party-games',version:1}),'prepareSetup');
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={sub:'host',roles:['parent']};next();});app.use('/agendas',runtime.agenda.adminRouter);
  const series={schema:'agenda-series/v1',series_id:'s',household_id:'h',revision:0,title:'Together',calendar:{frequency:'weekly',timezone:'UTC',week_starts_on:'monday',default_day:'monday'},status:'active',defaults:{participants:[],list:{sections:[{uid:'section',items:[{uid:'game',label:'Game',open:`party-games/${id}`}]}]},activity_settings:{}}};
  expect((await request(app).post('/agendas').send({series})).status).toBe(201);
  const created=await request(app).post('/agendas/s/plans').send({weekOf:'2026-11-16',requestId:'create',sourceRevision:0});expect(created.status).toBe(201);
  const published=await request(app).post(`/agendas/s/plans/${created.body.plan_id}/publish`).set('If-Match',created.headers.etag).send({});
  if(eligible) {
   expect(published.status).toBe(422);
   const plan=created.body,uid=plan.list.sections[0].items[0].uid;
   plan.participants=[{id:'seat',anonymous:true,display:{name:'Visitor',avatar:null}}];
   plan.activity_settings[uid]={schema:'agenda-activity-setup/v1',action:'open',consumer:{id:'party-games',version:1},participants:{mode:'plan'},settings:{schema:'party-games-participant-setup/v1',autostart:false,charades:{default_clue_mode:'text',clue_modes:{}}}};
   const saved=await request(app).put(`/agendas/s/plans/${plan.plan_id}`).set('If-Match',created.headers.etag).send({plan});
   expect(saved.status).toBe(200);
   const ready=await request(app).post(`/agendas/s/plans/${plan.plan_id}/publish`).set('If-Match',saved.headers.etag).send({});
   expect(ready.status).toBe(200);
   expect(prepare).toHaveBeenCalledOnce();
  } else {expect(published.status).toBe(200);expect(prepare).not.toHaveBeenCalled();}
  const menu=await runtime.agenda.contentAdapter.getList('s',{viewer,participantLaunchVersion:1});
  const row=menu.items.find(item=>item.metadata?.uid);
  expect(row.disabled).not.toBe(true);
  if(eligible) expect(row.participantLaunches.open.provider).toBe('agenda');
  else {
   expect(row.participantLaunches).toBeUndefined();expect(row.actions.open).toBeTruthy();
   const plan=published.body,uid=plan.list.sections[0].items[0].uid;
   plan.participants=[{id:'seat',anonymous:true,display:{name:'Visitor',avatar:null}}];
   plan.activity_settings[uid]={schema:'agenda-activity-setup/v1',action:'open',consumer:{id:'party-games',version:1},participants:{mode:'plan'},settings:{schema:'party-games-participant-setup/v1',autostart:false,charades:{default_clue_mode:'text',clue_modes:{}}}};
   const invalid=await request(app).put(`/agendas/s/plans/${plan.plan_id}`).set('If-Match',published.headers.etag).send({plan});
   expect(invalid.status).toBe(422);
   expect(prepare).not.toHaveBeenCalled();
  }
 } finally {rmSync(dir,{recursive:true,force:true});}
});
