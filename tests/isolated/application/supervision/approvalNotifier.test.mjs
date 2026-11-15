import {describe,it,expect} from 'vitest';
import express from 'express';
import request from 'supertest';
import {HaApprovalNotifier} from '../../../../__app_modules/household/supervision/server/adapters/HaApprovalNotifier.mjs';
import {ApprovalCallbackAuthority} from '../../../../__app_modules/household/supervision/server/adapters/ApprovalCallbackAuthority.mjs';
import {ApprovalWorkflow} from '../../../../__app_modules/household/supervision/server/application/ApprovalWorkflow.mjs';
import {createApprovalTokenPrimitives} from '../../../../__app_modules/household/supervision/server/adapters/ApprovalTokenPrimitives.mjs';
import {createSupervisionRouter} from '../../../../__app_modules/household/supervision/server/api/supervision.mjs';
import {HomeAssistantAdapter} from '../../../../__capabilities/home-control/server/adapters/homeassistant/HomeAssistantAdapter.mjs';
import {CallHomeAssistantService} from '../../../../__capabilities/home-control/server/application/CallHomeAssistantService.mjs';
import {findPushTextDefects} from '../../../../__backend/src/2_domains/notification/push/pushText.mjs';
import {supervisionFixture,parent} from '../../../_fixtures/supervision/workflow.mjs';
const secret='callback-secret-with-at-least-32-characters',context={deviceId:'portal',learnerId:'user_5',activityId:'arcade:test',clientSessionId:'verified-browser'};
async function fixture(){
 const h=await supervisionFixture();await h.service.publishMode({required:true,observedAt:100000,expiresAt:160000});let id=0,fail=false;const wire=[],logs=[];
 const logger=Object.fromEntries(['debug','info','warn','error'].map(level=>[level,(event,data)=>logs.push({level,event,data})]));
 const gateway=new HomeAssistantAdapter({baseUrl:'http://ha.test',token:'ha-secret'},{httpClient:{post:async(_url,data)=>{wire.push(data);if(fail)throw Error('HA rejected '+data.data?.actions?.[0]?.action);return {data:[]};}},logger});
 const callHomeAssistant=new CallHomeAssistantService({haGateway:gateway,logger});
 const notifier=new HaApprovalNotifier({callHomeAssistant,notifyService:'notify.mobile_app_parent_phone',recipientId:'parents',clock:h.clock,learnerName:()=> 'User_5',deviceName:()=> 'School Portal',logger});
 const workflow=new ApprovalWorkflow({...h,...createApprovalTokenPrimitives(),makeId:()=>`request-${++id}`,recipientId:'parents',notifier,resolveActivity:async input=>({id:input.activityId,deviceId:input.deviceId,label:'Chess'}),baselineEligibility:async()=>({allowed:true}),logger});
 const callbackAuthority=new ApprovalCallbackAuthority({credential:secret,recipientId:'parents',principalId:'home-assistant-supervision',lookupAction:input=>workflow.findAction(input)});
 const app=express();app.use(express.json());app.use(createSupervisionRouter({...h,workflow,callbackAuthority,authenticateParent:async req=>req.headers.authorization==='Bearer real-parent-session'?parent:null}));
 const pending=await workflow.requestPermission({context,idempotencyKey:'one'});
 return {...h,workflow,app,pending,wire,logs,setFailure(value){fail=value;},async callback(action,credentials=secret,extra={}){const call=request(app).post('/approval-callback');if(credentials)call.set('Authorization',`Bearer ${credentials}`);return call.send({action,...extra});}};
}
describe('authenticated parent phone actions',()=>{
 it('missing_auth_forged_parent_or_replayed_nonce_cannot_decide again',async()=>{
  const h=await fixture(),action=h.wire[0].data.actions[0].action;
  expect((await h.callback(action,null,{parentId:'user_9',actor:parent})).status).toBe(403);expect((await h.callback(action,'wrong')).status).toBe(403);
  expect((await h.callback(action,secret,{decision:'deny',parentId:'user_9'})).body.status).toBe('approved');expect((await h.callback(action)).body.status).toBe('approved');
  const state=await h.repository.read();expect(Object.keys(state.grants)).toHaveLength(1);expect(state.requests[h.pending.id].decisionActorId).toBe('integration:home-assistant-supervision');expect(h.logs.filter(log=>log.event==='supervision.request.decided')).toHaveLength(1);
 });
 it('delayed_push_after_stop_is_rejected even after release',async()=>{
  const h=await fixture(),action=h.wire[0].data.actions[0].action;await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'stop'});await h.service.release({actor:parent,scopeId:'child-public',idempotencyKey:'release'});
  expect((await h.callback(action)).status).toBe(403);expect(Object.keys((await h.repository.read()).grants)).toHaveLength(0);
 });
 it('duplicate_notification_collapses_without_new_authority and logs never contain raw action tokens',async()=>{
  const h=await fixture(),first=h.wire[0];await h.workflow.requestPermission({context,idempotencyKey:'another'});expect(h.wire).toHaveLength(1);expect(first.data.tag).toBe(`supervision-${h.pending.id}`);expect(first.data.alert_once).toBe(true);
  expect(findPushTextDefects(first.title)).toEqual([]);expect(findPushTextDefects(first.message)).toEqual([]);expect(first.message).toContain('User_5');expect(first.message).toContain('Chess');
  for(const action of first.data.actions){const nonce=action.action.split(':')[1];expect(JSON.stringify(h.pending)).not.toContain(nonce);expect(JSON.stringify(await h.repository.read())).not.toContain(nonce);expect(JSON.stringify(h.logs)).not.toContain(nonce);}
 });
 it('wrong action, recipient and expired callbacks cannot produce a grant',async()=>{
  const h=await fixture(),action=h.wire[0].data.actions[0].action;expect((await h.callback(action.replace('APPROVE','DENY'))).status).toBe(403);
  await h.repository.transaction(state=>{state.requests[h.pending.id].actions.approve.recipientId='different-parent';});expect((await h.callback(action)).status).toBe(403);
  h.setNow(220001);expect((await h.callback(h.wire[0].data.actions[1].action)).status).toBe(403);expect(Object.keys((await h.repository.read()).grants)).toHaveLength(0);
 });
 it('a failed HA send retries with replacement actions and redacts provider errors',async()=>{
  const h=await fixture();await h.workflow.cancelRequest({requestId:h.pending.id,context});h.setNow(130001);h.setFailure(true);
  const second=await h.workflow.requestPermission({context,idempotencyKey:'two'}),old=h.wire[1].data.actions[0].action;h.setFailure(false);h.setNow(132002);await h.workflow.reconcile();
  expect(h.wire[2].data.tag).toBe(`supervision-${second.id}`);expect(h.wire[2].data.actions[0].action).not.toBe(old);expect((await h.callback(old)).status).toBe(403);expect(JSON.stringify(h.logs)).not.toContain(old.split(':')[1]);
  expect((await h.callback(h.wire[2].data.actions[1].action)).body.status).toBe('denied');
 });
 it('an individually authenticated parent can decide without a phone token, with truthful attribution',async()=>{
  const h=await fixture();await request(h.app).post(`/requests/${h.pending.id}/decision`).send({decision:'approve',actor:parent}).expect(403);
  expect((await request(h.app).post(`/requests/${h.pending.id}/decision`).set('Authorization','Bearer real-parent-session').send({decision:'approve',parentId:'not-the-parent'})).body.status).toBe('approved');
  expect((await h.repository.read()).requests[h.pending.id].decisionActorId).toBe(parent.id);
 });
 it('missing callback credentials never create a permissive integration',()=>{expect(()=>new ApprovalCallbackAuthority({credential:null,recipientId:'parents',lookupAction:()=>null})).toThrow();});
});
