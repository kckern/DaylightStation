import {AccessDenied,requireAdult,serialQueue,queueGrantPublication} from '../../shared/contracts.mjs';
/** Owns durable intent and publication ordering; State Gates alone evaluates policy. */
export class SupervisionService {
  #repository; #gates; #scopes; #clock; #fence=serialQueue(); #logger; #onIntentChanged;
  constructor({repository,stateGates,scopes,clock,logger,onIntentChanged=()=>{}}) {
    if(!repository || !stateGates || !clock?.now || !scopes || !Object.keys(scopes).length)throw new TypeError('Supervision dependencies required');
    this.#repository=repository;this.#gates=stateGates;this.#scopes=scopes;this.#clock=clock;this.#logger=logger;this.#onIntentChanged=onIntentChanged;
  }
  #notifyIntent(){Promise.resolve().then(()=>this.#onIntentChanged()).catch(error=>this.#logger?.warn?.('supervision.reconcile.pending',{error:error.message}));}
  exclusive(fn){return this.#fence(fn);}
  #targets(scopeId){const devices=this.#scopes[scopeId];if(!devices?.length)throw new AccessDenied('SUPERVISION_SCOPE_UNKNOWN');return [...new Set(devices)];}
  #publishIntent(state,deviceId,active){
    const key=`stop:${deviceId}`;const sourceRevision=(state.revisions[key]??0)+1;state.revisions[key]=sourceRevision;
    state.outbox.push({id:`${key}:${sourceRevision}`,kind:'stop',payload:{deviceId,active,sourceRevision,observedAt:this.#clock.now()}});
    state.devices[deviceId].publication='pending';
  }
  async initialize({legacy={}}={}){return this.exclusive(async()=>{
    await this.#repository.transaction(state=>{
      const now=this.#clock.now();const asTime=value=>typeof value==='number'?value:Date.parse(value);
      const legacyActive=legacy.invalid===true || (typeof legacy.fitness?.lockedUntil==='number'?legacy.fitness.lockedUntil*1000:asTime(legacy.fitness?.lockedUntil))>now || asTime(legacy.shutdown?.locked_until??legacy.shutdown?.lockedUntil)>now;
      for(const deviceId of new Set(Object.values(this.#scopes).flat()))if(!state.devices[deviceId]){
        state.devices[deviceId]={active:legacyActive,epoch:state.epoch,actorId:legacyActive?'legacy-migration':'system',requestedAt:now,publication:'pending',releaseRequested:false,actuation:{}};
        this.#publishIntent(state,deviceId,legacyActive);
      }
    });await this.#flush();return this.status({});
  });}
  async #flush(){
    for(;;){
      const entry=(await this.#repository.read()).outbox[0];if(!entry)break;
      try {
        if(entry.kind==='grant'){await this.#gates.publishGrant(entry.payload);await this.#repository.transaction(state=>{if(state.outbox[0]?.id!==entry.id)return;state.outbox.shift();const id=entry.payload.request.id;if(state.revisions[`grant:${id}`]===entry.payload.sourceRevision)state.grants[id].publication='acknowledged';});continue;}
        if(entry.kind==='mode'){await this.#gates.publishMode(entry.payload);await this.#repository.transaction(state=>{if(state.outbox[0]?.id===entry.id)state.outbox.shift();});continue;}
        if(entry.kind!=='stop')break;
        await this.#gates.publishStop(entry.payload);
        await this.#repository.transaction(state=>{
          if(state.outbox[0]?.id!==entry.id)return;
          state.outbox.shift();const device=state.devices[entry.payload.deviceId];
          if(!state.outbox.some(item=>item.kind==='stop' && item.payload.deviceId===entry.payload.deviceId)){
            device.publication='acknowledged';
            if(device.releaseRequested && !entry.payload.active){device.active=false;device.releaseRequested=false;}
          }
        });
      }catch(error){this.#logger?.warn?.('supervision.publication.pending',{kind:entry.kind,error:error.message});break;}
    }
  }
  publishMode(payload){return this.exclusive(async()=>{
    const accepted=await this.#repository.transaction(state=>{
      if(state.mode && (payload.observedAt<state.mode.observedAt || (payload.evidence?.entityId===state.mode.evidence?.entityId && Number.isSafeInteger(payload.evidence?.sourceRevision) && Number.isSafeInteger(state.mode.evidence?.sourceRevision) && payload.evidence.sourceRevision<state.mode.evidence.sourceRevision)))return false;
      const sourceRevision=(state.revisions.mode??0)+1;state.revisions.mode=sourceRevision;
      state.mode={...payload,sourceRevision};state.outbox.push({id:`mode:${sourceRevision}`,kind:'mode',payload:{...payload,sourceRevision}});return true;
    });await this.#flush();return accepted;
  });}
  decideActivity(context){return this.#gates.decideActivity(context);}
  reconcile(){return this.exclusive(()=>this.#flush());}
  async stop({actor,scopeId,source='parent',idempotencyKey}){
    requireAdult(actor);if(!idempotencyKey)throw new TypeError('Idempotency key required');
    return this.exclusive(async()=>{
      const targets=this.#targets(scopeId);
      await this.#repository.transaction(state=>{
        if(state.idempotency[idempotencyKey])return;
        state.epoch++;const now=this.#clock.now();
        for(const deviceId of targets){state.devices[deviceId]={active:true,epoch:state.epoch,actorId:actor.id,requestedAt:now,publication:'pending',releaseRequested:false,actuation:{}};this.#publishIntent(state,deviceId,true);}
        for(const request of Object.values(state.requests))if(targets.includes(request.deviceId) && request.status==='pending'){request.status='revoked';request.decidedAt=now;request.notification.status='cancelled';}
        for(const grant of Object.values(state.grants))if(targets.includes(grant.deviceId) && grant.revokedAt==null){grant.revokedAt=now;queueGrantPublication(state,state.requests[grant.requestId],false,now);}
        state.idempotency[idempotencyKey]={kind:'stop',epoch:state.epoch};state.audit.push({kind:'stop',actorId:actor.id,source,deviceIds:targets,epoch:state.epoch,at:now});
      });this.#logger?.info?.('supervision.intent.accepted',{actorId:actor.id,deviceIds:targets,action:'stop'});this.#notifyIntent();await this.#flush();this.#notifyIntent();return this.#status(targets);
    });
  }
  async release({actor,scopeId,idempotencyKey}){
    requireAdult(actor);if(!idempotencyKey)throw new TypeError('Idempotency key required');
    return this.exclusive(async()=>{
      const targets=this.#targets(scopeId);
      await this.#repository.transaction(state=>{
        if(state.idempotency[idempotencyKey])return;
        for(const deviceId of targets){if(!state.devices[deviceId])throw new AccessDenied('SUPERVISION_DEVICE_UNKNOWN');state.devices[deviceId].releaseRequested=true;this.#publishIntent(state,deviceId,false);}
        state.idempotency[idempotencyKey]={kind:'release',epoch:state.epoch};state.audit.push({kind:'release_requested',actorId:actor.id,epoch:state.epoch,at:this.#clock.now()});
      });this.#logger?.info?.('supervision.intent.accepted',{actorId:actor.id,deviceIds:targets,action:'release'});this.#notifyIntent();await this.#flush();this.#notifyIntent();return this.#status(targets);
    });
  }
  async #status(deviceIds){
    const state=await this.#repository.read();const devices=deviceIds.map(id=>state.devices[id]);
    return {epoch:state.epoch,active:devices.some(device=>!device || device.active),deviceIds,actorId:devices.find(device=>device?.active)?.actorId??'system',requestedAt:Math.max(0,...devices.map(device=>device?.requestedAt??0)),publication:devices.every(device=>device?.publication==='acknowledged')?'acknowledged':'pending',commandRevisions:Object.fromEntries(deviceIds.map(id=>[id,state.revisions[`stop:${id}`]??0])),actuationByDevice:Object.fromEntries(deviceIds.map(id=>[id,state.devices[id]?.actuation??{}]))};
  }
  status({deviceId}={}){return this.#status(deviceId?[deviceId]:[...new Set(Object.values(this.#scopes).flat())]);}
}
