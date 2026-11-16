import {it,expect,vi} from 'vitest';
import express from 'express';
import request from '../../../../tests/_lib/memory-http/request.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installParticipantRuntime} from './installedRuntime.mjs';

it('installs shared participant and agenda routes and the agenda source', async () => {
 const dir=mkdtempSync(join(tmpdir(),'installed-agenda-'));
 try {
  const sources=[];const logger={info(){},warn(){},error(){}};
  const runtime=installParticipantRuntime({enabled:true,configService:{getDefaultHouseholdId:()=> 'h',getHouseholdPath:()=>dir,getMediaDir:()=>dir},peopleDirectory:{resolve:()=>null,list:()=>[],revision:()=>0},contentRegistry:{register:source=>sources.push(source)},contentServices:{contentIdResolver:{resolve:()=>null},contentCatalog:{getItem:async()=>null,capabilities:()=>[]}},gaming:{gamingApplication:{getLaunchDescriptor:async()=>null},definitions:{},manifestStore:{}},logger});
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={sub:'host',roles:['parent']};next();});app.use('/api/v1/participant-launches',runtime.participantRouter);app.use('/api/v1/admin/content/agendas',runtime.agenda.adminRouter);app.use('/api/v1/admin/people',runtime.peopleRouter);
  expect((await request(app).get('/api/v1/admin/content/agendas')).status).toBe(200);
  expect((await request(app).get('/api/v1/admin/people')).status).toBe(200);
  expect((await request(app).post('/api/v1/participant-launches/describe').send({action:'open',target:{kind:'authored-action',value:'unknown'}})).status).toBe(422);
  expect(sources.map(s=>s.source)).toEqual(['agenda']);
  expect(()=>runtime.registry.register({consumer:runtime.registry.get({id:'party-games',version:1})})).toThrow();
 } finally {rmSync(dir,{recursive:true,force:true});}
});

it('describes a known ordinary app without participant registration', async () => {
 const dir=mkdtempSync(join(tmpdir(),'installed-agenda-'));
 try {
  const runtime=installParticipantRuntime({enabled:true,configService:{getDefaultHouseholdId:()=> 'h',getHouseholdPath:()=>dir,getMediaDir:()=>dir},peopleDirectory:{resolve:()=>null},contentRegistry:{register(){}},contentServices:{contentIdResolver:{resolve:()=>null},contentCatalog:{getItem:async()=>null,capabilities:()=>[]}},gaming:{gamingApplication:{getLaunchDescriptor:async()=>null},definitions:{},manifestStore:{}},logger:{info(){},warn(){},error(){}}});
  const result=await runtime.service.describe({action:'open',target:{kind:'authored-action',value:'webcam'},viewer:{participant_id:'host',householdId:'h',role:'host'}});
  expect(result).toBeNull();
 } finally {rmSync(dir,{recursive:true,force:true});}
});

