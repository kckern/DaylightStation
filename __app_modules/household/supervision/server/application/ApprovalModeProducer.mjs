export function validateApprovalModeConfig(input={enabled:false}){
  const configuration={maxAgeMs:60000,refreshMs:30000,...input};
  if(typeof configuration.enabled!=='boolean' || !Number.isFinite(configuration.maxAgeMs) || configuration.maxAgeMs<=0 || configuration.maxAgeMs>60000 || !Number.isFinite(configuration.refreshMs) || configuration.refreshMs<=0 || configuration.refreshMs>30000 || configuration.refreshMs>=configuration.maxAgeMs)throw new TypeError('Invalid approval evidence timing');
  if(configuration.enabled){
    const {entityId,approvalRequiredStates,normalStates}=configuration;
    if(typeof entityId!=='string' || !entityId || !Array.isArray(approvalRequiredStates) || !approvalRequiredStates.length || !Array.isArray(normalStates) || !normalStates.length || [...approvalRequiredStates,...normalStates].some(value=>typeof value!=='string' || !value) || approvalRequiredStates.some(value=>normalStates.includes(value)) || normalStates.some(value=>['unknown','unavailable'].includes(value)))throw new TypeError('Unambiguous enabled approval condition required');
  }
  return configuration;
}
/** Normalizes trusted observations only; State Gates remains the policy evaluator. */
export class ApprovalModeProducer {
  #configuration;#clock;#publish;#read;#schedule;#cancel=null;#logger;
  constructor({configuration,clock,publishMode,readState,scheduleEvery,logger}){this.#configuration=validateApprovalModeConfig(configuration);this.#clock=clock;this.#publish=publishMode;this.#read=readState;this.#schedule=scheduleEvery;this.#logger=logger;}
  async observe({entityId,state,observedAt,sourceRevision}){
    const config=this.#configuration,now=this.#clock.now();
    if(!config.enabled || entityId!==config.entityId)return false;
    if(!Number.isFinite(observedAt) || observedAt>now || now-observedAt>=config.maxAgeMs)return false;
    const required=!config.normalStates.includes(state);
    return this.#publish({required,observedAt,expiresAt:observedAt+config.maxAgeMs,evidence:{entityId,sourceRevision,observedAt}});
  }
  async refresh(){
    const config=this.#configuration,now=this.#clock.now();
    if(!config.enabled)return this.#publish({required:false,observedAt:now,expiresAt:now+config.maxAgeMs,evidence:{entityId:null,observedAt:now}});
    let observation;
    try{observation=await this.#read(config.entityId);}catch(error){this.#logger?.warn?.('supervision.mode.read_failed',{entityId:config.entityId,error:error.message});}
    // A successful explicit read attests the HA state now. Push-event timestamps
    // retain their original time and cannot refresh an older observation.
    return this.observe({entityId:config.entityId,state:observation?.state??'unknown',observedAt:observation?.observedAt??this.#clock.now(),sourceRevision:observation?.sourceRevision});
  }
  async start(){await this.refresh();if(!this.#cancel && this.#schedule)this.#cancel=this.#schedule(this.#configuration.refreshMs,()=>{void this.refresh().catch(error=>this.#logger?.warn?.('supervision.mode.publication_pending',{error:error.message}));});}
  dispose(){this.#cancel?.();this.#cancel=null;}
}
