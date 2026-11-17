import {StopReconciler} from './application/StopReconciler.mjs';
import {SupervisionAccessGuard} from './application/SupervisionAccessGuard.mjs';
import {SupervisionService} from './application/SupervisionService.mjs';
import {createSupervisionRouter} from './api/supervision.mjs';
/** Application composition accepts trusted ports; host composition owns credentials and scheduling. */
export async function createSupervisionModule(options){
  let reconciler=null,enforcement=null;
  const service=new SupervisionService({...options,onIntentChanged:()=>reconciler?.reconcile()});await service.initialize({legacy:options.legacy});
  const workflow=options.createWorkflow?.({service,repository:options.repository});
  const callbackAuthority=options.createCallbackAuthority?.({workflow});
  enforcement=options.createEnforcement?.({service,workflow});
  reconciler=options.consumers?new StopReconciler({...options,...(enforcement?{getCommand:consumer=>enforcement.command(consumer),beforeReconcile:()=>enforcement.refresh()}:{}),...(options.scheduleEvery?{scheduleEvery:(ms,task)=>options.scheduleEvery(ms,async()=>{if(workflow)await workflow.reconcile();else await service.reconcile();await task();})}:{})}):null;
  const guard=new SupervisionAccessGuard({...options,service,approvalWorkflow:workflow??options.approvalWorkflow,...(reconciler?{enforcementReady:async context=>(!options.enforcementReady || await options.enforcementReady(context)) && await reconciler.isReady(context)}:{})});
  const router=createSupervisionRouter({...options,service,guard,workflow,callbackAuthority});reconciler?.start();void reconciler?.reconcile();
  return {service,guard,router,reconciler,workflow,callbackAuthority,enforcement,dispose:()=>reconciler?.dispose()};
}
