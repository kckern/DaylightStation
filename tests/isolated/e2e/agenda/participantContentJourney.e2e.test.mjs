import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import express from 'express';
import request from '../../../_lib/memory-http/request.mjs';
import {ContentSourceRegistry} from '../../../../__capabilities/content-catalog/server/adapters/ContentSourceRegistry.mjs';
import {RegistryContentCatalogGateway} from '../../../../__capabilities/content-catalog/server/adapters/RegistryContentCatalogGateway.mjs';
import {ContentIdResolver} from '../../../../__capabilities/content-catalog/server/application/ContentIdResolver.mjs';
import {ParticipantLaunchService,ParticipantConsumerRegistry,hashValue} from '../../../../__capabilities/content-catalog/server/participant-launch.mjs';
import {createParticipantLaunchesRouter} from '../../../../__capabilities/content-catalog/server/api/participantLaunches.mjs';
import {createContentTargetResolver,createParticipantTargetResolver} from '../../../../__backend/src/5_composition/participants/targetResolver.mjs';
import {AgendaParticipantContextProvider} from '../../../../__app_modules/household/agenda/server/application/AgendaParticipantContextProvider.mjs';
import {YamlAgendaRepository} from '../../../../__app_modules/household/agenda/server/adapters/YamlAgendaRepository.mjs';
import {YamlAgendaLaunchLedger} from '../../../../__app_modules/household/agenda/server/adapters/YamlAgendaLaunchLedger.mjs';
import {AgendaLaunchRefCodec} from '../../../../__app_modules/household/agenda/server/adapters/AgendaLaunchRefCodec.mjs';
import {AgendaMenuProjector} from '../../../../__app_modules/household/agenda/server/application/AgendaMenuProjector.mjs';
import {ListMenuProjector} from '../../../../__capabilities/content-catalog/server/list-menu-projector.mjs';

