import {describe,it,expect} from 'vitest';
import {ApprovalWorkflow} from '../../../../__app_modules/household/supervision/server/application/ApprovalWorkflow.mjs';
import {createApprovalTokenPrimitives} from '../../../../__app_modules/household/supervision/server/adapters/ApprovalTokenPrimitives.mjs';
import {SupervisionAccessGuard} from '../../../../__app_modules/household/supervision/server/application/SupervisionAccessGuard.mjs';
import {supervisionFixture,parent} from '../../../_fixtures/supervision/workflow.mjs';
const context={deviceId:'portal',learnerId:'user_5',activityId:'arcade:test',clientSessionId:'verified-browser'};
async function fixture(){
 const h=await supervisionFixture();await h.service.publishMode({required:true,observedAt:100000,expiresAt:160000});let id=0,eligible=true;const pushes=[];
 const workflow=new ApprovalWorkflow({...h,...createApprovalTokenPrimitives(),makeId:()=>`server-${++id}`,recipientId:'parent',notifier:{notify:async input=>{pushes.push(input);return {accepted:true};}},resolveActivity:async input=>({id:input.activityId,deviceId:input.deviceId}),baselineEligibility:async()=>({allowed:eligible})});
 const request=await workflow.requestPermission({context,idempotencyKey:'initial'});await workflow.decideRequest({requestId:request.id,decision:'approve',actor:parent,nonce:pushes[0].actions.approveNonce});
 const guard=new SupervisionAccessGuard({...h,approvalWorkflow:workflow});
 return {...h,workflow,request,guard,setEligible(value){eligible=value;},async consume(extra={}){return workflow.consumeGrant({requestId:request.id,context:{...context,...extra}});}};
}
describe('authoritative approved activity session',()=>{
 it('concurrent_consumption_binds_one_session; identical retries return the original',async()=>{
  const h=await fixture(),sessions=await Promise.all([h.consume(),h.consume(),h.consume()]);expect(new Set(sessions.map(value=>value.sessionId)).size).toBe(1);expect(sessions[0].expiresAt-100000).toBeLessThanOrEqual(600000);
  expect((await h.repository.read()).grants[h.request.id].sessionId).toBe(sessions[0].sessionId);
 });
 it('grant_cannot_follow_child_to_another_device_or_activity or authenticated browser',async()=>{
  const h=await fixture(),session=await h.consume();const valid={...context,requestId:h.request.id,sessionId:session.sessionId};
  expect(await h.guard.authorize(valid)).toMatchObject({epoch:0,expiresAt:105000});
  for(const change of [{deviceId:'garage'},{activityId:'arcade:other'},{learnerId:'someone-else'},{clientSessionId:'other-browser'},{sessionId:'child-selected'},{learnerId:undefined}])await expect(h.guard.authorize({...valid,...change})).rejects.toMatchObject({status:403});
  await expect(h.guard.authorize(context)).rejects.toMatchObject({status:403});
 });
 it('no optimistic consume or launch before grant publication ACK',async()=>{
  const h=await fixture();await h.repository.transaction(state=>{state.grants[h.request.id].publication='pending';});await expect(h.consume()).rejects.toMatchObject({status:403});
 });
 it('grant_expiry_ends_lease_and_activity without an extra five-second grace period',async()=>{
  const h=await fixture(),session=await h.consume(),bound={...context,requestId:h.request.id,sessionId:session.sessionId};
  h.setNow(699999);await h.service.publishMode({required:true,observedAt:699999,expiresAt:759999});expect(await h.guard.authorize(bound)).toMatchObject({expiresAt:700000});
  h.setNow(700000);await expect(h.guard.authorize(bound)).rejects.toMatchObject({status:403});await h.workflow.reconcile();expect((await h.repository.read()).grants[h.request.id].revokedAt).not.toBeNull();
 });
 it('approval_cannot_override_school_or_budget eligibility after permission was approved',async()=>{
  const h=await fixture(),session=await h.consume();h.setEligible(false);await expect(h.guard.authorize({...context,requestId:h.request.id,sessionId:session.sessionId})).rejects.toMatchObject({code:'SUPERVISION_BASELINE_DENIED'});
 });
 it('old epoch remains unusable after Stop and release even if a cached true grant exists',async()=>{
  const h=await fixture(),session=await h.consume();await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'stop'});await h.service.release({actor:parent,scopeId:'child-public',idempotencyKey:'release'});
  await expect(h.guard.authorize({...context,requestId:h.request.id,sessionId:session.sessionId})).rejects.toMatchObject({status:403});
 });
 it('explicit fresh normal mode preserves ordinary access without an approval context',async()=>{
  const h=await fixture();await h.service.publishMode({required:false,observedAt:100000,expiresAt:160000});expect(await h.guard.authorize({deviceId:'portal',activityId:'school:workspace'})).toMatchObject({epoch:0});
 });
});
it('DoNow cannot notify its private approval queue before mandatory activity admission',async()=>{
 const {DoNowService}=await import('../../../../__app_modules/household/donow/server/application/DoNowService.mjs');const h=await fixture();let writes=0,pushes=0;
 const service=new DoNowService({surfaces:new Map([['portal',{validateAction:()=>[],label:()=> 'Portal',occupancy:async()=>({state:'occupied',occupantId:'other-child'})}]]),datastore:{findPending:async()=>null,putPending:async()=>{writes++;}},notifier:{notify:async()=>{pushes++;}},dispatchAuthority:(_context,effect)=>h.guard.runAuthorized(context,effect),logger:{error(){},warn(){}}});
 await expect(service.dispatch({surface:'portal',action:{id:'arcade:test'},learnerId:'user_5'})).rejects.toMatchObject({status:403});expect(writes).toBe(0);expect(pushes).toBe(0);
});
it('consume API derives browser identity server-side and ignores a forged clientSessionId body',async()=>{
 const express=(await import('express')).default,request=(await import('supertest')).default;
 const {createSupervisionRouter}=await import('../../../../__app_modules/household/supervision/server/api/supervision.mjs');const h=await fixture();
 const app=express();app.use(express.json());app.use(createSupervisionRouter({service:h.service,guard:h.guard,workflow:h.workflow,clock:h.clock,authenticateKiosk:async()=>({deviceId:'portal',sessionId:'different-authenticated-browser'})}));
 await request(app).post(`/requests/${h.request.id}/consume`).send({...context,clientSessionId:'verified-browser'}).expect(403);
});
it('a School code belonging to another learner cannot borrow the selected learner grant',async()=>{
 const express=(await import('express')).default,request=(await import('supertest')).default;
 const {createSchoolSelfServiceRouter}=await import('../../../../__app_modules/learning/school/server/api/school.selfservice.mjs');const h=await fixture(),session=await h.consume();let effects=0;
 const bound={...context,requestId:h.request.id,sessionId:session.sessionId};const app=express();app.use(express.json());
 app.use(createSchoolSelfServiceRouter({resolveAccessCode:{execute:async()=>({ok:true,learner:'someone-else'})},runSelfServiceAction:{execute:async()=>{effects++;return {outcome:'done'};}},authorizeKioskAction:(req,actual={})=>h.guard.authorize({...bound,...actual})}));
 app.use((error,_req,res,_next)=>res.status(error.status??500).json({error:error.code}));
 await request(app).post('/act').send({code:'123456',action:'launch'}).expect(403);expect(effects).toBe(0);
});
it('opaque School session and companion IDs resolve their real learner before effects',async()=>{
 const express=(await import('express')).default,request=(await import('supertest')).default;
 const {createSchoolRouter}=await import('../../../../__app_modules/learning/school/server/api/school.mjs');const {createSchoolSelfServiceRouter}=await import('../../../../__app_modules/learning/school/server/api/school.selfservice.mjs');
 const h=await fixture(),session=await h.consume();let effects=0;const bound={...context,requestId:h.request.id,sessionId:session.sessionId};
 const authorizeKioskAction=(_req,actual={})=>h.guard.authorize({...bound,...actual});const app=express();app.use(express.json());
 app.use('/quiz',createSchoolRouter({schoolService:{sessionLearner:()=> 'someone-else',answer:()=>{effects++;return {};}},authorizeKioskAction}));
 app.use('/self',createSchoolSelfServiceRouter({authorizeKioskAction,resolveCompanionLearner:async()=> 'someone-else',recordLessonCompanionProgress:{execute:async()=>{effects++;return {};}}}));
 app.use((error,_req,res,_next)=>res.status(error.status??500).json({error:error.code}));
 await request(app).post('/quiz/sessions/bobs-session/answer').send({userId:'user_5',itemId:'one',given:'answer'}).expect(403);
 await request(app).post('/self/companions/bobs-companion/progress').send({learnerId:'user_5',completed:true}).expect(403);expect(effects).toBe(0);
});
it('a permitted high-alert activity does not open a second unbounded DoNow phone queue',async()=>{
 const {DoNowService}=await import('../../../../__app_modules/household/donow/server/application/DoNowService.mjs');const h=await fixture(),session=await h.consume();let writes=0,pushes=0;
 const bound={...context,requestId:h.request.id,sessionId:session.sessionId};
 const service=new DoNowService({surfaces:new Map([['portal',{validateAction:()=>[],label:()=> 'Portal',occupancy:async()=>({state:'occupied',occupantId:'other-child'})}]]),datastore:{findPending:async()=>null,putPending:async()=>{writes++;}},notifier:{notify:async()=>{pushes++;}},dispatchAuthority:(_context,effect)=>h.guard.runAuthorized(bound,effect),canRequestLegacyApproval:async()=> (await h.stateGates.decideActivity({deviceId:'portal'})).allowed,logger:{error(){},warn(){}}});
 expect((await service.dispatch({surface:'portal',action:{id:'arcade:test'},learnerId:'user_5'})).decision).toBe('denied');expect(writes).toBe(0);expect(pushes).toBe(0);
});
it('a queued legacy DoNow approval cannot resurrect after Stop and release',async()=>{
 const {DoNowService}=await import('../../../../__app_modules/household/donow/server/application/DoNowService.mjs');
 const {createDoNowSupervisionAuthority}=await import('../../../../__backend/src/5_composition/modules/supervision.mjs');
 const h=await fixture();await h.service.publishMode({required:false,observedAt:100000,expiresAt:160000});let pending,effects=0;
 const authority=createDoNowSupervisionAuthority({...h,configuration:{surface_devices:{portal:'portal'},surface_activities:{portal:'arcade:test'}}});
 const service=new DoNowService({surfaces:new Map([['portal',{validateAction:()=>[],label:()=> 'Portal',occupancy:async()=>({state:'occupied',occupantId:'other-child'}),dispatch:async()=>{effects++;return {dispatched:true};}}]]),datastore:{findPending:async()=>null,putPending:async value=>{pending=structuredClone(value);},appendDispatch:async()=>{}},dispatchAuthority:authority,logger:{error(){},warn(){}}});
 await service.dispatch({surface:'portal',action:{},learnerId:'user_5',accessContext:context});expect(pending.accessContext.admittedEpoch).toBe(0);
 await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'stop'});await h.service.release({actor:parent,scopeId:'child-public',idempotencyKey:'release'});
 await expect(service.dispatchApproved(pending)).rejects.toMatchObject({code:'SUPERVISION_EPOCH_REVOKED'});expect(effects).toBe(0);
});
it('normal-mode queued work rechecks its admitted epoch inside the dispatch fence',async()=>{
 const h=await fixture();await h.service.publishMode({required:false,observedAt:100000,expiresAt:160000});
 await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'stop'});await h.service.release({actor:parent,scopeId:'child-public',idempotencyKey:'release'});let effects=0;
 await expect(h.guard.runAuthorized({deviceId:'portal',activityId:'arcade:test',admittedEpoch:0},()=>{effects++;})).rejects.toMatchObject({code:'SUPERVISION_EPOCH_REVOKED'});expect(effects).toBe(0);
});
it('voluntary end revokes a consumed grant so profile switching cannot recover it',async()=>{
 const h=await fixture(),session=await h.consume();await h.workflow.endSession({requestId:h.request.id,context});
 expect((await h.repository.read()).grants[h.request.id].revokedAt).not.toBeNull();await expect(h.guard.authorize({...context,requestId:h.request.id,sessionId:session.sessionId})).rejects.toMatchObject({status:403});
 await expect(h.workflow.endSession({requestId:h.request.id,context:{...context,learnerId:'someone-else'}})).rejects.toMatchObject({status:403});
});
it('child status/catalog/request endpoints authenticate identity and strip private metadata',async()=>{
 const express=(await import('express')).default,http=(await import('supertest')).default;
 const {createSupervisionRouter}=await import('../../../../__app_modules/household/supervision/server/api/supervision.mjs');const h=await fixture();
 const app=express();app.use(express.json());app.use(createSupervisionRouter({service:h.service,workflow:h.workflow,clock:h.clock,authenticateKiosk:async req=>{if(!req.headers['x-test-kiosk'])throw Object.assign(Error('No kiosk'),{status:403});return {deviceId:'portal',sessionId:'verified-browser'};},getCatalog:async()=>({activities:[{id:'arcade:test',label:'Chess',path:'/games/chess',privateBalance:100}],learners:[{id:'user_5',label:'User_5',code:'secret'}],currentActivityId:'arcade:test'})}));
 await http(app).get('/catalog').expect(403);const catalog=await http(app).get('/catalog').set('x-test-kiosk','1').expect(200);expect(JSON.stringify(catalog.body)).not.toContain('secret');expect(JSON.stringify(catalog.body)).not.toContain('privateBalance');
 const response=await http(app).get(`/requests/${h.request.id}`).query(context).set('x-test-kiosk','1').expect(200);expect(response.body.status).toBe('approved');expect(response.body.actions).toBeUndefined();expect(response.body.clientSessionId).toBeUndefined();
 await http(app).post(`/requests/${h.request.id}/end`).set('x-test-kiosk','1').send({...context,learnerId:'someone-else'}).expect(403);
});
