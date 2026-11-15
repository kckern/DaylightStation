import {describe,it,expect} from 'vitest';
import {migrateSupervisionPolicy} from '../../../../scripts/migrate-supervision-policy.mjs';
import {INSTALLED_STATE_GATES_POLICY} from '../../../../__backend/src/5_composition/modules/installedStateGatesPolicy.mjs';
import {stateGatesFixture} from '../../../_fixtures/supervision/stateGates.mjs';
import {StateGatesSupervisionPort} from '../../../../__app_modules/household/supervision/server/adapters/StateGatesSupervisionPort.mjs';
import {AuthenticatedStateGatesIngress} from '../../../../__capabilities/state-gates/server/adapters/ingress/AuthenticatedStateGatesIngress.mjs';
describe('supervision policy integration',()=>{
 it('preserves custom rules and rejects conflicting definitions without mutating input',async()=>{
  const old=structuredClone(INSTALLED_STATE_GATES_POLICY);old.policy_revision=100;
  for(const section of ['publishers','claim_types','gates','entitlements'])for(const key of Object.keys(old[section]))if(key.startsWith('supervision'))delete old[section][key];
  const before=structuredClone(old);const migrated=await migrateSupervisionPolicy(old);expect(old).toEqual(before);expect(migrated.policy_revision).toBe(101);
  expect(migrated.entitlements['kiosk.access']).toEqual({gate:'kiosk.friction-ok',failure_posture:'fail_open'});
  expect(migrated.entitlements['piano.games']).toEqual(old.entitlements['piano.games']);
  await stateGatesFixture(migrated);
  const conflict=structuredClone(migrated);conflict.entitlements['supervision.interactive'].failure_posture='fail_open';
  await expect(migrateSupervisionPolicy(conflict)).rejects.toMatchObject({code:'SUPERVISION_POLICY_CONFLICT'});
 });
 it('canonical State Gates denies missing stop evidence and enforces stop and release',async()=>{
  const {container,setNow}=await stateGatesFixture();
  const principal={service:'supervision'};
  const ingress=new AuthenticatedStateGatesIngress({observeAssertion:container.observeAssertion,retractAssertion:container.retractAssertion,resolvePublisher:async p=>p===principal?'supervision':null});
  const port=new StateGatesSupervisionPort({householdId:'home',principal,ingress,getCurrentEntitlements:container.getCurrentEntitlements,clock:{now:()=>100000}});
  expect(await port.decide({deviceId:'portal',activityId:'school'})).toMatchObject({allowed:false});
  await port.publishStop({deviceId:'portal',active:false,sourceRevision:1,observedAt:100000});
  expect(await port.decide({deviceId:'portal',activityId:'school'})).toMatchObject({allowed:true});
  setNow(100001);
  await port.publishStop({deviceId:'portal',active:true,sourceRevision:2,observedAt:100001});
  expect(await port.decide({deviceId:'portal',activityId:'school'})).toMatchObject({allowed:false});
  await expect(ingress.observe('home',{},{})).rejects.toMatchObject({status:403});
 });
});
