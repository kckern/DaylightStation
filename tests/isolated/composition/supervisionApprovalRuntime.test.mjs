import {it,expect} from 'vitest';
import express from 'express';
import http from 'supertest';
import {createSupervisionRuntime} from '../../../__backend/src/5_composition/modules/supervision.mjs';
import {supervisionFixture,parent} from '../../_fixtures/supervision/workflow.mjs';
const callback='c'.repeat(48),configuration={enabled:true,scopes:{'child-public':['portal','garage','piano','shield']},devices:[{id:'portal',required_capabilities:['browser','portal-keys']},{id:'garage',required_capabilities:['browser','ha-stop']},{id:'piano',required_capabilities:['browser']},{id:'shield',required_capabilities:['browser','native:com.retroarch.aarch64','native-lease:com.retroarch.aarch64']}],approval_mode:{enabled:true,entityId:'person.fixture',normalStates:['home'],approvalRequiredStates:['not_home'],notifyService:'notify.fixture_phone',recipientId:'parent'},activities:[{id:'school:workspace',label:'School workspace (codes, bank, rewards and printing)',path:'/screens/portal',owner:'school',devices:['portal']},{id:'piano:game:chess',label:'Piano chess',path:'/piano/games/chess',owner:'piano-game',devices:['piano']},{id:'arcade:gb/mario',label:'Mario',path:'/fitness/games/gb/mario',owner:'arcade',nativePackage:'com.retroarch.aarch64',devices:['shield']}]};
async function fixture(overrides={}){
 const h=await supervisionFixture();let presence='home';const pushes=[];
 const credentials={secret:'s'.repeat(48),callback_credential:callback,native_devices:{shield:{credential:'n'.repeat(48),packages:['com.retroarch.aarch64']}},devices:Object.fromEntries(configuration.devices.map(device=>[device.id,{credential:'d'.repeat(48)}]))};
 const consumers=configuration.devices.flatMap(device=>device.required_capabilities.filter(capability=>capability!=='browser').map(capability=>({deviceId:device.id,capability,capabilities:[capability],stop:async()=>({blocked:true}),release:async()=>({blocked:false})})));
 const runtime=await createSupervisionRuntime({...h,configuration,credentials,householdId:'home',consumers,getLearners:()=>[{id:'user_5',label:'User_5'}],baselineEligibility:async()=>({allowed:true}),getHaGateway:()=>({getState:async()=>({state:presence})}),callHomeAssistant:{execute:async input=>{pushes.push(input);return {result:{ok:true}};}},verifyParentCredentials:async()=>parent,authenticateParent:async req=>{if(req.headers.authorization!=='Bearer parent-session')throw Object.assign(Error('Parent required'),{status:403});return parent;},...overrides});
 const app=express();app.use(express.json());app.use('/api/v1/supervision',runtime.router);
 const token=async deviceId=>(await runtime.kiosk.issue({deviceId,credential:'d'.repeat(48),sessionId:`browser-${deviceId}`})).token;
 const tokens=Object.fromEntries(await Promise.all(configuration.devices.map(async device=>[device.id,await token(device.id)])));
 const call=(method,path,deviceId='portal')=>http(app)[method]('/api/v1/supervision'+path).set('x-kiosk-session',tokens[deviceId]);
 async function ready(){await runtime.enforcement.refresh();for(const device of configuration.devices){const boot=await call('get','/bootstrap',device.id);await call('post','/consumer-ack',device.id).send({protocol:2,blocked:true,commandRevision:boot.body.commandRevision}).expect(200);}await runtime.reconciler.reconcile();}
 await ready();return {...h,runtime,app,pushes,call,ready,async presence(value){presence=value;await runtime.modeProducer.refresh();await ready();}};
}
it('configured_rule_cannot_activate_with_uncovered_surface_or_missing_callback_auth',async()=>{
 const h=await fixture({credentials:{secret:'s'.repeat(48),devices:Object.fromEntries(configuration.devices.map(device=>[device.id,{credential:'d'.repeat(48)}]))},consumers:[]});const health=await h.runtime.health();expect(health.activationAllowed).toBe(false);expect(health.errors).toContain('APPROVAL_CALLBACK_CONFIGURATION_REQUIRED');expect((await h.repository.read()).mode.required).toBe(true);h.runtime.dispose();
});
it('presence_to_request_to_phone_to_single_activity with authenticated diagnostics and private child status',async()=>{
 const h=await fixture();expect((await h.call('get','/access?activityId=school:workspace')).body.allowed).toBe(true);
 await h.presence('not_home');expect((await h.call('get','/access?activityId=school:workspace')).body.allowed).toBe(false);
 const context={activityId:'school:workspace',learnerId:'user_5'};const requested=await h.call('post','/requests').send({...context,idempotencyKey:'one'}).expect(200);expect(h.pushes).toHaveLength(1);
 const action=h.pushes[0].data.data.actions[0].action;
 await http(h.app).post('/api/v1/supervision/approval-callback').set('Authorization',`Bearer ${callback}`).send({action}).expect(200);
 const session=await h.call('post',`/requests/${requested.body.id}/consume`).send(context).expect(200);await h.ready();
 const query=new URLSearchParams({...context,requestId:requested.body.id,sessionId:session.body.sessionId});expect((await h.call('get',`/access?${query}`)).body.allowed).toBe(true);expect((await h.call('get',`/access?${query}`,'piano')).body.allowed).toBe(false);
 await http(h.app).get('/api/v1/supervision/diagnostics').expect(403);const diagnostics=await http(h.app).get('/api/v1/supervision/diagnostics').set('Authorization','Bearer parent-session').expect(200);expect(diagnostics.body.mode.required).toBe(true);expect(diagnostics.body.requests[0].notification.status).toBe('cancelled');expect(JSON.stringify(diagnostics.body)).not.toContain(action.split(':')[1]);
 const status=await h.call('get','/status');expect(status.body.requests).toBeUndefined();expect(status.body.enforcement.requests).toBeUndefined();h.runtime.dispose();
});
it('stop_during_pending_or_playing_session_blocks_all_registered_devices and old approval stays revoked after release/restart',async()=>{
 const h=await fixture();await h.presence('not_home');const context={activityId:'school:workspace',learnerId:'user_5'};const request=await h.call('post','/requests').send({...context,idempotencyKey:'one'});const action=h.pushes[0].data.data.actions[0].action;
 await h.runtime.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'stop'});await h.ready();
 for(const deviceId of ['portal','garage','piano','shield'])expect((await h.call('get','/access?activityId=school:workspace',deviceId)).body.allowed).toBe(false);
 await h.runtime.service.release({actor:parent,scopeId:'child-public',idempotencyKey:'release'});await h.ready();await http(h.app).post('/api/v1/supervision/approval-callback').set('Authorization',`Bearer ${callback}`).send({action}).expect(403);expect((await h.call('get',`/requests/${request.body.id}?${new URLSearchParams(context)}`)).body.status).toBe('revoked');
 await h.presence('unknown');expect((await h.call('get','/access?activityId=school:workspace')).body.allowed).toBe(false);h.runtime.dispose();
});
