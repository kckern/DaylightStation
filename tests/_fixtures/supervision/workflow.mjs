import {SupervisionService} from '../../../__app_modules/household/supervision/server/application/SupervisionService.mjs';
import {StateGatesSupervisionPort} from '../../../__app_modules/household/supervision/server/adapters/StateGatesSupervisionPort.mjs';
import {AuthenticatedStateGatesIngress} from '../../../__capabilities/state-gates/server/adapters/ingress/AuthenticatedStateGatesIngress.mjs';
import {emptySupervisionState,serialQueue} from '../../../__app_modules/household/supervision/shared/contracts.mjs';
import {stateGatesFixture} from './stateGates.mjs';
export const parent={id:'parent',roles:['guardian'],authenticatedBy:'test-reader'};
export async function supervisionFixture(){
 const gates=await stateGatesFixture();let now=100000,state=emptySupervisionState();const queue=serialQueue();
 const repository={read:async()=>structuredClone(state),transaction:fn=>queue(async()=>{const draft=structuredClone(state);const result=await fn(draft);state=draft;return structuredClone(result);})};
 const principal={service:'supervision'},modePrincipal={service:'household-presence'};
 const ingress=new AuthenticatedStateGatesIngress({observeAssertion:gates.container.observeAssertion,retractAssertion:gates.container.retractAssertion,resolvePublisher:async p=>p===principal?'supervision':p===modePrincipal?'household-presence':null});
 const stateGates=new StateGatesSupervisionPort({householdId:'home',principal,modePrincipal,ingress,getCurrentEntitlements:gates.container.getCurrentEntitlements});
 const clock={now:()=>now};const service=new SupervisionService({repository,stateGates,scopes:{'child-public':['portal','garage']},clock});await service.initialize();
 return {service,repository,stateGates,clock,container:gates.container,setNow(value){now=value;gates.setNow(value);}};
}
