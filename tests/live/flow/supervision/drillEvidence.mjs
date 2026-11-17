/** Test-only evidence gate. It has no device-control or household authority ports. */
function haOffVerified(row, nowMs) {
  const samples=row.detail?.samples;
  if(row.detail?.verified!==true || !Array.isArray(samples) || samples.length!==2 || !Number.isFinite(row.requestedAt))return false;
  const [first,second]=samples;
  if(!Number.isFinite(first.at) || !Number.isFinite(second.at) || first.at<row.requestedAt || second.at-first.at<2000 || second.at-row.requestedAt>30000 || second.at>nowMs)return false;
  if(!Array.isArray(first.entities) || !first.entities.length || JSON.stringify(first.entities)!==JSON.stringify(second.entities))return false;
  return samples.every(sample=>Array.isArray(sample.timestamps) && sample.timestamps.length===sample.entities.length && sample.timestamps.every(time=>Number.isFinite(time) && time<=sample.at && sample.at-time<=10000)) && second.timestamps.every((time,i)=>time>first.timestamps[i]);
}
export function evaluateDrillEvidence({runId,nowMs,phase,sinceMs,devices,revisions,consumers,observations}) {
  const blocked=!['released','active'].includes(phase);
  const rows=devices.map(device=>{
    const revision=revisions[device.deviceId];
    const required=device.capabilities.map(capability=>{
      const matches=consumers.filter(row=>row.deviceId===device.deviceId && row.capability===capability);
      const row=matches[0];
      const current=matches.length===1 && Number.isSafeInteger(revision) && revision>0 && row.commandRevision===revision && row.acknowledged===true && row.desiredBlocked===blocked && row.blocked===blocked && Number.isFinite(row.lastContactAt) && row.lastContactAt<=nowMs && nowMs-row.lastContactAt<=5000;
      return {capability,current:!!current,physicalOff:capability!=='ha-stop' || !blocked || phase==='offline' || (current && haOffVerified(row,nowMs))};
    });
    const checks=device.checks.map(check=>({check,observed:observations.some(observation=>{
      const time=Date.parse(observation.observedAt);
      return observation.runId===runId && observation.deviceId===device.deviceId && observation.commandRevision===revision && observation.phase===phase && observation.check===check && observation.passed===true && typeof observation.observer==='string' && observation.observer.trim().length>0 && typeof observation.artifactId==='string' && observation.artifactId.trim().length>0 && observation.artifactId===device.artifactId && typeof observation.observedAt==='string' && /(Z|[+-]\d\d:\d\d)$/.test(observation.observedAt) && Number.isFinite(time) && time>=sinceMs && time<=nowMs;
    })}));
    return {deviceId:device.deviceId,commandRevision:revision,acknowledged:required.length>0 && required.every(row=>row.current),physicallyObserved:checks.length>0 && checks.every(row=>row.observed) && required.every(row=>row.physicalOff),required,checks};
  });
  return {allEnforced:rows.length>0 && rows.every(row=>row.acknowledged && row.physicallyObserved),rows};
}

/** Rollback evidence must already be completed at the preflight clock. */
export function completedRollbackEvidence(rollback, nowMs) {
  const testedAt = rollback?.testedAt;
  const time = Date.parse(testedAt);
  return Boolean(rollback?.artifactId && rollback.ledgerPreserved === true
    && typeof testedAt === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(testedAt)
    && Number.isFinite(time) && Number.isFinite(nowMs) && time <= nowMs);
}
