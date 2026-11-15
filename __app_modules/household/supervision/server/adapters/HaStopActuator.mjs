/** A latch ACK proves restriction; only fresh sensor evidence proves physical off. */
export class HaStopActuator {
  #gateway;#clock;#sleep;#entities;#maxAge;#timeout;#generation=0;#jobs=new Set();
  constructor({gateway,clock,sleep,entities,timeoutMs=30000,maxObservationAgeMs=10000}){
    if(!gateway?.callService || !gateway?.getState || !clock?.now || !sleep || !entities?.length)throw new TypeError('HA stop ports and observation entities required');
    this.#gateway=gateway;this.#clock=clock;this.#sleep=sleep;this.#entities=entities;this.#timeout=timeoutMs;this.#maxAge=maxObservationAgeMs;
  }
  async #latch(active,commandRevision){
    if(!Number.isSafeInteger(commandRevision) || commandRevision<1)throw new TypeError('Ordered command revision required');
    const response=await this.#gateway.callService('script','daylight_parental_stop',{active,command_revision:commandRevision});
    if(response?.ok!==true)return false;
    const latch=await this.#gateway.getState('input_boolean.daylight_parental_stop');
    const command=await this.#gateway.getState('input_text.daylight_parental_stop_command');
    return latch?.state===(active?'on':'off') && command?.state===`${commandRevision}:${active?'on':'off'}`;
  }
  async release({commandRevision}){
    ++this.#generation;await Promise.allSettled([...this.#jobs]);
    if(!await this.#latch(false,commandRevision))return {ok:false,blocked:true,detail:{verified:false,error:'HA_LATCH_UNCONFIRMED'}};
    return {blocked:false,detail:{verified:false}};
  }
  stop(input){
    const job=this.#stopIntent(input,++this.#generation);this.#jobs.add(job);
    return job.finally(()=>this.#jobs.delete(job));
  }
  async #stopIntent({commandRevision},generation){
    const deadline=this.#clock.now()+this.#timeout;let backoff=1000;
    while(generation===this.#generation && !await this.#latch(true,commandRevision)){
      if(this.#clock.now()>=deadline)return {ok:false,blocked:false,detail:{verified:false,error:'HA_LATCH_UNCONFIRMED'}};
      await this.#sleep(Math.min(backoff,deadline-this.#clock.now()));backoff=Math.min(backoff*2,5000);
    }
    const samples=[];let previous=null,nextOff=0;
    while(generation===this.#generation && this.#clock.now()<=deadline){
      const now=this.#clock.now();
      if(now>=nextOff){await this.#gateway.callService('script','garage_deactivate',{});nextOff=now+backoff;backoff=Math.min(backoff*2,5000);}
      if(generation!==this.#generation)break;
      const observations=await Promise.all(this.#entities.map(entityId=>this.#gateway.getState(entityId)));
      const timestamps=observations.map(observation=>Date.parse(observation?.lastReported));
      const fresh=observations.every((observation,i)=>observation?.state==='off' && Number.isFinite(timestamps[i]) && timestamps[i]<=now && now-timestamps[i]<=this.#maxAge);
      if(!fresh){previous=null;samples.length=0;}
      else if(!previous || (now-previous.at>=2000 && timestamps.every((value,i)=>value>previous.timestamps[i]))){
        const sample={at:now,timestamps,entities:[...this.#entities]};samples.push(sample);previous=sample;
        if(samples.length===2)return {blocked:true,detail:{verified:true,samples}};
      }
      if(now>=deadline)break;
      await this.#sleep(Math.min(2000,deadline-now));
    }
    return {blocked:true,detail:{verified:false,samples,error:'HA_PHYSICAL_OFF_UNVERIFIED'}};
  }
}
