import {AccessDenied,requireAdult,requireAccessContext,queueGrantPublication} from '../../shared/contracts.mjs';
const publicRequest=request=>Object.fromEntries(['id','learnerId','deviceId','activityId','epoch','createdAt','expiresAt','period','status','decidedAt','reason'].filter(key=>request[key]!==undefined).map(key=>[key,structuredClone(request[key])]));
const matches=(request,context)=>['learnerId','deviceId','activityId','clientSessionId'].every(key=>request[key]===context?.[key]);
export class ApprovalWorkflow {
  #repository;#service;#clock;#makeId;#makeNonce;#hashNonce;#nonceMatches;#recipient;#notifier;#resolve;#baseline;#logger;
  constructor({repository,service,clock,makeId,makeNonce,hashNonce,nonceMatches,recipientId,notifier,resolveActivity,baselineEligibility,logger}){
    if(![makeNonce,hashNonce,nonceMatches].every(value=>typeof value==='function'))throw new TypeError('Approval token primitives required');
    this.#hashNonce=hashNonce;this.#nonceMatches=nonceMatches;this.#repository=repository;this.#service=service;this.#clock=clock;this.#makeId=makeId;this.#makeNonce=makeNonce;this.#recipient=recipientId;this.#notifier=notifier;this.#resolve=resolveActivity;this.#baseline=baselineEligibility;this.#logger=logger;
  }
  #context(context){requireAccessContext(context);if(!['learnerId','clientSessionId'].every(key=>typeof context[key]==='string' && context[key].trim() && context[key].length<=128))throw new AccessDenied('KIOSK_CONTEXT_REQUIRED');}
  async #target(context){const target=await this.#resolve?.(context);if(!target || target.id!==context.activityId || (target.deviceId && target.deviceId!==context.deviceId))throw new AccessDenied('SUPERVISION_ACTIVITY_UNKNOWN');return target;}
  async #eligible(context){const result=await this.#baseline?.(context);if(result?.allowed!==true)throw new AccessDenied('SUPERVISION_BASELINE_DENIED');}
  #expire(state,now){
    for(const request of Object.values(state.requests))if(request.status==='pending' && request.expiresAt<=now){request.status='expired';request.decidedAt=request.expiresAt;request.notification.status='cancelled';}
    for(const grant of Object.values(state.grants))if(grant.revokedAt==null && grant.expiresAt<=now){grant.revokedAt=now;queueGrantPublication(state,state.requests[grant.requestId],false,now);}
  }
  async requestPermission({context,idempotencyKey}){
    this.#context(context);if(typeof idempotencyKey!=='string' || !idempotencyKey || idempotencyKey.length>128)throw new TypeError('Request idempotency key required');
    await this.#target(context);await this.#baseline?.prepare?.(context);
    const result=await this.#service.exclusive(async()=>{
      const target=await this.#target(context);await this.#eligible(context);
      return this.#repository.transaction(state=>{
        const now=this.#clock.now();this.#expire(state,now);const device=state.devices[context.deviceId];
        if(!device || device.active || device.publication!=='acknowledged')throw new AccessDenied();
        const key=`request:${context.clientSessionId}:${idempotencyKey}`,previous=state.idempotency[key];
        if(previous){const request=state.requests[previous.requestId];if(!request || !matches(request,context))throw new AccessDenied('SUPERVISION_CONTEXT_MISMATCH');return publicRequest(request);}
        const requests=Object.values(state.requests).filter(request=>request.learnerId===context.learnerId);
        const pending=requests.find(request=>request.deviceId===context.deviceId && request.status==='pending');
        if(pending){if(pending.activityId!==context.activityId)throw new AccessDenied('SUPERVISION_REQUEST_PENDING');if(!matches(pending,context))throw new AccessDenied('SUPERVISION_CONTEXT_MISMATCH');return publicRequest(pending);}
        if(requests.some(request=>request.status!=='pending' && now-(request.decidedAt??request.createdAt)<30000))throw new AccessDenied('SUPERVISION_REQUEST_COOLDOWN');
        if(requests.filter(request=>now-request.createdAt<600000).length>=3)throw new AccessDenied('SUPERVISION_REQUEST_RATE_LIMITED');
        const id=this.#makeId(),request={id,deviceId:context.deviceId,learnerId:context.learnerId,activityId:context.activityId,clientSessionId:context.clientSessionId,target:structuredClone(target),epoch:state.epoch,createdAt:now,expiresAt:now+120000,period:{kind:'occurrence',id,startsAt:now,endsAt:now+720000},status:'pending',actions:{},notification:{status:'pending',attempt:0,nextAttemptAt:now}};
        state.requests[id]=request;state.idempotency[key]={kind:'request',requestId:id};state.audit.push({kind:'approval_requested',requestId:id,epoch:state.epoch,deviceId:context.deviceId,learnerId:context.learnerId,activityId:context.activityId,at:now});return publicRequest(request);
      });
    });
    await this.#notifyOne(result.id);this.#logger?.info?.('supervision.request.created',{requestId:result.id,deviceId:context.deviceId,learnerId:context.learnerId,activityId:context.activityId});return result;
  }
  async #notifyOne(requestId){
    let delivery;
    await this.#service.exclusive(async()=>{
      await this.#repository.transaction(state=>{
        const request=state.requests[requestId],now=this.#clock.now();this.#expire(state,now);
        if(!request || request.status!=='pending' || request.epoch!==state.epoch || request.notification.status==='accepted' || request.notification.nextAttemptAt>now || !this.#notifier || !this.#recipient)return;
        const actions={approveNonce:this.#makeNonce(),denyNonce:this.#makeNonce()},deliveryId=this.#makeId();
        for(const decision of ['approve','deny'])request.actions[decision]={hash:this.#hashNonce(actions[`${decision}Nonce`]),recipientId:this.#recipient,epoch:request.epoch,expiresAt:request.expiresAt,consumedAt:null};
        const attempt=request.notification.attempt+1;request.notification={status:'sending',attempt,deliveryId,nextAttemptAt:now+Math.min(30000,1000*2**Math.min(5,attempt-1))};
        delivery={request:{...publicRequest(request),label:request.target.label},recipient:this.#recipient,actions,deliveryId};
      });
    });
    if(!delivery)return;
    let effect;
    // Start the transport under admission, then let Stop proceed while it awaits I/O.
    await this.#service.exclusive(async()=>{const state=await this.#repository.read(),request=state.requests[requestId];if(request?.status==='pending' && request.epoch===state.epoch && request.notification.deliveryId===delivery.deliveryId)effect={promise:this.#notifier.notify(delivery)};});
    if(!effect)return;
    let accepted=false;try{accepted=(await effect.promise)?.accepted===true;}catch{}
    await this.#repository.transaction(state=>{const request=state.requests[requestId];if(request?.status==='pending' && request.notification.deliveryId===delivery.deliveryId)request.notification.status=accepted?'accepted':'failed';});
    this.#logger?.info?.('supervision.notification.outcome',{requestId,accepted});
  }
  async findAction({nonce,decision,recipientId}){
    if(!['approve','deny'].includes(decision) || typeof nonce!=='string' || recipientId!==this.#recipient)return null;
    const state=await this.#repository.read();
    for(const request of Object.values(state.requests)){const action=request.actions[decision];if(action?.recipientId===recipientId && this.#nonceMatches(action.hash,nonce))return {requestId:request.id};}
    return null;
  }
  async decideAuthenticated({requestId,decision,actor}){
    requireAdult(actor);if(!['approve','deny'].includes(decision))throw new AccessDenied('SUPERVISION_CALLBACK_INVALID');
    const nonce=this.#makeNonce();
    await this.#service.exclusive(()=>this.#repository.transaction(state=>{
      const request=state.requests[requestId],now=this.#clock.now();
      if(!request || request.epoch!==state.epoch || request.expiresAt<=now || state.devices[request.deviceId]?.active)throw new AccessDenied('SUPERVISION_EPOCH_REVOKED');
      request.actions[decision]={hash:this.#hashNonce(nonce),recipientId:this.#recipient,epoch:request.epoch,expiresAt:request.expiresAt,consumedAt:null};
    }));
    return this.decideRequest({requestId,decision,actor,nonce});
  }
  async decideRequest({requestId,decision,actor,nonce}){
    requireAdult(actor);if(!['approve','deny'].includes(decision) || typeof nonce!=='string')throw new AccessDenied('SUPERVISION_CALLBACK_INVALID');
    const before=await this.#repository.read(),pending=before.requests[requestId];if(pending?.status==='pending')await this.#baseline?.prepare?.(pending);
    let transitioned=false;
    const result=await this.#service.exclusive(async()=>{
      await this.#repository.transaction(state=>this.#expire(state,this.#clock.now()));
      const state=await this.#repository.read(),request=state.requests[requestId],now=this.#clock.now();
      if(!request || request.epoch!==state.epoch || state.devices[request.deviceId]?.active)throw new AccessDenied('SUPERVISION_EPOCH_REVOKED');
      const action=request.actions[decision];
      if(!action || action.recipientId!==this.#recipient || (actor.recipientId && actor.recipientId!==action.recipientId) || action.epoch!==state.epoch || action.expiresAt<=now || !this.#nonceMatches(action.hash,nonce))throw new AccessDenied('SUPERVISION_CALLBACK_INVALID');
      if(request.status!=='pending')return publicRequest(request);
      if(decision==='approve'){const target=await this.#target(request);if(JSON.stringify(target)!==JSON.stringify(request.target))throw new AccessDenied('SUPERVISION_TARGET_CHANGED');await this.#eligible(request);}
      return this.#repository.transaction(draft=>{
        const now=this.#clock.now();this.#expire(draft,now);const current=draft.requests[requestId];
        if(current.status==='expired')return publicRequest(current);if(current.status!=='pending' || current.epoch!==draft.epoch)throw new AccessDenied('SUPERVISION_EPOCH_REVOKED');
        transitioned=true;current.status=draft.mode?.required===false?'cancelled':decision==='approve'?'approved':'denied';current.decisionActorId=actor.id;current.decidedAt=now;current.actions[decision].consumedAt=now;current.notification.status='cancelled';
        if(current.status==='approved'){
          draft.grants[requestId]={requestId,epoch:draft.epoch,learnerId:current.learnerId,deviceId:current.deviceId,activityId:current.activityId,clientSessionId:current.clientSessionId,expiresAt:Math.min(now+600000,current.period.endsAt),sessionId:null,publication:'pending',revokedAt:null};queueGrantPublication(draft,current,true,now);
        }
        draft.audit.push({kind:'approval_decided',requestId,decision:current.status,actorId:actor.id,authenticatedBy:actor.authenticatedBy,recipientId:actor.recipientId??null,epoch:draft.epoch,at:now});return publicRequest(current);
      });
    });
    await this.#service.reconcile();this.#logger?.info?.(transitioned?'supervision.request.decided':'supervision.request.decision_observed',{requestId,status:result.status,actorId:actor.id,requestedDecision:decision});return result;
  }
  #grant(state,requestId,context){
    this.#context(context);const request=state.requests[requestId],grant=state.grants[requestId],now=this.#clock.now();
    if(!request || !grant || !matches(request,context))throw new AccessDenied('SUPERVISION_CONTEXT_MISMATCH');
    if(request.epoch!==state.epoch || grant.epoch!==state.epoch || grant.revokedAt!=null || state.devices[context.deviceId]?.active)throw new AccessDenied('SUPERVISION_EPOCH_REVOKED');
    if(request.status!=='approved' || grant.publication!=='acknowledged' || now>=grant.expiresAt)throw new AccessDenied('SUPERVISION_GRANT_UNAVAILABLE');
    return {request,grant};
  }
  /** Caller is the guard, already under the shared admission fence. */
  async contextForPermit(context){
    const state=await this.#repository.read(),{request,grant}=this.#grant(state,context.requestId,context);
    if(!grant.sessionId || grant.sessionId!==context.sessionId)throw new AccessDenied('SUPERVISION_SESSION_REQUIRED');
    await this.#eligible(context);return {period:structuredClone(request.period),expiresAt:grant.expiresAt,sessionId:grant.sessionId};
  }
  async consumeGrant({requestId,context}){
    this.#context(context);await this.#target(context);await this.#baseline?.prepare?.(context);
    return this.#service.exclusive(async()=>{
      const state=await this.#repository.read(),{request}=this.#grant(state,requestId,context);
      await this.#eligible(context);const decision=await this.#service.decideActivity({deviceId:context.deviceId,period:request.period});
      if(!decision.allowed || (decision.validUntil!=null && decision.validUntil<=this.#clock.now()))throw new AccessDenied('SUPERVISION_POLICY_DENIED');
      return this.#repository.transaction(draft=>{
        const {grant}=this.#grant(draft,requestId,context);
        if(!grant.sessionId){grant.sessionId=this.#makeId();grant.consumedAt=this.#clock.now();draft.audit.push({kind:'approval_consumed',requestId,sessionId:grant.sessionId,epoch:draft.epoch,at:grant.consumedAt});}
        return {sessionId:grant.sessionId,expiresAt:grant.expiresAt};
      });
    });
  }
  async getRequest({requestId,context}){
    this.#context(context);return this.#service.exclusive(async()=>{
      const snapshot=await this.#repository.read(),request=snapshot.requests[requestId];
      if(!request || !matches(request,context))throw new AccessDenied('SUPERVISION_CONTEXT_MISMATCH');
      if(request.status==='pending' && request.expiresAt<=this.#clock.now())await this.#repository.transaction(state=>this.#expire(state,this.#clock.now()));
      const current=await this.#repository.read(),reply=publicRequest(current.requests[requestId]),grant=current.grants[requestId];
      if(grant && (grant.revokedAt!=null || grant.expiresAt<=this.#clock.now()))reply.status=grant.expiresAt<=this.#clock.now()?'expired':'revoked';return reply;
    });
  }
  async endSession({requestId,context}){
    this.#context(context);
    const result=await this.#service.exclusive(()=>this.#repository.transaction(state=>{
      const request=state.requests[requestId],now=this.#clock.now();this.#expire(state,now);
      if(!request || !matches(request,context))throw new AccessDenied('SUPERVISION_CONTEXT_MISMATCH');
      if(request.status==='pending'){request.status='cancelled';request.decidedAt=now;request.notification.status='cancelled';}
      const grant=state.grants[requestId];if(grant && grant.revokedAt==null){grant.revokedAt=now;queueGrantPublication(state,request,false,now);state.audit.push({kind:'approval_session_ended',requestId,sessionId:grant.sessionId,epoch:state.epoch,at:now});}
      return {ended:true};
    }));
    await this.#service.reconcile();this.#logger?.info?.('supervision.session.ended',{requestId,deviceId:context.deviceId});return result;
  }
  async cancelRequest({requestId,context}){
    this.#context(context);return this.#service.exclusive(()=>this.#repository.transaction(state=>{
      const request=state.requests[requestId],now=this.#clock.now();this.#expire(state,now);
      if(!request || !matches(request,context))throw new AccessDenied('SUPERVISION_CONTEXT_MISMATCH');
      if(request.status==='pending'){request.status='cancelled';request.decidedAt=now;request.notification.status='cancelled';}return publicRequest(request);
    }));
  }
  async reconcile(){
    await this.#service.exclusive(()=>this.#repository.transaction(state=>this.#expire(state,this.#clock.now())));await this.#service.reconcile();
    const state=await this.#repository.read();for(const request of Object.values(state.requests))if(request.status==='pending')await this.#notifyOne(request.id);
  }
}