it('mounts installed routers through the real v1 and admin router composition', async () => {
 const {createApiRouter}=await import('../../4_api/v1/routers/api.mjs');
 const {createAdminRouter}=await import('../../4_api/v1/routers/admin/index.mjs');
 const dir=mkdtempSync(join(tmpdir(),'installed-agenda-'));
 try {
  const logger={info(){},warn(){},error(){},debug(){},child(){return this;}};
  const runtime=installParticipantRuntime({enabled:true,configService:{getDefaultHouseholdId:()=> 'h',getHouseholdPath:()=>dir,getMediaDir:()=>dir},peopleDirectory:{resolve:()=>null,list:()=>[],revision:()=>0},contentRegistry:{register(){}},contentServices:{contentIdResolver:{resolve:()=>null},contentCatalog:{getItem:async()=>null,capabilities:()=>[]}},gaming:{gamingApplication:{getLaunchDescriptor:async()=>null},definitions:{},manifestStore:{}},logger});
  const admin=createAdminRouter({logger,listManagementService:{},yamlConfigFileService:{},appsConfigService:{},schedulerAdminService:{},integrationsQueryService:{},householdAdminService:{},adminImageService:{},adminArtService:{listWorks(){},patchWork(){}},agendaRouter:runtime.agenda.adminRouter,peopleRouter:runtime.peopleRouter});
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={sub:'host',roles:['parent']};next();});app.use('/api/v1',createApiRouter({safeConfig:{},routers:{admin,participantLaunches:runtime.participantRouter},logger}));
  expect((await request(app).get('/api/v1/admin/content/agendas')).status).toBe(200);
  expect((await request(app).get('/api/v1/admin/people')).status).toBe(200);
  expect((await request(app).post('/api/v1/participant-launches/describe').send({action:'open',target:{kind:'authored-action',value:'webcam'}})).status).toBe(200);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

it('exposes the installed Agenda source through the real list router while preserving anonymous lists', async () => {
 const {ContentSourceRegistry}=await import('../../../../__capabilities/content-catalog/server/adapters/ContentSourceRegistry.mjs');
 const {RegistryContentCatalogGateway}=await import('../../../../__capabilities/content-catalog/server/adapters/RegistryContentCatalogGateway.mjs');
 const {ListBrowseService}=await import('../../../../__capabilities/content-catalog/server/application/services/ListBrowseService.mjs');
 const {createListRouter}=await import('../../../../__capabilities/content-catalog/server/api/list.mjs');
 const dir=mkdtempSync(join(tmpdir(),'installed-agenda-'));
 try {
  const logger={info(){},warn(){},error(){}};const registry=new ContentSourceRegistry();
  registry.register({source:'ordinary',prefixes:[],getItem:async()=>null,getList:async()=>({id:'ordinary:test',title:'Ordinary',items:[]})});
  const runtime=installParticipantRuntime({enabled:true,configService:{getDefaultHouseholdId:()=> 'h',getHouseholdPath:()=>dir,getMediaDir:()=>dir},peopleDirectory:{resolve:()=>null},contentRegistry:registry,contentServices:{contentIdResolver:{resolve:()=>null},contentCatalog:{getItem:async()=>null,capabilities:()=>[]}},gaming:{gamingApplication:{getLaunchDescriptor:async()=>null},definitions:{},manifestStore:{}},logger,clock:()=>new Date('2026-11-17T00:00:00Z')});
  const gateway=new RegistryContentCatalogGateway({registry});const browse=new ListBrowseService({contentCatalog:gateway,contentIdResolver:{resolve:id=>gateway.resolve(id)}});
  const app=express();app.use(express.json());app.use((req,_res,next)=>{if(req.get('x-test-auth')) req.user={sub:'host',roles:['parent']};next();});
  app.use('/api/v1/admin/content/agendas',runtime.agenda.adminRouter);
  app.use('/api/v1/list',createListRouter({listBrowse:browse,viewerForRequest:req=>req.user?{participant_id:req.user.sub,householdId:'h',role:'host'}:null,logger}));
  const series={schema:'agenda-series/v1',series_id:'s',household_id:'h',revision:0,title:'Together',calendar:{frequency:'weekly',timezone:'UTC',week_starts_on:'monday',default_day:'monday'},status:'active',defaults:{participants:[],list:{sections:[]},activity_settings:{}}};
  expect((await request(app).post('/api/v1/admin/content/agendas').set('x-test-auth','yes').send({series})).status).toBe(201);
  const ordinary=await request(app).get('/api/v1/list/ordinary/test');expect(ordinary.status).toBe(200);expect(ordinary.body.title).toBe('test');
  const anonymous=await request(app).get('/api/v1/list/agenda/s');expect(anonymous.status).toBe(401);
  const authorized=await request(app).get('/api/v1/list/agenda/s').set('x-test-auth','yes').set('X-Daylight-Participant-Launch-Version','1');
  expect(authorized.status).toBe(200);expect(authorized.body.notice).toMatch(/No plan/);expect(authorized.headers['cache-control']).toBe('private, no-store');
  expect(runtime.agenda.contentAdapter.getCapabilities()).toEqual(['listable']);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

it('uses one live ownership decision for legacy list reads and writes', async () => {
 const {AgendaResourceAliases}=await import('../../../../__app_modules/household/agenda/server/composition.mjs');
 const {createAdminContentRouter}=await import('../../../../__capabilities/content-catalog/server/api/admin/content.mjs');
 const {createListRouter}=await import('../../../../__capabilities/content-catalog/server/api/list.mjs');
 let owned=false,writes=0;
 const aliases=new AgendaResourceAliases({registrations:[{kind:'menu',id:'fhe',owner:'agenda',canonicalContentId:'agenda:fhe',adminUrl:'/admin/content/agendas/fhe'}],authority:()=>{if(owned==='bad')throw Error('authority');return owned;}});
 const browse={browse:async args=>({kind:'found',items:[],compoundId:`${args.source}:${args.localId}`,sourceResult:{privateResponse:args.source==='agenda'},containerInfo:{title:args.source}})};
 const service={replaceContents(){writes++;return {ok:true}}};
 const app=express();app.use(express.json());app.use('/list',createListRouter({listBrowse:browse,resourceAliases:aliases,logger:{info(){},warn(){},error(){}}}));app.use('/admin',createAdminContentRouter({householdContext:{resolve:()=> 'h'},listManagementService:service,resourceAliases:aliases,logger:{info(){},warn(){},error(){}}}));
 expect((await request(app).put('/admin/lists/menus/fhe').send({items:[]})).status).toBe(200);expect(writes).toBe(1);
 owned=true;
 const read=await request(app).get('/list/menu/fhe');expect(read.body.id || read.body.source).toBeTruthy();expect(read.headers['cache-control']).toBe('private, no-store');
 const blocked=await request(app).put('/admin/lists/menus/fhe').send({items:[]});expect(blocked.status).toBe(409);expect(blocked.body.code).toBe('resource_moved');expect(writes).toBe(1);
 expect((await request(app).put('/admin/lists/menus/other').send({items:[]})).status).toBe(200);
 owned='bad';expect((await request(app).put('/admin/lists/menus/fhe').send({items:[]})).status).toBe(503);expect(writes).toBe(2);owned=false;
 expect((await request(app).put('/admin/lists/menus/fhe').send({items:[]})).status).toBe(200);
});

it('reports disabled feature without registering a source or creating data', async () => {
 const dir=mkdtempSync(join(tmpdir(),'disabled-agenda-'));
 try {
  let registrations=0;const logger={info(){},warn(){},error(){}};
  const runtime=installParticipantRuntime({enabled:false,configService:{getDefaultHouseholdId:()=> 'h'},contentRegistry:{register(){registrations++;}},logger});
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={sub:'host',roles:['parent']};next();});app.use('/agendas',runtime.agenda.adminRouter);app.use('/people',runtime.peopleRouter);app.use('/launches',runtime.participantRouter);
  expect((await request(app).get('/agendas')).status).toBe(503);expect((await request(app).get('/people')).status).toBe(503);
  expect((await request(app).post('/launches/describe').send({action:'open',target:{kind:'authored-action',value:'webcam'}})).status).toBe(503);
  expect(registrations).toBe(0);expect((await import('node:fs')).readdirSync(dir)).toEqual([]);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

it('serves exact ownership lookup without requiring auth for unrelated lists', async () => {
 const {AgendaResourceAliases}=await import('../../../../__app_modules/household/agenda/server/composition.mjs');
 const {createListRouter}=await import('../../../../__capabilities/content-catalog/server/api/list.mjs');
 let mode=false;const aliases=new AgendaResourceAliases({registrations:[{kind:'menu',id:'fhe',owner:'agenda',canonicalContentId:'agenda:fhe',adminUrl:'/admin/content/agendas/fhe'}],authority:()=>{if(mode==='bad')throw Error('bad');return mode;}});
 const app=express();app.use('/list',createListRouter({resourceAliases:aliases,viewerForRequest:req=>req.get('x-test-auth')?{participant_id:'host',householdId:'h'}:null,logger:{info(){},warn(){},error(){}}}));
 expect((await request(app).get('/list/_ownership/menu/other')).body).toEqual({alias:null});
 expect((await request(app).get('/list/_ownership/menu/fhe')).body).toEqual({alias:null});mode=true;
 expect((await request(app).get('/list/_ownership/menu/fhe')).status).toBe(401);
 expect((await request(app).get('/list/_ownership/menu/fhe').set('x-test-auth','yes')).body).toEqual({alias:{owner:'agenda',canonicalContentId:'agenda:fhe'}});
 mode='bad';expect((await request(app).get('/list/_ownership/menu/fhe')).status).toBe(503);
});

it('publishes codec-normalized ordinary list and media actions using real source capabilities', async () => {
 const {ContentSourceRegistry}=await import('../../../../__capabilities/content-catalog/server/adapters/ContentSourceRegistry.mjs');
 const {RegistryContentCatalogGateway}=await import('../../../../__capabilities/content-catalog/server/adapters/RegistryContentCatalogGateway.mjs');
 const {ContentIdResolver}=await import('../../../../__capabilities/content-catalog/server/application/ContentIdResolver.mjs');
 const dir=mkdtempSync(join(tmpdir(),'agenda-ordinary-'));
 try {
  const registry=new ContentSourceRegistry();
  registry.register({source:'menu',prefixes:[],getItem:async()=>({id:'menu:songs',itemType:'container'}),getList:async()=>({items:[]}),getCapabilities:()=>['listable']});
  registry.register({source:'files',prefixes:[],getItem:async()=>({id:'files:song',mediaUrl:'/song'}),getList:async()=>({items:[]}),getCapabilities:()=>['playable']});
  const catalog=new RegistryContentCatalogGateway({registry});const resolver=new ContentIdResolver(catalog);
  const logger={info(){},warn(){},error(){}};
  const runtime=installParticipantRuntime({enabled:true,configService:{getDefaultHouseholdId:()=> 'h',getHouseholdPath:()=>dir,getMediaDir:()=>dir},peopleDirectory:{resolve:()=>null},contentRegistry:registry,contentServices:{contentIdResolver:resolver,contentCatalog:catalog},gaming:{gamingApplication:{getLaunchDescriptor:async()=>null},definitions:{},manifestStore:{}},logger,clock:()=>new Date('2026-11-17T00:00:00Z')});
  const prepare=vi.spyOn(runtime.registry.get({id:'party-games',version:1}),'prepareSetup');
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={sub:'host',roles:['parent']};next();});app.use('/agendas',runtime.agenda.adminRouter);
  const series={schema:'agenda-series/v1',series_id:'s',household_id:'h',revision:0,title:'Together',calendar:{frequency:'weekly',timezone:'UTC',week_starts_on:'monday',default_day:'monday'},status:'active',defaults:{participants:[],list:{sections:[{uid:'s1',items:[{uid:'nav',label:'Songs',input:'menu:songs',action:'List'},{uid:'media',label:'Song',input:'files:song',action:'Play'}]}]},activity_settings:{}}};
  expect((await request(app).post('/agendas').send({series})).status).toBe(201);
  const created=await request(app).post('/agendas/s/plans').send({weekOf:'2026-11-16',requestId:'create',sourceRevision:0});expect(created.status).toBe(201);
  const published=await request(app).post(`/agendas/s/plans/${created.body.plan_id}/publish`).set('If-Match',created.headers.etag).send({});
  expect(published.status).toBe(200);expect(published.body.state).toBe('published');expect(prepare).not.toHaveBeenCalled();
 } finally {rmSync(dir,{recursive:true,force:true});}
});

it('retains only existing UID artwork when the installed planner copies a template', async () => {
 const {mkdirSync,writeFileSync}=await import('node:fs');const dir=mkdtempSync(join(tmpdir(),'agenda-art-'));
 try {
  mkdirSync(join(dir,'img','lists'),{recursive:true});writeFileSync(join(dir,'img','lists','old.jpg'),'art');
  const logger={info(){},warn(){},error(){}};
  const runtime=installParticipantRuntime({enabled:true,configService:{getDefaultHouseholdId:()=> 'h',getHouseholdPath:()=>dir,getMediaDir:()=>dir},peopleDirectory:{resolve:()=>null},contentRegistry:{register(){}},contentServices:{contentIdResolver:{resolve:()=>null},contentCatalog:{getItem:async()=>null,capabilities:()=>[]}},gaming:{gamingApplication:{getLaunchDescriptor:async()=>null},definitions:{},manifestStore:{}},logger,clock:()=>new Date('2026-11-17T00:00:00Z')});
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={sub:'host',roles:['parent']};next();});app.use('/agendas',runtime.agenda.adminRouter);
  const series={schema:'agenda-series/v1',series_id:'s',household_id:'h',revision:0,title:'Together',calendar:{frequency:'weekly',timezone:'UTC',week_starts_on:'monday',default_day:'monday'},status:'active',defaults:{participants:[],list:{sections:[{uid:'section',items:[{uid:'old',title:'Existing'},{uid:'missing',title:'Missing'}]}]},activity_settings:{}}};
  expect((await request(app).post('/agendas').send({series})).status).toBe(201);
  const created=await request(app).post('/agendas/s/plans').send({weekOf:'2026-11-16',requestId:'art',sourceRevision:0});expect(created.status).toBe(201);
  const [existing,missing]=created.body.list.sections[0].items;
  expect(existing.image).toBe('/media/img/lists/old.jpg');expect(existing.uid).not.toBe('old');expect(missing.image).toBeUndefined();
 } finally {rmSync(dir,{recursive:true,force:true});}
});

it('authorizes and canonicalizes direct Party Games targets with no launch-store writes',async()=>{
 const {readdirSync}=await import('node:fs');const dir=mkdtempSync(join(tmpdir(),'agenda-direct-'));
 try {
  const logger={info(){},warn(){},error(){}};const gamingApplication={getLaunchDescriptor:async id=>({definition_id:id,surface:{id:'party-games'}})};
  const runtime=installParticipantRuntime({enabled:true,configService:{getDefaultHouseholdId:()=> 'h',getHouseholdPath:()=>dir,getMediaDir:()=>dir},peopleDirectory:{resolve:()=>null},contentRegistry:{register(){}},contentServices:{contentIdResolver:{resolve:()=>null},contentCatalog:{getItem:async()=>null,capabilities:()=>[]}},gaming:{gamingApplication,definitions:{},manifestStore:{}},logger});
  const viewer={role:'host',participant_id:'host',householdId:'h'};
  const target={kind:'app',appId:'party-games',definitionId:'charades:test',participantConsumer:{id:'spoof',version:77}};
  const options=await runtime.service.inspect({target,action:'open',viewer});expect(options.passthrough).toBe(true);expect(options.consumer).toEqual({id:'party-games',version:1});
  const result=await runtime.service.begin({target,action:'open',viewer,intent:'new',requestId:'r'});expect(result.kind).toBe('passthrough');expect(result.target.participantConsumer).toEqual({id:'party-games',version:1});
  expect(readdirSync(dir)).toEqual([]);
  await expect(runtime.service.inspect({target,action:'open',viewer:{...viewer,householdId:'foreign'}})).rejects.toMatchObject({code:'authorization_denied'});
 } finally {rmSync(dir,{recursive:true,force:true});}
});

it('negotiates participant references on exact legacy aliases through the installed source',async()=>{
 const {AgendaResourceAliases}=await import('../../../../__app_modules/household/agenda/server/composition.mjs');
 const {ContentSourceRegistry}=await import('../../../../__capabilities/content-catalog/server/adapters/ContentSourceRegistry.mjs');
 const {RegistryContentCatalogGateway}=await import('../../../../__capabilities/content-catalog/server/adapters/RegistryContentCatalogGateway.mjs');
 const {ListBrowseService}=await import('../../../../__capabilities/content-catalog/server/application/services/ListBrowseService.mjs');
 const {createListRouter}=await import('../../../../__capabilities/content-catalog/server/api/list.mjs');
 const {writeFileSync}=await import('node:fs');const dir=mkdtempSync(join(tmpdir(),'agenda-protocol-'));
 try {
  const aliases=new AgendaResourceAliases({registrations:[{kind:'menu',id:'fhe',owner:'agenda',canonicalContentId:'agenda:s',adminUrl:'/admin/content/agendas/s'}],authority:()=>true});
  const registry=new ContentSourceRegistry(),logger={info(){},warn(){},error(){}};
  const runtime=installParticipantRuntime({enabled:true,resourceAliases:aliases,configService:{getDefaultHouseholdId:()=> 'h',getHouseholdPath:()=>dir,getMediaDir:()=>dir},peopleDirectory:{resolve:()=>null},contentRegistry:registry,contentServices:{contentIdResolver:{resolve:()=>null},contentCatalog:{getItem:async()=>null,capabilities:()=>[]}},gaming:{gamingApplication:{getLaunchDescriptor:async id=>({definition_id:id,surface:{id:'party-games'}})},definitions:{},manifestStore:{}},logger,clock:()=>new Date('2026-11-17T00:00:00Z')});
  const gateway=new RegistryContentCatalogGateway({registry});const browse=new ListBrowseService({contentCatalog:gateway,contentIdResolver:{resolve:id=>gateway.resolve(id)}});
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={sub:'host',roles:['parent']};next();});app.use('/agendas',runtime.agenda.adminRouter);app.use('/list',createListRouter({listBrowse:browse,resourceAliases:aliases,viewerForRequest:()=>({participant_id:'host',role:'host',householdId:'h'}),logger}));
  const binding={schema:'agenda-activity-setup/v1',action:'open',participants:{mode:'plan'},consumer:{id:'party-games',version:1},settings:{}};
  const series={schema:'agenda-series/v1',series_id:'s',household_id:'h',revision:0,title:'Together',calendar:{frequency:'weekly',timezone:'UTC',week_starts_on:'monday',default_day:'monday'},status:'active',defaults:{participants:[],list:{sections:[{uid:'section',items:[{uid:'game',title:'Game',open:'party-games/charades:test'}]}]},activity_settings:{game:binding}}};
  expect((await request(app).post('/agendas').send({series})).status).toBe(201);
  const created=await request(app).post('/agendas/s/plans').send({weekOf:'2026-11-16',requestId:'r',sourceRevision:0});expect(created.status).toBe(201);
  const plan=created.body;plan.state='published';writeFileSync(join(dir,'agendas','series','s','plans',`${plan.plan_id}.yml`),JSON.stringify(plan));
  const supported=await request(app).get('/list/menu/fhe').set('X-Daylight-Participant-Launch-Version','1');expect(supported.status).toBe(200);expect(supported.body.items[0].participantLaunches.open.schema).toBe('participant-launch-ref/v1');expect(supported.headers['cache-control']).toBe('private, no-store');
  const old=await request(app).get('/list/menu/fhe');expect(old.status).toBe(200);expect(old.body.items[0].disabled).toBe(true);expect(old.body.items[0].open).toBeUndefined();expect(old.body.items[0].participantLaunches).toBeUndefined();
 } finally {rmSync(dir,{recursive:true,force:true});}
});

