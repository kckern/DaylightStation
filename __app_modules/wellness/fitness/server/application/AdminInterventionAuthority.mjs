/** Trusted scanner authority. Context must be registered before an intentional unlock scan. */
export class AdminInterventionAuthority {
  #clock;#makeId;#resolveActor;#stop;#release;#contexts=new Map();#proofs=new Map();#inFlight=new Map();
  constructor({clock,makeId,resolveActor,onStop,onRelease}){this.#clock=clock;this.#makeId=makeId;this.#resolveActor=resolveActor;this.#stop=onStop;this.#release=onRelease;}
  #denied(){return Object.assign(new Error('Fresh parent authority required'),{code:'PARENT_AUTHORITY_REQUIRED',status:403});}
  beginPurpose({deviceId,purpose}){
    if(!deviceId || !['unlock','release','stop'].includes(purpose))throw this.#denied();
    const context={contextId:this.#makeId(),purpose,expiresAt:this.#clock.now()+15000};this.#contexts.set(deviceId,context);return {...context};
  }
  clearPurpose({deviceId,contextId}){if(this.#contexts.get(deviceId)?.contextId===contextId)this.#contexts.delete(deviceId);}
  async issueProof({userId,deviceId,purpose}){
    const actor=await this.#resolveActor(userId);
    if(!actor?.authenticatedBy || !actor.id || !actor.roles?.some(role=>['owner','guardian'].includes(role)) || !deviceId || !['stop','release'].includes(purpose))throw this.#denied();
    const now=this.#clock.now();for(const [id,proof] of this.#proofs)if(proof.expiresAt<=now)this.#proofs.delete(id);
    const proofId=this.#makeId(),expiresAt=now+15000;this.#proofs.set(proofId,{actor,purpose,deviceId,expiresAt});return {proofId,expiresAt};
  }
  async consumeAdminProof({proofId,purpose}){
    const proof=this.#proofs.get(proofId);this.#proofs.delete(proofId);
    if(!proof || proof.purpose!==purpose || proof.expiresAt<=this.#clock.now())throw this.#denied();return proof.actor;
  }
  observeAdmin(input){
    const pending=this.#observeAdmin(input);this.#inFlight.set(input.deviceId,pending);
    void pending.finally(()=>{if(this.#inFlight.get(input.deviceId)===pending)this.#inFlight.delete(input.deviceId);}).catch(()=>{});
    return pending;
  }
  waitForIntervention({deviceId}){return this.#inFlight.get(deviceId)??Promise.resolve();}
  async #observeAdmin({userId,deviceId}){
    const context=this.#contexts.get(deviceId);this.#contexts.delete(deviceId);
    const purpose=context?.expiresAt>this.#clock.now()?context.purpose:'stop';
    if(purpose==='unlock')return {purpose};
    const {proofId}=await this.issueProof({userId,deviceId,purpose});const actor=await this.consumeAdminProof({proofId,purpose});
    const state=await (purpose==='release'?this.#release:this.#stop)({actor,idempotencyKey:proofId});
    return {purpose,blocked:state.active,epoch:state.epoch,deviceId};
  }
}
