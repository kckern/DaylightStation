/** Native enforcement is independent of the browser's foreground state. */
export class StopReconciler {
  #repository;#consumers;#clock;#logger;#health=new Map();#jobs=new Map();#scheduleEvery;#cancel=null;#getCommand;#beforeReconcile;#incidentReporter;#incidentReportingError=null;
  constructor({repository,consumers,clock,logger,scheduleEvery,getCommand=null,beforeReconcile=null,incidentReporter=null}){this.#incidentReporter=incidentReporter;this.#getCommand=getCommand;this.#beforeReconcile=beforeReconcile;this.#repository=repository;this.#consumers=consumers;this.#clock=clock;this.#logger=logger;this.#scheduleEvery=scheduleEvery;}
  health(){return structuredClone([...this.#health.values()].map(row=>({...row,...(this.#incidentReportingError?{incidentReportingError:this.#incidentReportingError}:{})})));}
  async isReady({deviceId}){
    const state=await this.#repository.read(),device=state.devices[deviceId];if(!device)return false;
    const required=this.#consumers.filter(consumer=>consumer.deviceId===deviceId);
    return required.length>0 && (await Promise.all(required.map(async consumer=>{
      const health=this.#health.get(`${deviceId}:${consumer.capability}`),command=await this.#command(consumer,state);
      return health?.acknowledged===true && Number.isFinite(health.lastContactAt) && this.#clock.now()>=health.lastContactAt && this.#clock.now()-health.lastContactAt<=5000 && health.commandRevision===command.commandRevision && health.blocked===command.blocked;
    }))).every(Boolean);
  }
  #command(consumer,state){return this.#getCommand?this.#getCommand(consumer):Promise.resolve({deviceId:consumer.deviceId,epoch:state.epoch,commandRevision:state.revisions[`stop:${consumer.deviceId}`],blocked:state.devices[consumer.deviceId]?.active,reason:'parental-stop'});}
  async #enforce(consumer,state){
    const {deviceId,capability}=consumer,key=`${deviceId}:${capability}`,device=state.devices[deviceId];
    const command=await this.#command(consumer,state),{commandRevision}=command;
    const previous=this.#health.get(key);
    if(previous?.commandRevision>commandRevision)return;
    const health={deviceId,capability,epoch:state.epoch,commandRevision,desiredBlocked:command.blocked,requestedAt:previous?.commandRevision===commandRevision?previous.requestedAt:this.#clock.now(),blocked:false,acknowledged:false,lastContactAt:previous?.lastContactAt??null,error:null};
    this.#health.set(key,previous?.commandRevision===commandRevision?{...previous,desiredBlocked:command.blocked}:health);
    void this.#observe();
    if(!device){health.error='UNKNOWN_DEVICE';this.#health.set(key,health);return;}
    try{
      const action=command.blocked?consumer.stop:consumer.release;
      if(typeof action!=='function')throw Object.assign(Error('Consumer capability unavailable'),{code:'CAPABILITY_UNAVAILABLE'});
      const result=await action(command);
      if(result?.skipped || result?.ok===false)throw Object.assign(Error('Consumer capability unavailable'),{code:'CAPABILITY_UNAVAILABLE'});
      if(result?.commandRevision!=null && result.commandRevision!==commandRevision)throw Object.assign(Error('Obsolete consumer acknowledgement'),{code:'NATIVE_ACK_MISMATCH'});
      if(result?.blocked!==command.blocked)throw Object.assign(Error('Consumer did not acknowledge desired restriction'),{code:'ENFORCEMENT_UNVERIFIED'});
      health.lastContactAt=this.#clock.now();health.acknowledged=true;health.blocked=result.blocked;health.detail=result.detail??null;
    }catch(error){health.error=error.code??'CONSUMER_UNREACHABLE';if(error.contacted)health.lastContactAt=this.#clock.now();if(previous?.error!==health.error || previous?.commandRevision!==commandRevision)this.#logger?.warn?.('supervision.consumer.pending',{deviceId,capability,commandRevision,error:health.error});}
    const current=await this.#repository.read();
    const latest=await this.#command(consumer,current);if(latest.commandRevision!==commandRevision || latest.blocked!==command.blocked)return;
    const newer=this.#health.get(key);if(newer && newer.commandRevision>commandRevision)return;
    if(health.acknowledged && (!previous?.acknowledged || previous.commandRevision!==commandRevision))this.#logger?.info?.('supervision.consumer.acknowledged',{deviceId,capability,epoch:state.epoch,commandRevision,blocked:health.blocked});
    this.#health.set(key,health);
  }
  async reconcile({deviceId,capability}={}){
    await this.#beforeReconcile?.();const state=await this.#repository.read();
    const jobs=this.#consumers.filter(consumer=>(!deviceId || consumer.deviceId===deviceId) && (!capability || consumer.capability===capability)).map(async consumer=>{
      const key=`${consumer.deviceId}:${consumer.capability}`,revision=(await this.#command(consumer,state)).commandRevision;
      const existing=this.#jobs.get(key);if(existing?.revision===revision)return existing.promise;
      const job={revision,promise:null};job.promise=this.#enforce(consumer,state).finally(()=>{if(this.#jobs.get(key)===job)this.#jobs.delete(key);});this.#jobs.set(key,job);return job.promise;
    });
    // Observe before waiting: one hung actuator must not hide its pending Stop.
    await Promise.resolve();await this.#observe();
    await Promise.allSettled(jobs);await this.#observe();return this.health();
  }
  async #observe(){try{await this.#incidentReporter?.observe({health:this.health(),nowMs:this.#clock.now()});this.#incidentReportingError=null;}catch{this.#incidentReportingError='INCIDENT_REPORTING_UNAVAILABLE';this.#logger?.warn?.('supervision.incident.reporting_failed',{error:this.#incidentReportingError});}}
  start(){if(this.#cancel || !this.#scheduleEvery)return;this.#cancel=this.#scheduleEvery(2000,()=>{void this.reconcile().catch(error=>this.#logger?.warn?.('supervision.reconcile.failed',{error:error.message}));});}
  dispose(){this.#cancel?.();this.#cancel=null;}
}