it('guards normalized create names at the real list mutation boundary', async () => {
 const {AgendaResourceAliases}=await import('../../../../__app_modules/household/agenda/server/composition.mjs');
 const {createAdminContentRouter}=await import('../../../../__capabilities/content-catalog/server/api/admin/content.mjs');
 const {ListManagementService}=await import('../../../../__capabilities/content-catalog/server/application/services/ListManagementService.mjs');
 const calls=[];const service=new ListManagementService({listStore:{createList:(...args)=>{calls.push(args);return true;}},logger:{info(){}}});
 const aliases=new AgendaResourceAliases({registrations:[{kind:'menu',id:'fhe',owner:'agenda',canonicalContentId:'agenda:fhe',adminUrl:'/admin/content/agendas/fhe'}],authority:()=>true});
 const app=express();app.use(express.json());app.use('/admin',createAdminContentRouter({householdContext:{resolve:()=> 'h'},listManagementService:service,resourceAliases:aliases,logger:{info(){},warn(){},error(){}}}));
 for (const name of ['FHE',' FHE ','F.H.E.']) {
  const response=await request(app).post('/admin/lists/menus').send({name});
  expect(response.status).toBe(409);expect(response.body.code).toBe('resource_moved');
 }
 expect(calls).toEqual([]);
 expect((await request(app).post('/admin/lists/menus').send({name:'Other List'})).status).toBe(201);
 expect(calls).toEqual([['menus','other-list','h']]);
});
