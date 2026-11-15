import {describe,it,expect} from 'vitest';
import {ApprovalModeProducer} from '../../../../__app_modules/household/supervision/server/application/ApprovalModeProducer.mjs';
import {supervisionFixture,parent} from '../../../_fixtures/supervision/workflow.mjs';
const configured={enabled:true,entityId:'person.configured_parent',approvalRequiredStates:['not_home'],normalStates:['home']};
async function fixture(configuration=configured){const h=await supervisionFixture();let state={state:'home'};const producer=new ApprovalModeProducer({configuration,clock:h.clock,publishMode:input=>h.service.publishMode(input),readState:async()=>state});return {...h,producer,setState(value){state=value;}};}
describe('trusted household approval mode',()=>{
 it('configured_unknown_or_stale_presence_never_becomes_normal',async()=>{
  const h=await fixture();h.setState({state:'unavailable'});await h.producer.refresh();expect(await h.stateGates.decideActivity({deviceId:'portal'})).toMatchObject({allowed:false});
  h.setState({state:'home'});await h.producer.refresh();expect(await h.stateGates.decideActivity({deviceId:'portal'})).toMatchObject({allowed:true});
  h.setNow(160001);await h.container.reconcile('home');expect(await h.stateGates.decideActivity({deviceId:'portal'})).toMatchObject({allowed:false});
 });
 it('late_ha_event_does_not_refresh_old_evidence',async()=>{
  const h=await fixture();await h.producer.refresh();h.setNow(160001);
  await h.producer.observe({entityId:configured.entityId,state:'home',observedAt:90000,sourceRevision:1});await h.container.reconcile('home');
  expect(await h.stateGates.decideActivity({deviceId:'portal'})).toMatchObject({allowed:false});
 });
 it('unconfigured_feature_publishes_explicit_normal',async()=>{const h=await fixture({enabled:false});await h.producer.refresh();expect((await h.repository.read()).mode.required).toBe(false);expect(await h.stateGates.decideActivity({deviceId:'portal'})).toMatchObject({allowed:true});});
 it('a valid grant cannot bypass missing mode, stale mode, or Stop',async()=>{
  const h=await fixture();const request={id:'request-1',deviceId:'portal',createdAt:100000,decidedAt:100000,period:{kind:'occurrence',id:'request-1',startsAt:100000,endsAt:820000}};
  await h.stateGates.publishGrant({request,valid:true,sourceRevision:1,expiresAt:700000});
  expect(await h.stateGates.decideActivity({deviceId:'portal',period:request.period})).toMatchObject({allowed:false});
  h.setState({state:'not_home'});await h.producer.refresh();expect(await h.stateGates.decideActivity({deviceId:'portal',period:request.period})).toMatchObject({allowed:true});
  h.setNow(160001);await h.container.reconcile('home');expect(await h.stateGates.decideActivity({deviceId:'portal',period:request.period})).toMatchObject({allowed:false});
  await h.producer.refresh();expect(await h.stateGates.decideActivity({deviceId:'portal',period:request.period})).toMatchObject({allowed:true});
  await h.service.stop({actor:parent,scopeId:'child-public',idempotencyKey:'stop'});expect(await h.stateGates.decideActivity({deviceId:'portal',period:request.period})).toMatchObject({allowed:false});
 });
 it('rejects ambiguous or incomplete enabled condition mappings',()=>{
  expect(()=>new ApprovalModeProducer({configuration:{...configured,normalStates:['not_home']}})).toThrow();expect(()=>new ApprovalModeProducer({configuration:{enabled:true}})).toThrow();
 });
});

it('household evidence binds to the actual household without rewriting the graph',async()=>{
 const {stateGatesFixture}=await import('../../../_fixtures/supervision/stateGates.mjs');
 const {StateGatesSupervisionPort}=await import('../../../../__app_modules/household/supervision/server/adapters/StateGatesSupervisionPort.mjs');
 const {AuthenticatedStateGatesIngress}=await import('../../../../__capabilities/state-gates/server/adapters/ingress/AuthenticatedStateGatesIngress.mjs');
 const {container}=await stateGatesFixture(undefined,{householdId:'another-household'});const principal={},modePrincipal={};
 const ingress=new AuthenticatedStateGatesIngress({observeAssertion:container.observeAssertion,resolvePublisher:async p=>p===principal?'supervision':p===modePrincipal?'household-presence':null});
 const port=new StateGatesSupervisionPort({householdId:'another-household',principal,modePrincipal,ingress,getCurrentEntitlements:container.getCurrentEntitlements});
 await port.publishStop({deviceId:'portal',active:false,sourceRevision:1,observedAt:100000});await port.publishMode({required:false,sourceRevision:1,observedAt:100000,expiresAt:160000});
 expect(await port.decideActivity({deviceId:'portal'})).toMatchObject({allowed:true});
});
it('a configured source change starts a separate source revision sequence',async()=>{
 const h=await fixture();await h.service.publishMode({required:false,observedAt:100000,expiresAt:160000,evidence:{entityId:'person.old',sourceRevision:100}});
 h.setNow(100001);await h.service.publishMode({required:true,observedAt:100001,expiresAt:160001,evidence:{entityId:'person.new',sourceRevision:1}});
 expect((await h.repository.read()).mode.evidence.entityId).toBe('person.new');
});
