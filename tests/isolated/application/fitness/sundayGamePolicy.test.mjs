import {describe,it,expect} from 'vitest';
import {StateGatesContainer} from '../../../../__capabilities/state-gates/server/application/StateGatesContainer.mjs';
import {YamlStateGatesPolicySource} from '../../../../__capabilities/state-gates/server/adapters/config/YamlStateGatesPolicySource.mjs';
import {INSTALLED_STATE_GATES_POLICY as policy} from '../../../../__backend/src/5_composition/modules/installedStateGatesPolicy.mjs';
async function decision(at,timezone,day){
 let snapshot=null;const container=new StateGatesContainer({policySource:new YamlStateGatesPolicySource({load:async()=>policy}),projectionRepository:{load:async()=>snapshot,commitRevision:async(_id,expected,next)=>{if((snapshot?.householdRevision??0)!==expected)return {committed:false};snapshot=next;return {committed:true};}},transitionRepository:{replayAfter:async()=>({events:[]}),pending:async()=>[],markPublished:async()=>{},compactThrough:async()=>{},oldestAvailableRevision:async()=>1},eventPublisher:{publish:async()=>{}},administrationAuthorizer:{authorize:async()=>({allowed:true})},loadSubjects:async()=>[{kind:'household',id:'test-household'}],publisherIds:async()=>Object.keys(policy.publishers),now:()=>Date.parse(at),timezone:()=>timezone});
 await container.activatePolicyGraph('test-household');const result=await container.getCurrentEntitlements('test-household',{capabilityId:'fitness.games-unsupervised',subjectKind:'household',subjectId:'test-household',periodKind:'local_day',periodId:day});expect(result.items).toHaveLength(1);return result.items[0];
}
describe('Sunday Fitness policy through the real State Gates engine',()=>{
 it('increments the installed graph and declares a household calendar entitlement',()=>{expect(policy.policy_revision).toBeGreaterThan(4);expect(policy.entitlements['fitness.games-unsupervised']).toEqual({gate:'fitness.games-outside-sunday',failure_posture:'fail_closed'});});
 it('Saturday expires at Sunday midnight; Sunday denies; Monday restores ordinary access',async()=>{
  const saturday=await decision('2026-11-15T07:59:59Z','America/Los_Angeles','2026-11-14');expect(saturday.decision).toBe('granted');expect(saturday.validUntil).toBe(Date.parse('2026-11-15T08:00:00Z'));
  const sunday=await decision('2026-11-15T08:00:00Z','America/Los_Angeles','2026-11-15');expect(sunday.decision).toBe('denied');expect(sunday.reasons).toEqual(expect.arrayContaining([expect.objectContaining({code:'OUTSIDE_SCHEDULE'})]));
  expect((await decision('2026-11-16T08:00:00Z','America/Los_Angeles','2026-11-16')).decision).toBe('granted');
 });
 it('uses household timezone rather than UTC or the kiosk timezone',async()=>{const at='2026-11-14T15:00:00Z';expect((await decision(at,'Asia/Tokyo','2026-11-15')).decision).toBe('denied');expect((await decision(at,'America/Los_Angeles','2026-11-14')).decision).toBe('granted');});
 it('covers the full 25-hour DST Sunday',async()=>{for(const at of ['2026-11-01T07:00:00Z','2026-11-02T07:59:59Z']){const result=await decision(at,'America/Los_Angeles','2026-11-01');expect(result.decision).toBe('denied');expect(result.validUntil).toBe(Date.parse('2026-11-02T08:00:00Z'));}});
});
