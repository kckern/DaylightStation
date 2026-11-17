import {describe,it,expect,vi} from 'vitest';
import {PortalKeysLockdownAdapter} from '../../../__backend/src/1_adapters/devices/PortalKeysLockdownAdapter.mjs';
import {ShutdownService} from '../../../__backend/src/3_applications/shutdown/ShutdownService.mjs';
import express from 'express';
import request from 'supertest';
import {createSupervisionRuntime} from '../../../__backend/src/5_composition/modules/supervision.mjs';
import {supervisionFixture,parent} from '../../_fixtures/supervision/workflow.mjs';
const credentials={secret:'s'.repeat(48),devices:{portal:{credential:'p'.repeat(48)},garage:{credential:'g'.repeat(48)}}};
const configuration={enabled:true,scope_id:'child-public',scopes:{'child-public':['portal','garage']},garage_device_id:'garage',devices:[{id:'portal',required_capabilities:['browser','portal-keys']},{id:'garage',required_capabilities:['browser']}]};
async function setup(extra={}){
 const h=await supervisionFixture();const runtime=await createSupervisionRuntime({...h,configuration,credentials,householdId:'home',makeId:()=>crypto.randomUUID(),verifyParentCredentials:async()=>parent,authenticateParent:async()=>parent,consumers:[{deviceId:'portal',capability:'portal-keys',capabilities:['portal-keys'],stop:async()=>({blocked:true}),release:async()=>({blocked:false})}],...extra});
 const app=express();app.use(express.json());app.use('/api/v1/supervision',runtime.router);return {...h,runtime,app};
}
describe('production supervision composition',()=>{
 it('an old bundle cannot activate a configured kiosk, while a registered framework can',async()=>{
  const h=await setup();await h.runtime.reconciler.reconcile();expect((await h.runtime.health()).activationAllowed).toBe(false);
  const {token}=await h.runtime.kiosk.issue({deviceId:'portal',credential:credentials.devices.portal.credential});
  await request(h.app).post('/api/v1/supervision/consumer-ack').set('x-kiosk-session',token).send({protocol:2,blocked:true,commandRevision:(await request(h.app).get('/api/v1/supervision/bootstrap').set('x-kiosk-session',token)).body.commandRevision}).expect(200);
  await h.runtime.reconciler.reconcile();expect(await h.runtime.guard.authorize({deviceId:'portal',activityId:'school:workspace'})).toMatchObject({epoch:0});h.runtime.dispose();
 });
 it('an unknown required capability is visibly missing and denies ordinary access',async()=>{
  const h=await setup({consumers:[]});expect((await h.runtime.health()).missing).toContainEqual({deviceId:'portal',capability:'portal-keys'});
  await expect(h.runtime.guard.authorize({deviceId:'portal',activityId:'school:workspace'})).rejects.toMatchObject({status:403});h.runtime.dispose();
 });
 it('removing configuration cannot turn a persisted stop into disabled bootstrap',async()=>{
  const h=await setup();await h.runtime.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'persist'});h.runtime.dispose();
  const next=await createSupervisionRuntime({...h,configuration:null,credentials,householdId:'home',makeId:()=>crypto.randomUUID(),verifyParentCredentials:async()=>parent});
  expect(next.enabled).toBe(true);expect(await next.service.status({deviceId:'portal'})).toMatchObject({active:true});next.dispose();
 });
 it('retains persisted configuration before the first device state is written',async()=>{
  const h=await supervisionFixture();
  await h.repository.transaction(state=>{state.devices={};state.revisions={};state.outbox=[];state.configuration=configuration;});
  const runtime=await createSupervisionRuntime({...h,configuration:null,credentials,householdId:'home'});
  expect(runtime.enabled).toBe(true);runtime.dispose();
 });
 it('migrates real Unix-second fitness locks before first false publication',async()=>{
  const h=await supervisionFixture();await h.repository.transaction(state=>{state.devices={};state.revisions={};state.outbox=[];});
  const runtime=await createSupervisionRuntime({...h,configuration,credentials,householdId:'home',makeId:()=>crypto.randomUUID(),legacy:{fitness:{lockedUntil:200}}});
  expect(await runtime.service.status({deviceId:'portal'})).toMatchObject({active:true});runtime.dispose();
 });
 it('never-configured bootstrap explicitly preserves legacy mode',async()=>{
  const h=await supervisionFixture();await h.repository.transaction(state=>{state.devices={};state.revisions={};state.outbox=[];});
  const runtime=await createSupervisionRuntime({...h,configuration:null,householdId:'home'});const app=express();app.use(runtime.router);
  expect((await request(app).get('/bootstrap')).body).toEqual({enabled:false});expect(runtime.enabled).toBe(false);
 });
});
it('parent pairing creates only device cookies and renewal never grants parent authority',async()=>{
 const h=await setup();const pair=await request(h.app).post('/api/v1/supervision/enroll').send({username:'parent',password:'verified',deviceId:'portal'}).expect(200);
 const cookies=pair.headers['set-cookie'];expect(cookies).toHaveLength(2);expect(cookies.every(cookie=>cookie.includes('HttpOnly') && cookie.includes('SameSite=Strict'))).toBe(true);expect(cookies.some(cookie=>cookie.startsWith('daylight_session='))).toBe(false);
 const cookie=cookies.map(value=>value.split(';')[0]).join('; ');expect((await request(h.app).get('/api/v1/supervision/bootstrap').set('Cookie',cookie)).body).toMatchObject({enabled:true,deviceId:'portal'});h.runtime.dispose();
});
it('registers the real config-loader path rather than an inert flat config file',async()=>{
 const {appConfigRelPath}=await import('../../../shared/contracts/householdConfig.mjs');expect(appConfigRelPath('supervision')).toBe('supervision/config');
});
it('renews an expired short session through device provisioning without adult credentials',async()=>{
 const h=await setup();const pair=await request(h.app).post('/api/v1/supervision/enroll').send({username:'parent',password:'verified',deviceId:'portal'}).expect(200);
 const cookies=pair.headers['set-cookie'].map(value=>value.split(';')[0]);h.setNow(701000);
 await request(h.app).get('/api/v1/supervision/access?activityId=school:workspace').set('Cookie',cookies[1]).expect(403);
 const bootstrap=await request(h.app).get('/api/v1/supervision/bootstrap').set('Cookie',cookies[0]).expect(200);expect(bootstrap.body.deviceId).toBe('portal');expect(bootstrap.headers['set-cookie'][0]).toContain('daylight_kiosk=');h.runtime.dispose();
});
it('a failed parent verification cannot pair or accept a forged actor body',async()=>{
 const h=await setup({verifyParentCredentials:async()=>null});await request(h.app).post('/api/v1/supervision/enroll').send({username:'child',password:'bad',deviceId:'portal',actor:parent}).expect(403);h.runtime.dispose();
});
it('malformed but parseable legacy lock records migrate as blocked',async()=>{
 const {readLegacyStops}=await import('../../../__app_modules/household/supervision/server/index.mjs');
 const legacy=readLegacyStops({configService:{getHouseholdPath:name=>name},load:()=>({lockedBy:'user_9'})});expect(legacy.invalid).toBe(true);
});

