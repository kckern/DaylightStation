import {describe,it,expect} from 'vitest';
import express from 'express';
import request from 'supertest';
import {errorHandlerMiddleware} from '../../../__backend/src/0_system/http/middleware/index.mjs';
import {createSchoolRouter} from '../../../__app_modules/learning/school/server/api/school.mjs';
import {createArcadeGameSessionsRouter} from '../../../__app_modules/games/arcade/server/api/arcadeGameSessions.mjs';
import {createSchoolSelfServiceRouter} from '../../../__app_modules/learning/school/server/api/school.selfservice.mjs';
import {createLaunchRouter} from '../../../__backend/src/4_api/v1/routers/launch.mjs';
import {validateConsumerManifest} from '../../../__app_modules/household/supervision/server/application/ConsumerManifest.mjs';
import {createSupervisedIngress} from '../../../__app_modules/household/supervision/server/api/ingress.mjs';
import {SupervisionAccessGuard} from '../../../__app_modules/household/supervision/server/application/SupervisionAccessGuard.mjs';
import {supervisionFixture,parent} from '../../_fixtures/supervision/workflow.mjs';
describe('supervision ingress coverage',()=>{
 it.each(['/resolve','/act'])('school code/action ingress %s cannot bypass Stop',async route=>{
  const h=await supervisionFixture();const guard=new SupervisionAccessGuard(h);let effects=0;
  const authorize=createSupervisedIngress({guard,resolveContext:async()=>({deviceId:'portal',activityId:'school:self-service'})});
  const app=express();app.use(express.json());app.use(createSchoolSelfServiceRouter({resolveAccessCode:{execute:async()=>{effects++;return {ok:true};}},runSelfServiceAction:{execute:async()=>{effects++;return {outcome:'opened'};}},authorizeKioskAction:authorize}));app.use(errorHandlerMiddleware({shape:'string'}));
  await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'s'});
  expect((await request(app).post(route).send({code:'123456',deviceId:'garage'})).status).toBe(403);expect(effects).toBe(0);
 });
 it('launch router preserves permission refusal on both launch and intent paths',async()=>{
  const deny=()=>{throw Object.assign(Error('blocked'),{code:'SUPERVISION_BLOCKED',status:403});};
  const app=express();app.use(express.json());app.use(createLaunchRouter({launchService:{launch:deny,resolveIntent:deny},resolveAccessContext:async()=>({deviceId:'portal',activityId:'arcade:test'}),logger:{error(){}}}));
  expect((await request(app).post('/').send({contentId:'arcade:test'})).status).toBe(403);
  expect((await request(app).get('/intent/arcade:test')).status).toBe(403);
 });
});

it.each([['get','/banks'],['post','/print/render']])('stopped school %s %s refuses before bank or print effects',async(method,path)=>{
 const h=await supervisionFixture();const guard=new SupervisionAccessGuard(h);let effects=0;
 const authorize=createSupervisedIngress({guard,resolveContext:async()=>({deviceId:'portal',activityId:'school:workspace'})});
 const app=express();app.use(express.json());app.use(createSchoolRouter({schoolApiSessions:{listBanks:async()=>{effects++;return []; }},authorizeKioskAction:authorize}));app.use(errorHandlerMiddleware({shape:'string'}));
 await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'s'});
 expect((await request(app)[method](path).send({})).status).toBe(403);expect(effects).toBe(0);
});
it('real arcade eligibility route cannot take its missing-probe fail-open fallback while stopped',async()=>{
 const h=await supervisionFixture();const guard=new SupervisionAccessGuard(h);
 const authorize=createSupervisedIngress({guard,resolveContext:async()=>({deviceId:'portal',activityId:'arcade:test'})});
 const app=express();app.use(createArcadeGameSessionsRouter({authorizeKioskAction:authorize,logger:{error(){}}}));
 await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'s'});
 expect((await request(app).get('/eligibility?deviceId=portal&contentId=arcade:test')).status).toBe(403);
});

it('activation requires each configured consumer capability, not just matching device names',()=>{
 const devices=[{id:'portal',requiredCapabilities:['browser','portal-keys']},{id:'garage',requiredCapabilities:['browser','native']}];
 expect(validateConsumerManifest({devices,consumers:[{deviceId:'portal',capabilities:['browser']}]})).toMatchObject({activationAllowed:false,missing:expect.arrayContaining([{deviceId:'portal',capability:'portal-keys'},{deviceId:'garage',capability:'browser'},{deviceId:'garage',capability:'native'}])});
 expect(validateConsumerManifest({devices,consumers:[{deviceId:'portal',capabilities:['browser','portal-keys']},{deviceId:'garage',capabilities:['browser','native']}]})).toMatchObject({activationAllowed:true,missing:[]});
});
it.each([['get','/banks'],['post','/print/render']])('approval-required school %s %s denies without a consumed occurrence',async(method,path)=>{
 const h=await supervisionFixture();await h.service.publishMode({required:true,observedAt:100000,expiresAt:160000});
 const guard=new SupervisionAccessGuard({...h,approvalWorkflow:{contextForPermit:async()=>{throw Error('No bound session');}}});let effects=0;
 const authorize=createSupervisedIngress({guard,resolveContext:async()=>({deviceId:'portal',activityId:'school:workspace'})});
 const app=express();app.use(express.json());app.use(createSchoolRouter({schoolApiSessions:{listBanks:async()=>{effects++;return [];}},authorizeKioskAction:authorize}));app.use(errorHandlerMiddleware({shape:'string'}));
 expect((await request(app)[method](path).send({approved:true,learnerId:'user_5',sessionId:'invented'})).status).toBe(403);expect(effects).toBe(0);
});
