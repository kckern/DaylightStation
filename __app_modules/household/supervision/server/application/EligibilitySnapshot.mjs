/** Keeps owner I/O outside the shared Stop fence; absent or expired snapshots deny. */
export class EligibilitySnapshot {
  #clock;#read;#values=new Map();#jobs=new Map();
  constructor({clock,read}){this.#clock=clock;this.#read=read;}
  #key(context){return JSON.stringify([context.deviceId,context.learnerId,context.activityId]);}
  async prepare(context){
    const key=this.#key(context);if(this.#jobs.has(key))return this.#jobs.get(key);
    const started=this.#clock.now();
    const job=(async()=>{let value;try{value=await this.#read(context);}catch{value={allowed:false};}
      if(this.#values.size>=256 && !this.#values.has(key))this.#values.delete(this.#values.keys().next().value);
      this.#values.set(key,{value:value?.allowed===true?{allowed:true}:{allowed:false},at:started});return value;
    })();this.#jobs.set(key,job);try{return await job;}finally{if(this.#jobs.get(key)===job)this.#jobs.delete(key);}
  }
  async check(context){
    const key=this.#key(context),saved=this.#values.get(key),age=saved?this.#clock.now()-saved.at:Infinity;
    if(age>=1000 && !this.#jobs.has(key))void this.prepare(context);
    return saved && age>=0 && age<2000?{...saved.value}:{allowed:false};
  }
  port(){const check=context=>this.check(context);check.prepare=context=>this.prepare(context);return check;}
}
