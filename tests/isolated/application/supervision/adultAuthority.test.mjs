import {describe,it,expect} from 'vitest';
import {AdminInterventionAuthority} from '../../../../__app_modules/wellness/fitness/server/application/AdminInterventionAuthority.mjs';
import {createAdminInterventionRuntime} from '../../../../__app_modules/wellness/fitness/server/composition/adminIntervention.mjs';
import {createIdentityRelay} from '../../../../__app_modules/wellness/fitness/server/application/identityRelay.mjs';
import {SupervisionService} from '../../../../__app_modules/household/supervision/server/application/SupervisionService.mjs';
import {EmergencyLockdownService} from '../../../../__app_modules/wellness/fitness/server/application/services/EmergencyLockdownService.mjs';
import {emptySupervisionState,serialQueue} from '../../../../__app_modules/household/supervision/shared/contracts.mjs';
function fixture(){
 let state=emptySupervisionState(),now=100000,sequence=0;
 const queue=serialQueue(),repository={read:async()=>structuredClone(state),transaction:fn=>queue(async()=>{const draft=structuredClone(state);const result=await fn(draft);state=draft;return structuredClone(result);})};
 const service=new SupervisionService({repository,scopes:{'child-public':['garage','portal']},stateGates:{publishStop:async()=>({projectionRevision:1})},clock:{now:()=>now}});
 const authority=new AdminInterventionAuthority({clock:{now:()=>now},makeId:()=>`proof-${++sequence}`,resolveActor:async id=>id==='parent'?{id,roles:['guardian'],authenticatedBy:'fingerprint-relay'}:null,onStop:({actor,idempotencyKey})=>service.stop({actor,scopeId:'child-public',source:'fingerprint',idempotencyKey}),onRelease:({actor,idempotencyKey})=>service.release({actor,scopeId:'child-public',idempotencyKey})});
 return {service,authority,advance(ms){now+=ms;}};
}
describe('adult intervention authority',()=>{
 it('recognized_admin_stops_without_hold_even_when_browser_does_nothing',async()=>{
  const h=fixture();await h.service.initialize();let scan;const messages=[];
  createIdentityRelay({identityChannel:{onScan:fn=>{scan=fn;},identityDetected:m=>messages.push(m),emergencyCeremony:()=>{}},userService:{getAllProfiles:()=>new Map([['parent',{identities:{fingerprints:[{id:'uuid'}]}}]])},loadFitnessConfig:()=>({users:{admin:['parent']}}),adminIntervention:h.authority,deviceId:'garage',now:()=>100000,logger:{info(){},debug(){},warn(){}}});
  await scan({matched:true,uuid:'uuid',modality:'fingerprint'});
  expect(await h.service.status({deviceId:'portal'})).toMatchObject({active:true,epoch:1});
  expect(messages.at(-1).parentalIntervention).toMatchObject({purpose:'stop',blocked:true,epoch:1});
 });
 it('explicit_unlock_scan_only_unlocks_its_context_and_does_not_stop',async()=>{
  const h=fixture();await h.service.initialize();h.authority.beginPurpose({deviceId:'garage',purpose:'unlock'});
  expect(await h.authority.observeAdmin({userId:'parent',deviceId:'garage'})).toMatchObject({purpose:'unlock'});
  expect(await h.service.status({deviceId:'portal'})).toMatchObject({active:false});
  await h.authority.observeAdmin({userId:'parent',deviceId:'garage'});expect(await h.service.status({deviceId:'portal'})).toMatchObject({active:true});
 });
 it('release_requires_fresh_purpose_bound_proof_and_cannot_be_replayed',async()=>{
  const h=fixture();await h.service.initialize();await h.authority.observeAdmin({userId:'parent',deviceId:'garage'});
  // A second normal-context parent scan must not silently release an existing stop.
  await h.authority.observeAdmin({userId:'parent',deviceId:'garage'});expect(await h.service.status({deviceId:'portal'})).toMatchObject({active:true});
  h.authority.beginPurpose({deviceId:'garage',purpose:'release'});await h.authority.observeAdmin({userId:'parent',deviceId:'garage'});
  expect(await h.service.status({deviceId:'portal'})).toMatchObject({active:false});
  const proof=await h.authority.issueProof({userId:'parent',deviceId:'garage',purpose:'stop'});
  await expect(h.authority.consumeAdminProof({proofId:proof.proofId,purpose:'release'})).rejects.toMatchObject({status:403});
  await expect(h.authority.consumeAdminProof({proofId:proof.proofId,purpose:'stop'})).rejects.toMatchObject({status:403});
  const expired=await h.authority.issueProof({userId:'parent',deviceId:'garage',purpose:'stop'});h.advance(15001);
  await expect(h.authority.consumeAdminProof({proofId:expired.proofId,purpose:'stop'})).rejects.toMatchObject({status:403});
  await expect(h.authority.observeAdmin({userId:'child',deviceId:'garage'})).rejects.toMatchObject({status:403});
 });
 it('legacy_expiry_does_not_release_parental_stop',async()=>{
  const h=fixture();await h.service.initialize();await h.authority.observeAdmin({userId:'parent',deviceId:'garage'});
  const operations=new EmergencyLockdownService({supervision:{status:()=>h.service.status({deviceId:'garage'})},clock:{now:()=>999999999},logger:{debug(){}}});
  expect(await operations.current()).toMatchObject({locked:true,lockedUntil:null});
 });
});

it('composes existing household owner roles into verified scanner authority',async()=>{
 const h=fixture();await h.service.initialize();
 const runtime=createAdminInterventionRuntime({service:h.service,userService:{getProfile:id=>id==='parent'?{type:'owner',household_id:'home'}:{type:'member',household_id:'home'}},householdId:'home',deviceId:'garage',clock:{now:()=>100000},makeId:()=> 'verified-scan'});
 await runtime.authority.observeAdmin({userId:'parent',deviceId:'garage'});
 expect(await h.service.status({deviceId:'portal'})).toMatchObject({active:true});
 await expect(runtime.authority.issueProof({userId:'child',deviceId:'garage',purpose:'release'})).rejects.toMatchObject({status:403});
});
