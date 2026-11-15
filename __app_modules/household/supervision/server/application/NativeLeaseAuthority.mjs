/** Native credentials authenticate a local enforcer, never a child-selected title. */
export class NativeLeaseAuthority {
  #repository;#service;#workflow;#enforcement;#consumers;#observe;#clock;
  constructor({repository,service,workflow,enforcement,consumers,observeNative,clock}){this.#repository=repository;this.#service=service;this.#workflow=workflow;this.#enforcement=enforcement;this.#consumers=consumers;this.#observe=observeNative;this.#clock=clock;}
  async renew({deviceId,packageName,ack}){
    const consumer=this.#consumers.find(value=>value.deviceId===deviceId && value.packageName===packageName);
    if(!consumer)throw new TypeError('Native consumer not registered');
    // Device/network observation is outside admission so it cannot hold up Stop.
    let proof;try{proof=await this.#observe?.({deviceId,packageName});}catch{}
    await this.#enforcement.refresh?.();
    return this.#service.exclusive(async()=>{
      const state=await this.#repository.read(),now=this.#clock.now(),command=await this.#enforcement.command({deviceId,capability:`native:${packageName}`});
      const denied={protocol:1,epoch:state.epoch,commandRevision:command.commandRevision,blockedCommand:command.blocked,allowed:false,leaseMs:0};
      if(ack?.commandRevision===command.commandRevision && ack?.epoch===state.epoch)consumer.acknowledge(ack);
      if(ack?.protocol!==1 || ack.capabilityReady!==true || command.blocked || state.devices[deviceId]?.active!==false || state.devices[deviceId]?.publication!=='acknowledged')return denied;
      const current=decision=>decision.allowed===true && (decision.validUntil==null || decision.validUntil>now);
      const normal=await this.#service.decideActivity({deviceId});
      if(current(normal))return {...denied,allowed:true,leaseMs:Math.min(5000,(normal.validUntil??now+5000)-now)};
      for(const grant of Object.values(state.grants)){
        const request=state.requests[grant.requestId];
        if(grant.deviceId!==deviceId || !grant.sessionId || request?.target.owner!=='arcade' || request.target.nativePackage!==packageName)continue;
        const context={deviceId,activityId:grant.activityId,learnerId:grant.learnerId,clientSessionId:grant.clientSessionId,requestId:grant.requestId,sessionId:grant.sessionId};
        try{
          const binding=await this.#workflow.contextForPermit(context),decision=await this.#service.decideActivity({deviceId,period:binding.period});if(!current(decision))continue;
          if(!proof || !Number.isFinite(proof.observedAt) || proof.observedAt>now || now-proof.observedAt>2000)continue;
          const nativeEnd=proof.state==='running' && proof.contentId===grant.activityId?proof.observedAt+5000:proof.state==='idle'?grant.consumedAt+5000:0;
          const leaseMs=Math.min(5000,nativeEnd-now,binding.expiresAt-now,(decision.validUntil??now+5000)-now);
          if(leaseMs>0)return {...denied,allowed:true,leaseMs};
        }catch{}
      }
      return denied;
    });
  }
}
