/** Canonical decisions become durable ordered consumer commands, distinct from assertion revisions. */
export class EffectiveEnforcement {
  #repository;#service;#workflow;#devices;#nativeActivity;#clock;
  constructor({repository,service,workflow,devices,clock,nativeActivity=()=>false}){this.#clock=clock;this.#repository=repository;this.#service=service;this.#workflow=workflow;this.#devices=devices;this.#nativeActivity=nativeActivity;}
  #current(decision){return decision.allowed===true && (decision.validUntil==null || decision.validUntil>this.#clock.now());}
  refresh(){return this.#service.exclusive(async()=>{
    const snapshot=await this.#repository.read(),commands={};
    for(const device of this.#devices){
      let normal=false,binding=null;
      if(snapshot.devices[device.id]?.active===false && snapshot.devices[device.id].publication==='acknowledged'){
        try{const decision=await this.#service.decideActivity({deviceId:device.id});normal=this.#current(decision);}catch{}
        if(!normal)for(const grant of Object.values(snapshot.grants)){
          if(grant.deviceId!==device.id || !grant.sessionId)continue;
          const request=snapshot.requests[grant.requestId],context={deviceId:device.id,activityId:grant.activityId,learnerId:grant.learnerId,clientSessionId:grant.clientSessionId,requestId:grant.requestId,sessionId:grant.sessionId};
          try{const permit=await this.#workflow.contextForPermit(context);if(this.#current(await this.#service.decideActivity({deviceId:device.id,period:permit.period}))){binding={...context,target:request.target};break;}}catch{}
        }
      }
      const restrictions=Object.fromEntries(device.requiredCapabilities.map(capability=>[capability,!normal && (!binding || ((capability.startsWith('native:') || capability.startsWith('native-lease:')) && !this.#nativeActivity(binding.target,capability.replace('native-lease:','native:'))))]));
      commands[device.id]={restrictions,binding:binding?{requestId:binding.requestId,sessionId:binding.sessionId}:null,epoch:snapshot.epoch,stopRevision:snapshot.revisions[`stop:${device.id}`]??0};
    }
    await this.#repository.transaction(state=>{
      state.enforcement??={};
      for(const [id,value] of Object.entries(commands)){
        const key=JSON.stringify(value),previous=state.enforcement[id];
        if(previous?.key===key)continue;
        state.enforcement[id]={...value,key,commandRevision:(previous?.commandRevision??0)+1};
      }
    });
  });}
  async command({deviceId,capability}){
    const state=await this.#repository.read(),command=state.enforcement?.[deviceId];
    if(!command)return {deviceId,epoch:state.epoch,commandRevision:0,blocked:true,reason:'enforcement-uninitialized'};
    return {deviceId,epoch:command.epoch,commandRevision:command.commandRevision,blocked:command.restrictions[capability]!==false,reason:state.devices[deviceId]?.active?'parental-stop':'supervision-policy'};
  }
  async revisions(){const state=await this.#repository.read();return Object.fromEntries(Object.entries(state.enforcement??{}).map(([id,value])=>[id,value.commandRevision]));}
}