it('configured and legacy auth refs reach their own consumers',async()=>{
 const fixtureSecret='configured-portal-secret',legacySecret='legacy-portal-secret',requests=[];
 const fetchFn=vi.fn(async(url,request)=>{
  const body=JSON.parse(request.body);requests.push({url,...request});
  return {ok:true,json:async()=>({lockdownActive:body.locked,lockdownProtocolVersion:2,lockdownRevision:body.revision})};
 });
 vi.stubGlobal('fetch',fetchFn);
 let runtime;
 try{
  const h=await supervisionFixture();
  const authLookups=[];
  const configService={
   getHouseholdDevices:()=>({devices:{}}),getHouseholdPath:name=>name,
   getHouseholdAuth:(ref,householdId)=>{authLookups.push([ref,householdId]);return ref==='configured-portal'?{token:fixtureSecret}:ref==='legacy-portal'?legacySecret:null;},
  };
  const configured={enabled:true,scopes:{'child-public':['portal']},devices:[{id:'portal',required_capabilities:['portal-keys'],portal_keys:{base_url:'http://configured.test:8771/',auth_ref:'configured-portal'}}]};
  runtime=await createSupervisionRuntime({...h,configuration:configured,credentials,configService,householdId:'home',legacy:{}});
  await runtime.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'auth-ref'});
  await runtime.reconciler.reconcile();
  const nativeRequest=requests.find(value=>value.url==='http://configured.test:8771/lockdown' && JSON.parse(value.body).locked);
  expect(nativeRequest.headers['X-Lockdown-Token']).toBe(fixtureSecret);
  expect((await runtime.health()).consumers).toContainEqual(expect.objectContaining({deviceId:'portal',capability:'portal-keys',acknowledged:true,blocked:true}));
  expect(authLookups).toContainEqual(['configured-portal','home']);

  // app.mjs already builds this legacy boundary independently when supervision is disabled.
  const legacyConfig={duration_seconds:1800,portal_keys:{base_url:'http://legacy.test:8771',auth_ref:'legacy-portal'}};
  const auth=configService.getHouseholdAuth(legacyConfig.portal_keys.auth_ref,'home');
  const portal=new PortalKeysLockdownAdapter({baseUrl:legacyConfig.portal_keys.base_url,token:typeof auth==='string'?auth:auth?.token,fetchFn,logger:{info(){}}});
  const legacyFixture=await supervisionFixture();
  await legacyFixture.repository.transaction(state=>{state.devices={};state.revisions={};state.outbox=[];});
  const disabledRuntime=await createSupervisionRuntime({...legacyFixture,configuration:null,householdId:'home'});
  expect(disabledRuntime.enabled).toBe(false);
  let saved=null,legacyRuntimeDelegatedToSupervision=false;
  const legacyRuntime=new ShutdownService({
   repo:{read:async()=>({state:saved,invalid:false}),save:async state=>{saved=state;}},
   notifier:{publishState(){}},getPolicy:()=>({durationSeconds:legacyConfig.duration_seconds,targets:['school:portal']}),portal,
   supervision:disabledRuntime.enabled?{activate:async()=>{legacyRuntimeDelegatedToSupervision=true;}}:null,logger:{warn(){}},
  });
  const state=await legacyRuntime.activate({readerId:'reader',tagUid:'fixture',now:1000});
  expect(legacyRuntimeDelegatedToSupervision).toBe(false);
  expect(state.lockedUntil).toBe('1970-01-01T00:30:01.000Z');
  const legacyRequest=requests.find(value=>value.url==='http://legacy.test:8771/lockdown');
  expect(legacyRequest.headers['X-Lockdown-Token']).toBe(legacySecret);
  expect(JSON.parse(legacyRequest.body)).toEqual({locked:true,lockedUntil:1801000});
  expect(authLookups).toContainEqual(['legacy-portal','home']);
  await legacyRuntime.reconcile(1801001);
  expect(await legacyRuntime.status('school:portal',1801001)).toMatchObject({locked:false});
  expect(JSON.parse(requests.at(-1).body)).toEqual({locked:false,lockedUntil:null});
 }finally{runtime?.dispose();vi.unstubAllGlobals();}
});
it('reports and alerts for every absent required consumer using the configured parent recipient',async()=>{
 let now=100000;const intents=[];
 const h=await setup({clock:{now:()=>now},monotonicNow:()=>now,consumers:[],configuration:{...configuration,enforcement_alerts:{recipient_id:'configured-parent'}},notificationService:{send:async intent=>{intents.push(intent);return [{channel:'push',accepted:true,delivered:null}];}}});
 try{
  await h.runtime.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'missing'});await h.runtime.reconciler.reconcile();
  expect((await h.runtime.health()).consumers).toContainEqual(expect.objectContaining({deviceId:'portal',capability:'portal-keys',acknowledged:false,error:'CAPABILITY_UNAVAILABLE'}));
  now+=5000;await h.runtime.reconciler.reconcile();
  expect(intents).toContainEqual(expect.objectContaining({metadata:expect.objectContaining({username:'configured-parent',deviceId:'portal',capability:'portal-keys',deliveryRequired:'push'})}));
  expect((await h.runtime.health()).incidents.some(incident=>incident.alert.status==='accepted')).toBe(true);
 }finally{h.runtime.dispose();}
});
it.each(['selected-parent',null])('scopes fallback incident recipients to the runtime household (selected head: %s)',async selectedHead=>{
 let now=100000;const intents=[],lookups=[];
 const h=await setup({householdId:'selected-house',legacy:{},clock:{now:()=>now},monotonicNow:()=>now,consumers:[],configService:{getHeadOfHousehold:id=>{lookups.push(id);return id==='selected-house'?selectedHead:'default-parent';}},notificationService:{send:async intent=>{intents.push(intent);return [{channel:'push',accepted:true,delivered:null}];}}});
 try{
  await h.runtime.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'scoped-recipient'});await h.runtime.reconciler.reconcile();now+=5000;await h.runtime.reconciler.reconcile();
  expect(lookups.length).toBeGreaterThan(0);expect(lookups.every(id=>id==='selected-house')).toBe(true);
  if(selectedHead){expect(intents.length).toBeGreaterThan(0);expect(intents.every(intent=>intent.metadata.username===selectedHead)).toBe(true);}
  else{expect(intents).toHaveLength(0);expect((await h.runtime.health()).incidents.some(incident=>incident.alert.status==='failed')).toBe(true);}
 }finally{h.runtime.dispose();}
});
