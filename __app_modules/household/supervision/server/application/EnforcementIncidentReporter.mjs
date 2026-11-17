import {serialQueue} from '../../shared/contracts.mjs';

const incidentKey=row=>JSON.stringify([row.deviceId,row.capability,row.commandRevision]);
// Preserve legacy episode-one identities already present in the notification ledger.
const notificationId=incident=>(incident.episode??1)===1?incident.incidentId:`${incident.incidentId}:episode:${incident.episode}`;
const freshAck=(row,now)=>row?.acknowledged===true && !row.error && row.blocked===true && row.detail?.verified!==false && Number.isFinite(row.lastContactAt) && now>=row.lastContactAt && now-row.lastContactAt<=5000;
/** Durable diagnostic metadata only. The Stop owner remains the sole command authority. */
export class EnforcementIncidentReporter {
  #repository; #notify; #logger; #monotonicNow; #elapsed=new Map(); #attempts=new Map(); #queue=serialQueue();
  constructor({repository,notifyIncident,logger,monotonicNow=()=>performance.now()}) {
    this.#repository=repository;this.#notify=notifyIncident;this.#logger=logger;this.#monotonicNow=monotonicNow;
  }
  async incidents(){return Object.values((await this.#repository.read()).enforcementIncidents??{});}
  observe(input){return this.#queue(()=>this.#observe(input));}
  async #observe({health,desiredBlocked,nowMs}) {
    const mono=this.#monotonicNow();
    await this.#repository.transaction(state=>{
      state.enforcementIncidents??={};
      for(const row of health){
        const id=incidentKey(row),blocked=row.desiredBlocked??desiredBlocked;
        let incident=state.enforcementIncidents[id];
        if(blocked!==true)continue;
        if(freshAck(row,nowMs)){
          this.#elapsed.delete(id);
          if(incident?.status==='watching' && !incident.history?.length)delete state.enforcementIncidents[id];
          else if(incident?.status==='watching'){incident.status='recovered';incident.recoveredAt=new Date(nowMs).toISOString();}
          else if(incident && !incident.recoveredAt)incident.recoveredAt=new Date(nowMs).toISOString();
          continue;
        }
        if(!incident || incident.recoveredAt){
          const history=incident?.history??[];
          const episode=(incident?.episode??(incident?1:0))+1;
          if(incident){
            const {history:previousHistory,...previous}=incident;
            history.push(previous); // Retain delivery evidence; superseded recovery is never retried.
          }
          this.#elapsed.delete(id);
          incident=state.enforcementIncidents[id]={incidentId:id,episode,history,deviceId:row.deviceId,capability:row.capability,commandRevision:row.commandRevision,firstMissingAt:nowMs,status:'watching',error:row.error??'ENFORCEMENT_UNVERIFIED',buildIdentity:row.detail?.buildIdentity??null,alert:{status:'pending'},recovery:{status:'pending'}};
        }
        if(incident.status==='watching'){
          if(row.error)incident.error=row.error;
          // Across restart use the durable wall timestamp; while running measure
          // elapsed time monotonically so clock corrections cannot postpone alerting.
          if(!this.#elapsed.has(id))this.#elapsed.set(id,{at:mono,prior:Math.max(0,nowMs-incident.firstMissingAt)});
          const start=this.#elapsed.get(id);
          if(start.prior+mono-start.at>=5000){incident.status='delivery-pending';incident.at=new Date(nowMs).toISOString();}
        }
      }
    });
    const state=await this.#repository.read();
    for(const incident of Object.values(state.enforcementIncidents??{})){
      if(incident.status==='watching' || !incident.at)continue;
      if(!['accepted','confirmed'].includes(incident.alert.status))await this.#deliver(incident,'alert',nowMs);
      const latest=(await this.#repository.read()).enforcementIncidents[incident.incidentId];
      if(latest.recoveredAt && ['accepted','confirmed'].includes(latest.alert.status) && !['accepted','confirmed'].includes(latest.recovery.status))await this.#deliver(latest,'recovery',nowMs);
    }
  }
  async #deliver(incident,kind,nowMs){
    const key=`${notificationId(incident)}:${kind}`,mono=this.#monotonicNow();
    if(this.#attempts.has(key) && mono-this.#attempts.get(key)<2000)return;
    this.#attempts.set(key,mono);
    const type=kind==='alert'?'enforcement-unverified':'enforcement-restored';
    const event={incidentId:notificationId(incident),episode:incident.episode??1,type,deviceId:incident.deviceId,capability:incident.capability,commandRevision:incident.commandRevision,error:kind==='alert'?incident.error:null,at:kind==='alert'?incident.at:incident.recoveredAt,buildIdentity:incident.buildIdentity};
    await this.#repository.transaction(state=>{state.enforcementIncidents[incident.incidentId].status=kind==='alert'?'delivery-pending':'recovery-pending';});
    let result;
    try{result=await this.#notify?.(event);}catch{result={accepted:false,delivered:false,error:'NOTIFICATION_FAILED'};}
    const status=result?.delivered===true?'confirmed':result?.accepted===true?'accepted':'failed';
    await this.#repository.transaction(state=>{
      const current=state.enforcementIncidents[incident.incidentId];
      current[kind]={status,attemptedAt:new Date(nowMs).toISOString(),error:result?.error??(status==='failed'?'NOTIFICATION_UNAVAILABLE':null)};
      if(status==='confirmed' || status==='accepted')current.status=kind==='recovery'?'recovered':status==='confirmed'?'delivered':'accepted';
    });
    this.#logger?.info?.('supervision.enforcement.incident',{...event,delivery:status});
  }
}