it('retains isolated participant context for the same content across plans and sends complete options over HTTP',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-content-'));
 try {
  const sources=new ContentSourceRegistry();sources.register({source:'neutral',prefixes:[],getItem:async id=>({id}),getList:async()=>({items:[]}),getCapabilities:()=>['displayable'],describeParticipantAction:(item,action)=>item.id==='aware' && action==='display'?{participantConsumer:{id:'display-test',version:1}}:null});
  const catalog=new RegistryContentCatalogGateway({registry:sources});
  const resolveContent=createContentTargetResolver({contentIdResolver:new ContentIdResolver(catalog),contentCatalog:catalog,authorize:async({viewer})=>viewer.householdId==='home'});
  const resolve=createParticipantTargetResolver({apps:{},resolveContent});
  const target=await resolve({target:{kind:'authored-action',value:{contentId:'neutral:aware'}},action:'display',viewer:{householdId:'home'}});
  const ordinary=await resolve({target:{kind:'authored-action',value:{contentId:'neutral:ordinary'}},action:'display',viewer:{householdId:'home'}});
  const consumer={id:'display-test',version:1,targets:[{action:'display',kind:'content',source:'neutral',capability:'displayable'}],describe:()=>({participantRequirement:'required',minParticipants:1,maxParticipants:5,selectorSupport:['all']}),prepareSetup:async({participantContext})=>({schema:'participant-prepared-setup/v1',consumer:{id:'display-test',version:1},setup:{schema:'display-setup/v1',data:{}},preview:{schema:'display-preview/v1',data:{count:participantContext.participants.length}},artifacts:[],confirmation:'required'}),begin:async({snapshot})=>({schema:'participant-launch-result/v1',kind:'ready',launch_id:snapshot.launch_id,consumer:snapshot.consumer,snapshot_hash:snapshot.snapshot_hash,participant_context:snapshot.participant_context,output:{schema:'display-result/v1',data:{id:snapshot.target.id}}}),findResumable:async({receipts})=>receipts.filter(r=>r.result).map(r=>({launch_id:r.launch_id,label:'Saved'})),resume:async({receipt})=>receipt.result};
  const registry=new ParticipantConsumerRegistry();registry.register({consumer});expect(registry.resolve({target:ordinary,action:'display'})).toBeNull();
  const makePlan=(id,name)=>({household_id:'home',series_id:'series',plan_id:id,revision:1,state:'published',week_of:'2026-11-16',calendar:{timezone:'UTC'},participants:[{id:'guest',anonymous:true,display:{name,avatar:null}}],list:{sections:[{items:[{uid:'item',display:{contentId:'neutral:aware'}}]}]},activity_settings:{item:{action:'display',participants:{mode:'plan'},consumer:{id:'display-test',version:1},settings:{}}}});
  const plans={first:makePlan('first','One'),second:makePlan('second','Two')};const repo=new YamlAgendaRepository({pathForHousehold:()=>dir});repo.readPlan=async({planId})=>({document:plans[planId]});repo.readSeries=async()=>({document:{status:'active'}});
  const store=new YamlAgendaLaunchLedger({repository:repo,pathForHousehold:()=>dir});const codec=new AgendaLaunchRefCodec();
  let now=new Date('2026-11-17T00:00:00Z');
  const provider=new AgendaParticipantContextProvider({repository:repo,store,codec,clock:()=>now,directory:{},authorize:async({viewer})=>viewer.householdId==='home',resolveTarget:({item,action,viewer})=>resolve({target:{kind:'authored-action',value:item[action]},action,viewer})});
  const projector=new AgendaMenuProjector({listProjector:new ListMenuProjector(),codec,resolveTarget:({item,action,viewer})=>resolve({target:{kind:'authored-action',value:item[action]},action,viewer}),registry,logger:{warn(){}}});
  const projectedPlan={...plans.first,title:'Week',list:{sections:[{items:[...plans.first.list.sections[0].items,{uid:'ordinary',title:'Ordinary',display:{contentId:'neutral:ordinary'}}]}]}};
  const projection=await projector.project({plan:projectedPlan,viewer:{householdId:'home'},participantLaunchVersion:1});
  expect(projection.items[0].participantLaunches.display.provider).toBe('agenda');expect(projection.items[1].participantLaunches).toBeUndefined();expect(projection.items[1].actions.display).toBeDefined();
  const service=new ParticipantLaunchService({registry,providers:[provider],resolveDirectTarget:resolve,logger:{info(){}}});
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={sub:'user',roles:['parent']};next();});app.use('/launches',createParticipantLaunchesRouter({householdId:'home',service,logger:{info(){},warn(){},error(){}}}));
  const ref=id=>({schema:'participant-launch-ref/v1',provider:'agenda',ref:codec.encode({householdId:'home',planId:id,itemUid:'item',revision:1,action:'display',targetDigest:hashValue(target)})});
  const inspect=id=>request(app).post('/launches/inspect').send({ref:ref(id),action:'display'});
  const one=await inspect('first');expect(one.status).toBe(200);expect(one.body).toMatchObject({schema:'participant-launch-options/v1',consumer:{id:'display-test',version:1},confirmation:'required',consumer_summary:{schema:'display-preview/v1',data:{count:1}},choices:[]});expect(one.body.setup_hash).toMatch(/^[a-f0-9]{64}$/);
  const begin=await request(app).post('/launches/begin').send({ref:ref('first'),action:'display',requestId:'first-request',intent:'new',expectedSetupHash:one.body.setup_hash});expect(begin.status).toBe(200);expect(begin.body.participant_context.participants[0].display.name).toBe('One');
  const saved=await inspect('first');expect(saved.body.choices).toEqual([{launch_id:begin.body.launch_id,label:'Saved'}]);expect(saved.body.consumer_summary).toEqual({schema:'display-preview/v1',data:{count:1}});
  const two=await inspect('second');expect(two.body.choices).toEqual([]);expect(two.body.participant_summary[0].display.name).toBe('Two');
  const second=await request(app).post('/launches/begin').send({ref:ref('second'),action:'display',requestId:'second-request',intent:'new',expectedSetupHash:two.body.setup_hash});expect(second.status).toBe(200);expect(second.body.participant_context.participants[0].display.name).toBe('Two');expect(second.body.launch_id).not.toBe(begin.body.launch_id);
  // Advance only the existing injected clock; the real provider and ledger remain in use.
  now=new Date('2026-11-24T00:00:00Z');
  const resumed=await request(app).post('/launches/resume').send({ref:ref('first'),action:'display',launchId:begin.body.launch_id});expect(resumed.status).toBe(200);expect(resumed.body.launch_id).toBe(begin.body.launch_id);expect(resumed.body.participant_context.participants[0].display.name).toBe('One');expect(resumed.body.return_to).toEqual({kind:'content',content_id:'agenda:series/plans/first',item_uid:'item'});
  const expired=await request(app).post('/launches/begin').send({ref:ref('first'),action:'display',requestId:'after-rollover',intent:'new',expectedSetupHash:one.body.setup_hash});expect(expired.status).toBe(409);expect(expired.body.code).toBe('agenda_not_launchable');

 } finally {rmSync(dir,{recursive:true,force:true});}
});
