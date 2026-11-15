import {StateGatesContainer} from '../../../__capabilities/state-gates/server/application/index.mjs';
import {YamlStateGatesPolicySource} from '../../../__capabilities/state-gates/server/adapters/config/YamlStateGatesPolicySource.mjs';
import {INSTALLED_STATE_GATES_POLICY} from '../../../__backend/src/5_composition/modules/installedStateGatesPolicy.mjs';
export async function stateGatesFixture(policy=INSTALLED_STATE_GATES_POLICY,{householdId='home'}={}){
 let snapshot=null, now=100000;const journal=[];
 const container=new StateGatesContainer({
  policySource:new YamlStateGatesPolicySource({load:async()=>policy}),
  projectionRepository:{load:async()=>snapshot,commitRevision:async(_hid,expected,next,events)=>{if((snapshot?.householdRevision??0)!==expected)return {committed:false};snapshot=next;journal.push(...events);return {committed:true};}},
  transitionRepository:{pending:async()=>[],markPublished:async()=>{},replayAfter:async()=>({events:[]}),compactThrough:async()=>{},oldestAvailableRevision:async()=>1},
  eventPublisher:{publish:async()=>{}},administrationAuthorizer:{authorize:async()=>({allowed:true})},
  loadSubjects:async()=>[{kind:'household',id:householdId},{kind:'device',id:'portal'},{kind:'device',id:'garage'},{kind:'learner',id:'user_5'}],
  publisherIds:async()=>Object.keys(policy.publishers),now:()=>now,timezone:()=> 'America/Los_Angeles'
 });await container.activatePolicyGraph(householdId);
 return {container,setNow(value){now=value;},journal};
}
