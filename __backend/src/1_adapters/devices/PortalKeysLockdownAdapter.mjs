/** Authenticated actuator; successful HTTP alone is not a key-suppression ACK. */
export class PortalKeysLockdownAdapter {
  #baseUrl; #token; #fetch; #logger; #lastAck=null;
  constructor({baseUrl,token,fetchFn=fetch,logger=console}={}){this.#baseUrl=baseUrl?.replace(/\/$/,'');this.#token=token;this.#fetch=fetchFn;this.#logger=logger;}
  async setLockdown({locked,lockedUntil=null,commandRevision=null}){
    if(!this.#baseUrl || !this.#token)return {ok:false,skipped:true,code:'CAPABILITY_UNAVAILABLE'};
    if(commandRevision!=null && (!Number.isSafeInteger(commandRevision) || commandRevision<1))throw new TypeError('Positive native command revision required');
    const until=lockedUntil?Date.parse(lockedUntil):null;
    if(until!=null && !Number.isFinite(until))throw new TypeError('Invalid lockdown deadline');
    let res;
    try{
      res=await this.#fetch(`${this.#baseUrl}/lockdown`,{method:'PUT',headers:{'Content-Type':'application/json','X-Lockdown-Token':this.#token},body:JSON.stringify({locked:!!locked,lockedUntil:until,...(commandRevision==null?{}:{revision:commandRevision})}),signal:AbortSignal.timeout(5000)});
    }catch(cause){throw Object.assign(new Error('Portal Keys lockdown unavailable',{cause}),{code:'CAPABILITY_UNAVAILABLE'});}
    if(!res.ok)throw Object.assign(new Error(`Portal Keys lockdown HTTP ${res.status}`),{code:'NATIVE_LOCKDOWN_REJECTED',contacted:true});
    let body;
    try{body=await res.json();}catch(cause){throw Object.assign(new Error('Portal Keys acknowledgement is unreadable',{cause}),{code:'NATIVE_ACK_MISMATCH',contacted:true});}
    if(body?.lockdownActive!==!!locked || (commandRevision!=null && (body.lockdownProtocolVersion!==2 || body.lockdownRevision!==commandRevision)))throw Object.assign(new Error('Portal Keys acknowledgement does not match requested restriction'),{code:'NATIVE_ACK_MISMATCH',contacted:true});
    // The shutdown reconciler re-asserts the same state every few seconds; only a
    // change of acknowledged state is worth an info line.
    const ack=`${!!locked}:${commandRevision}`;
    (ack===this.#lastAck?this.#logger.debug:this.#logger.info)?.call(this.#logger,'shutdown.portal_synced',{locked:!!locked,commandRevision});
    this.#lastAck=ack;
    return {ok:true,blocked:body.lockdownActive,commandRevision};
  }
  stop({commandRevision}){return this.setLockdown({locked:true,commandRevision});}
  release({commandRevision}){return this.setLockdown({locked:false,commandRevision});}
  async probe(){
    if(!this.#baseUrl || !this.#token)return {capabilities:[],error:'CAPABILITY_UNAVAILABLE'};
    let body;
    try{
      const response=await this.#fetch(`${this.#baseUrl}/status`,{signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw new Error('Portal Keys status unavailable');
      body=await response.json();
    }catch(cause){throw Object.assign(new Error('Portal Keys status unavailable',{cause}),{code:'CAPABILITY_UNAVAILABLE'});}
    if(body?.serviceBound!==true || body.config?.lockdownProtocolVersion!==2)return {capabilities:[],error:'CAPABILITY_UNAVAILABLE'};
    return {capabilities:['portal-keys'],locked:body.config.lockdownActive,commandRevision:body.config.lockdownRevision};
  }
}
