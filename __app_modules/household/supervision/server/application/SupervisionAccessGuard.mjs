import {AccessDenied,ACCESS_LEASE_MS,requireAccessContext} from '../../shared/contracts.mjs';
/** Workflow integrity checks precede the canonical State Gates decision. */
export class SupervisionAccessGuard {
  #workflow;#service;#gates;#clock;#enforcementReady;
  constructor({service,stateGates,clock,enforcementReady=async()=>true,approvalWorkflow=null}){this.#workflow=approvalWorkflow;this.#enforcementReady=enforcementReady;this.#service=service;this.#gates=stateGates;this.#clock=clock;}
  async #authorize(context){
    requireAccessContext(context);
    try{
      const status=await this.#service.status({deviceId:context.deviceId});
      if(Object.hasOwn(context,'admittedEpoch') && context.admittedEpoch!==status.epoch)throw new AccessDenied('SUPERVISION_EPOCH_REVOKED');
      if(status.active || status.publication!=='acknowledged')throw new AccessDenied();
      if(!await this.#enforcementReady(context))throw new AccessDenied('SUPERVISION_ENFORCEMENT_UNAVAILABLE');
      const binding=this.#workflow && context.requestId?await this.#workflow.contextForPermit(context):null;
      const decision=this.#workflow?await this.#gates.decideActivity({deviceId:context.deviceId,...(binding?{period:binding.period}:{})}):await this.#gates.decide(context);const now=this.#clock.now();
      const expiresAt=Math.min(now+ACCESS_LEASE_MS,decision.validUntil??Infinity,binding?.expiresAt??Infinity);
      if(!decision.allowed || expiresAt<=now)throw new AccessDenied(this.#workflow && !binding?'SUPERVISION_APPROVAL_REQUIRED':'SUPERVISION_BLOCKED');
      return {decisionId:decision.decisionId,epoch:status.epoch,expiresAt};
    }catch(error){if(error instanceof AccessDenied)throw error;throw new AccessDenied();}
  }
  authorize(context){return this.#service.exclusive(()=>this.#authorize(context));}
  async runAuthorized(context,effect){
    let admitted;
    await this.#service.exclusive(async()=>{
      const permit=await this.#authorize(context);
      // Invoke before releasing admission, but don't hold Stop behind a slow
      // physical effect. Registered consumers reconcile already admitted work.
      admitted={result:effect(permit)};
    });
    return admitted.result;
  }
}
