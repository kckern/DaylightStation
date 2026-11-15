import {CURRENT_PERIOD} from '../../shared/contracts.mjs';
export class StateGatesSupervisionPort {
  #modePrincipal;#householdId;#principal;#ingress;#query;
  constructor({householdId,principal,modePrincipal,ingress,getCurrentEntitlements}){this.#modePrincipal=modePrincipal;this.#householdId=householdId;this.#principal=principal;this.#ingress=ingress;this.#query=getCurrentEntitlements;}
  async publishStop({deviceId,active,sourceRevision,observedAt}){
    const result=await this.#ingress.observe(this.#householdId,this.#principal,{assertionId:`supervision:stop:${deviceId}`,claimTypeId:'supervision.stop-active',subject:{kind:'device',id:deviceId},period:CURRENT_PERIOD,value:active,sourceRevision,observedAt,validFrom:observedAt});
    return {projectionRevision:result.currentRevision};
  }
  async publishMode({required,sourceRevision,observedAt,expiresAt}){
    return this.#ingress.observe(this.#householdId,this.#modePrincipal,{assertionId:'supervision:approval-mode',claimTypeId:'supervision.approval-required',subject:{kind:'household',id:this.#householdId},period:CURRENT_PERIOD,value:required,sourceRevision,observedAt,validFrom:observedAt,validUntil:expiresAt});
  }
  async publishGrant({request,valid,sourceRevision,observedAt=request.decidedAt??request.createdAt,expiresAt}){
    return this.#ingress.observe(this.#householdId,this.#principal,{assertionId:`supervision:grant:${request.id}`,claimTypeId:'supervision.grant-valid',subject:{kind:'device',id:request.deviceId},period:request.period,value:valid,sourceRevision,observedAt,validFrom:observedAt,validUntil:expiresAt});
  }
  async decideActivity({deviceId,period=CURRENT_PERIOD}){
    const result=await this.#query(this.#householdId,{capabilityId:period.kind==='occurrence'?'supervision.activity':'supervision.activity-normal',subjectKind:'device',subjectId:deviceId,periodKind:period.kind,periodId:period.id});
    const item=result.items?.find(value=>value.period?.startsAt===period.startsAt && value.period?.endsAt===period.endsAt);
    return {allowed:item?.decision==='granted',decisionId:`supervision:activity:${deviceId}:${result.currentRevision}`,validUntil:item?.validUntil??null};
  }
  async decide({deviceId}){
    const result=await this.#query(this.#householdId,{capabilityId:'supervision.interactive',subjectKind:'device',subjectId:deviceId,periodKind:CURRENT_PERIOD.kind,periodId:CURRENT_PERIOD.id});
    const item=result.items?.find(value=>value.period?.startsAt===0 && value.period?.endsAt==null);
    return {allowed:item?.decision==='granted',decisionId:`supervision:${deviceId}:${result.currentRevision}`,validUntil:item?.validUntil??null};
  }
}
