import {describe,it,expect} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createSupervisionRouter} from '../../../../__app_modules/household/supervision/server/api/supervision.mjs';
import {ShutdownService} from '../../../../__backend/src/3_applications/shutdown/ShutdownService.mjs';
import {createNfcTapIngress} from '../../../../__backend/src/3_applications/scan/NfcTapIngress.mjs';
describe('parent ingress',()=>{
 it('rejects fabricated parent bodies and delegates only authenticated parent commands',async()=>{
  let active=false;
  const service={stop:async()=>{active=true;return {active,epoch:1};},release:async()=>{active=false;return {active,epoch:1};},status:async()=>({active,epoch:1})};
  const app=express();app.use(express.json());app.use(createSupervisionRouter({service,scopeId:'child-public',authenticateParent:req=>req.get('Authorization')==='Bearer verified-parent'?{id:'parent',roles:['guardian'],authenticatedBy:'verified-token'}:null,authenticateKiosk:()=>({deviceId:'portal'}),makeId:()=> 'operation'}));
  expect((await request(app).post('/stop').send({actor:{id:'parent',roles:['owner'],authenticatedBy:'token'}})).status).toBe(403);expect(active).toBe(false);
  expect((await request(app).post('/stop').set('Authorization','Bearer verified-parent').send({})).status).toBe(200);expect(active).toBe(true);
  expect((await request(app).post('/release').send({})).status).toBe(403);expect(active).toBe(true);
 });
 it('trusted NFC delegates to durable stop rather than a timed legacy lock',async()=>{
  let active=false;const service=new ShutdownService({repo:{read:async()=>({state:null})},notifier:{publishState(){}},getPolicy:()=>({targets:['school:portal']}),supervision:{activate:async()=>{active=true;return {lockedUntil:null};},status:async()=>({locked:active,lockedUntil:null}),reconcile:async()=>{}}});
  const ingress=createNfcTapIngress({tapSource:{observe:()=>()=>{}},shutdownService:service,getShutdownCommand:()=>({tagUid:'ABCD',readerId:'reader'}),logger:{info(){}}});
  expect(await ingress.handleTap({id:'reader',uid:'ABCD'})).toMatchObject({status:'shutdown_locked'});
  expect(await service.status('school:portal',999999999)).toMatchObject({locked:true,lockedUntil:null});
 });
});
it('one-command parent verification does not trust a claimed role or leave a login session',async()=>{
 let active=true;
 const app=express();app.use(express.json());app.use(createSupervisionRouter({service:{release:async()=>{active=false;return {active,epoch:2};}},scopeId:'child-public',makeId:()=> 'release1',authenticateParent:()=>null,authenticateKiosk:()=>({deviceId:'portal'}),verifyParentCredentials:async({username,password})=>username==='parent' && password==='verified-password'?{id:'parent',roles:['guardian'],authenticatedBy:'password-verification'}:null}));
 const denied=await request(app).post('/parent-command').send({action:'release',username:'parent',password:'wrong',roles:['owner']});expect(denied.status).toBe(403);expect(active).toBe(true);
 const released=await request(app).post('/parent-command').send({action:'release',username:'parent',password:'verified-password'});expect(released.status).toBe(200);expect(active).toBe(false);expect(released.headers['set-cookie']).toBeUndefined();
});
it('access returns a canonical denial as ordinary state and bounds every successful lease',async()=>{
 let denied=true;
 const app=express();app.use(createSupervisionRouter({service:{status:async()=>({active:denied,epoch:1})},scopeId:'child-public',authenticateParent:()=>null,authenticateKiosk:()=>({deviceId:'portal'}),guard:{authorize:async()=>{if(denied)throw Object.assign(Error('blocked'),{status:403,code:'SUPERVISION_BLOCKED'});return {decisionId:'d',epoch:1,expiresAt:105000};}},clock:{now:()=>100000},getBootstrap:async()=>({enabled:true,deviceId:'portal'}),makeId:()=> 'id'}));
 expect((await request(app).get('/access?activityId=school:workspace')).body).toMatchObject({allowed:false,reason:'SUPERVISION_BLOCKED'});
 denied=false;expect((await request(app).get('/access?activityId=school:workspace')).body).toMatchObject({allowed:true,epoch:1,issuedAt:100000,expiresAt:105000});
});
it('a never-configured installation explicitly preserves the existing kiosk experience',async()=>{
 const {createDisabledSupervisionRouter}=await import('../../../../__app_modules/household/supervision/server/api/supervision.mjs');
 const app=express();app.use(createDisabledSupervisionRouter());
 expect((await request(app).get('/bootstrap')).body).toEqual({enabled:false});
});
