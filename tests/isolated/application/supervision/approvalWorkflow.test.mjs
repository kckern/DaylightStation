import {afterEach,describe,it,expect} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApprovalTokenPrimitives} from '../../../../__app_modules/household/supervision/server/adapters/ApprovalTokenPrimitives.mjs';
import {ApprovalWorkflow} from '../../../../__app_modules/household/supervision/server/application/ApprovalWorkflow.mjs';
import {SupervisionService} from '../../../../__app_modules/household/supervision/server/application/SupervisionService.mjs';
import {JsonSupervisionRepository} from '../../../../__app_modules/household/supervision/server/adapters/JsonSupervisionRepository.mjs';
import {supervisionFixture,parent} from '../../../_fixtures/supervision/workflow.mjs';
const clean=[];afterEach(async()=>{for(const fn of clean.splice(0).reverse())await fn();});
const context={deviceId:'portal',learnerId:'user_5',activityId:'arcade:test',clientSessionId:'authenticated-browser-1'};
async function makeHarness(){
 const h=await supervisionFixture(),dir=await mkdtemp(join(tmpdir(),'supervision-approval-')),path=join(dir,'current.json');let repository=new JsonSupervisionRepository({path});
 clean.push(()=>rm(dir,{recursive:true,force:true}));clean.push(()=>repository.close());
 const realPublish=h.stateGates.publishGrant.bind(h.stateGates);let publishFailure=false,notifyFailure=false,eligible=true,eligibilityEffect=null,ids=0;
 h.stateGates.publishGrant=payload=>publishFailure?Promise.reject(Error('projection offline')):realPublish(payload);
 let service=new SupervisionService({...h,repository,scopes:{'child-public':['portal','garage']}});await service.initialize();await service.publishMode({required:true,observedAt:100000,expiresAt:160000});
 const pushes=[];const options={...createApprovalTokenPrimitives(),clock:h.clock,stateGates:h.stateGates,makeId:()=>`request-${++ids}`,recipientId:'parent-phone',makeNonce:()=>`opaque-${++ids}-${'x'.repeat(43)}`,resolveActivity:async input=>({id:input.activityId,deviceId:input.deviceId,label:'Test game'}),baselineEligibility:async()=>{eligibilityEffect?.();return {allowed:eligible};},notifier:{notify:async value=>{pushes.push(value);if(notifyFailure)throw Error('phone offline');return {accepted:true};}}};
 let workflow=new ApprovalWorkflow({...options,repository,service});
 return {...h,path,pushes,get service(){return service;},get repository(){return repository;},get workflow(){return workflow;},setPublishFailure(value){publishFailure=value;},setNotifyFailure(value){notifyFailure=value;},setEligible(value){eligible=value;},setEligibilityEffect(fn){eligibilityEffect=fn;},async request(input=context,key=`key-${++ids}`){return workflow.requestPermission({context:input,idempotencyKey:key});},async approve(request,actor=parent){const push=pushes.findLast(push=>push.request.id===request.id);return workflow.decideRequest({requestId:request.id,decision:'approve',actor,nonce:push.actions.approveNonce});},async restart(){await repository.close();repository=new JsonSupervisionRepository({path});service=new SupervisionService({...h,repository,scopes:{'child-public':['portal','garage']}});await service.initialize();workflow=new ApprovalWorkflow({...options,repository,service});}};
}
describe('durable scoped approval workflow',()=>{
 it('two_parent_decisions_create_only_one_grant and retries keep the first outcome',async()=>{
  const h=await makeHarness(),request=await h.request();const push=h.pushes[0];
  const results=await Promise.all([h.approve(request),h.workflow.decideRequest({requestId:request.id,decision:'deny',actor:{...parent,id:'other-parent'},nonce:push.actions.denyNonce})]);
  expect(results.map(value=>value.status)).toEqual(['approved','approved']);const state=await h.repository.read();expect(Object.keys(state.grants)).toEqual([request.id]);expect(state.grants[request.id]).toMatchObject({publication:'acknowledged',sessionId:null});
 });
 it('stop_invalidates_pending_and_approved_before_release in both race orderings',async()=>{
  const h=await makeHarness(),approved=await h.request(),pending=await h.request({...context,deviceId:'garage'});await h.approve(approved);
  h.setPublishFailure(true);await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'stop'});await h.service.release({actor:parent,scopeId:'child-public',idempotencyKey:'release'});
  const state=await h.repository.read();expect(state.requests[pending.id].status).toBe('revoked');expect(state.grants[approved.id].revokedAt).not.toBeNull();expect(await h.service.status({deviceId:'portal'})).toMatchObject({active:true});
  await expect(h.approve(pending)).rejects.toMatchObject({status:403});h.setPublishFailure(false);await h.workflow.reconcile();expect(await h.service.status({deviceId:'portal'})).toMatchObject({active:false});
 });
 it('stop accepted before approve cannot create any grant',async()=>{const h=await makeHarness(),request=await h.request();await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'stop-first'});await expect(h.approve(request)).rejects.toMatchObject({status:403});expect(Object.keys((await h.repository.read()).grants)).toHaveLength(0);});
 it('restart_preserves_terminal_outcome and expires unanswered requests',async()=>{
  const h=await makeHarness(),approved=await h.request(),pending=await h.request({...context,deviceId:'garage'});await h.approve(approved);await h.restart();expect((await h.repository.read()).requests[approved.id].status).toBe('approved');
  h.setNow(220001);await h.workflow.reconcile();expect((await h.repository.read()).requests[pending.id].status).toBe('expired');
 });
 it('duplicate_or_rate_limited_requests_do_not_notify; cooldown and rolling limit cross devices',async()=>{
  const h=await makeHarness(),first=await h.request();expect((await h.request()).id).toBe(first.id);expect(h.pushes).toHaveLength(1);
  await expect(h.request({...context,activityId:'arcade:other'})).rejects.toMatchObject({code:'SUPERVISION_REQUEST_PENDING'});
  await h.workflow.cancelRequest({requestId:first.id,context});await expect(h.request({...context,deviceId:'garage'})).rejects.toMatchObject({code:'SUPERVISION_REQUEST_COOLDOWN'});
  h.setNow(130001);const second=await h.request({...context,deviceId:'garage'});await h.workflow.cancelRequest({requestId:second.id,context:{...context,deviceId:'garage'}});
  h.setNow(160002);const third=await h.request();await h.workflow.cancelRequest({requestId:third.id,context});h.setNow(190003);
  await expect(h.request({...context,deviceId:'garage'})).rejects.toMatchObject({code:'SUPERVISION_REQUEST_RATE_LIMITED'});expect(h.pushes).toHaveLength(3);
 });
 it('notification retries replace authority and never persist or expose plaintext nonces',async()=>{
  const h=await makeHarness();h.setNotifyFailure(true);const request=await h.request();const old=h.pushes[0].actions.approveNonce;expect(JSON.stringify(request)).not.toContain(old);expect(await readFile(h.path,'utf8')).not.toContain(old);
  h.setNotifyFailure(false);h.setNow(102001);await h.workflow.reconcile();expect(h.pushes).toHaveLength(2);expect(h.pushes[1].actions.approveNonce).not.toBe(old);
  await expect(h.workflow.decideRequest({requestId:request.id,decision:'approve',actor:parent,nonce:old})).rejects.toMatchObject({status:403});expect((await h.approve(request)).status).toBe('approved');
 });
 it('baseline denial remains denied on approval, and publication failure never creates usable authority',async()=>{
  const h=await makeHarness(),request=await h.request();h.setEligible(false);await expect(h.approve(request)).rejects.toMatchObject({code:'SUPERVISION_BASELINE_DENIED'});expect(Object.keys((await h.repository.read()).grants)).toHaveLength(0);
  h.setEligible(true);h.setPublishFailure(true);await h.approve(request);expect((await h.repository.read()).grants[request.id].publication).toBe('pending');
 });
});
it('corrupt durable grant scope fails closed instead of borrowing another learner approval',async()=>{
 const h=await makeHarness(),request=await h.request();await h.approve(request);
 await expect(h.repository.transaction(state=>{state.grants[request.id].learnerId='another-child';})).rejects.toThrow();
 expect((await h.repository.read()).grants[request.id].learnerId).toBe('user_5');
});

it('request expiry is rechecked after owner eligibility work and before committing a grant',async()=>{
 const h=await makeHarness(),request=await h.request();h.setEligibilityEffect(()=>h.setNow(220001));
 expect((await h.approve(request)).status).toBe('expired');expect(Object.keys((await h.repository.read()).grants)).toHaveLength(0);
});
it('restart expiry keeps the original deadline instead of inventing a new cooldown',async()=>{
 const h=await makeHarness(),request=await h.request();h.setNow(400000);await h.restart();await h.workflow.reconcile();
 expect((await h.repository.read()).requests[request.id].decidedAt).toBe(220000);expect((await h.request()).status).toBe('pending');
});
