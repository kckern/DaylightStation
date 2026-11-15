/** Authenticated actuator; successful HTTP alone is not a key-suppression ACK. */
export class PortalKeysLockdownAdapter {
  #baseUrl; #token; #fetch; #logger;
  constructor({baseUrl,token,fetchFn=fetch,logger=console}={}){this.#baseUrl=baseUrl?.replace(/\/$/,'');this.#token=token;this.#fetch=fetchFn;this.#logger=logger;}
  async setLockdown({locked,lockedUntil=null,commandRevision=null}){
    if(!this.#baseUrl || !this.#token)return {ok:false,skipped:true};
    if(commandRevision!=null && (!Number.isSafeInteger(commandRevision) || commandRevision<1))throw new TypeError('Positive native command revision required');
    const until=lockedUntil?Date.parse(lockedUntil):null;
    if(until!=null && !Number.isFinite(until))throw new TypeError('Invalid lockdown deadline');
    const res=await this.#fetch(`${this.#baseUrl}/lockdown`,{method:'PUT',headers:{'Content-Type':'application/json','X-Lockdown-Token':this.#token},body:JSON.stringify({locked:!!locked,lockedUntil:until,...(commandRevision==null?{}:{revision:commandRevision})}),signal:AbortSignal.timeout(5000)});
    if(!res.ok)throw Object.assign(new Error(`Portal Keys lockdown HTTP ${res.status}`),{code:'NATIVE_LOCKDOWN_REJECTED',contacted:true});
    const body=await res.json();
    if(body.lockdownActive!==!!locked || (commandRevision!=null && (body.lockdownProtocolVersion!==2 || body.lockdownRevision!==commandRevision)))throw Object.assign(new Error('Portal Keys acknowledgement does not match requested restriction'),{code:'NATIVE_ACK_MISMATCH',contacted:true});
    this.#logger.info?.('shutdown.portal_synced',{locked:!!locked,commandRevision});return {ok:true,blocked:body.lockdownActive,commandRevision};
  }
  stop({commandRevision}){return this.setLockdown({locked:true,commandRevision});}
  release({commandRevision}){return this.setLockdown({locked:false,commandRevision});}
  async probe(){
    if(!this.#baseUrl || !this.#token)return {capabilities:[],error:'CAPABILITY_UNAVAILABLE'};
    const response=await this.#fetch(`${this.#baseUrl}/status`,{signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('Portal Keys status unavailable');
    const body=await response.json();return {capabilities:body.serviceBound && body.config?.lockdownProtocolVersion===2?['portal-keys']:[],locked:body.config?.lockdownActive,commandRevision:body.config?.lockdownRevision};
  }
}
