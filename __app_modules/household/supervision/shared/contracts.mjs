export const CURRENT_PERIOD = Object.freeze({kind:'interval',id:'supervision-current',startsAt:0,endsAt:null});
export const ACCESS_LEASE_MS = 5000;
export class AccessDenied extends Error {
  constructor(code='SUPERVISION_BLOCKED') { super(code); this.name='AccessDenied';this.code=code;this.status=403; }
}
export function requireAdult(actor) {
  if (!actor?.id || !actor.authenticatedBy || !Array.isArray(actor.roles) || !actor.roles.some(role=>['owner','guardian'].includes(role))) throw new AccessDenied('PARENT_AUTHORITY_REQUIRED');
  return actor;
}
export function requireAccessContext(context) {
  if (!context || !['deviceId','activityId'].every(key=>typeof context[key]==='string' && context[key].trim())) throw new AccessDenied('KIOSK_CONTEXT_REQUIRED');
  return context;
}
export function emptySupervisionState() {
  return {schema:'daylight.supervision/v1',epoch:0,devices:{},revisions:{},outbox:[],audit:[],idempotency:{},requests:{},grants:{}};
}
export function validateSupervisionState(state) {
  if (state?.schema!=='daylight.supervision/v1' || !Number.isSafeInteger(state.epoch) || state.epoch<0 || !state.devices || !state.revisions || !Array.isArray(state.outbox) || !Array.isArray(state.audit) || !state.idempotency || !state.requests || !state.grants) throw new Error('Invalid supervision state');
  for (const device of Object.values(state.devices)) if (typeof device.active!=='boolean' || !['pending','acknowledged'].includes(device.publication)) throw new Error('Invalid supervision device state');
  const text=value=>typeof value==='string' && value.length>0;
  for(const [id,request] of Object.entries(state.requests)){
    if(request.id!==id || !['learnerId','deviceId','activityId','clientSessionId'].every(key=>text(request[key])) || !Number.isSafeInteger(request.epoch) || request.epoch<0 || !Number.isFinite(request.createdAt) || request.expiresAt!==request.createdAt+120000 || request.period?.kind!=='occurrence' || request.period.id!==id || request.period.startsAt!==request.createdAt || request.period.endsAt!==request.createdAt+720000 || !['pending','approved','denied','cancelled','expired','revoked'].includes(request.status) || !request.actions || !request.notification)throw new Error('Invalid supervision request');
    if(request.status==='approved' && (!Number.isFinite(request.decidedAt) || request.decidedAt<request.createdAt || request.decidedAt>=request.expiresAt || !text(request.decisionActorId)))throw new Error('Invalid supervision decision');
    for(const action of Object.values(request.actions))if(!/^[a-f0-9]{64}$/.test(action.hash) || !text(action.recipientId) || action.epoch!==request.epoch || action.expiresAt!==request.expiresAt)throw new Error('Invalid supervision callback authority');
  }
  for(const [id,grant] of Object.entries(state.grants)){
    const request=state.requests[id];
    if(!request || request.status!=='approved' || !Number.isFinite(request.decidedAt) || grant.expiresAt<=request.decidedAt || grant.requestId!==id || grant.epoch!==request.epoch || !['learnerId','deviceId','activityId','clientSessionId'].every(key=>grant[key]===request[key]) || !Number.isFinite(grant.expiresAt) || grant.expiresAt>request.period.endsAt || grant.expiresAt>request.decidedAt+600000 || !['pending','acknowledged','expired'].includes(grant.publication) || !(grant.sessionId===null || text(grant.sessionId)) || !(grant.revokedAt===null || Number.isFinite(grant.revokedAt)))throw new Error('Invalid supervision grant');
  }
  return state;
}
/** One writer also owns the workflow admission fence, independently of disk transactions. */
export function serialQueue() {
  let tail=Promise.resolve();
  return fn=>{const result=tail.then(fn);tail=result.catch(()=>{});return result;};
}

/** Stable per-request source counter; expired periods need no live authority. */
export function queueGrantPublication(state,request,valid,now){
  const grant=state.grants[request.id];
  if(!valid && now>=request.period.endsAt){grant.publication='expired';return;}
  const key=`grant:${request.id}`,sourceRevision=(state.revisions[key]??0)+1;state.revisions[key]=sourceRevision;grant.publication='pending';
  state.outbox.push({id:`${key}:${sourceRevision}`,kind:'grant',payload:{request:{id:request.id,deviceId:request.deviceId,createdAt:request.createdAt,decidedAt:request.decidedAt,period:request.period},valid,sourceRevision,observedAt:now,expiresAt:valid?grant.expiresAt:request.period.endsAt}});
}
