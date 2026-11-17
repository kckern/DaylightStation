/** A native ACK and independent physical verification are different evidence. */
export function presentEnforcement(health,nowMs,maxAgeMs=5000){
  const result={deviceId:health.deviceId,capability:health.capability};
  const age=nowMs-health.lastContactAt;
  if(health.blocked && health.detail?.verified===false)return {...result,state:'unverified',reason:health.capability==='ha-stop'?'power off unverified':'Physical enforcement unverified'};
  if(health.acknowledged===true && Number.isFinite(health.lastContactAt) && age>=0 && age<=maxAgeMs && !health.error){
    if(health.detail?.verified===false)return {...result,state:'unverified',reason:'Physical enforcement unverified'};
    return {...result,state:health.detail?.verified===true?'verified':'acknowledged',reason:health.blocked?'stopped':'ready'};
  }
  if(!health.acknowledged && !health.error && Number.isFinite(health.requestedAt) && nowMs>=health.requestedAt && nowMs-health.requestedAt<=maxAgeMs)return {...result,state:'requested',reason:'Awaiting acknowledgement'};
  return {...result,state:'unverified',reason:health.error??'Acknowledgement unavailable or stale'};
}
