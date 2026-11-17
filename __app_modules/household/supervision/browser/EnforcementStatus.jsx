import React from 'react';
import {presentEnforcement} from './enforcementPresentation.js';
/** Read-only evidence; this view never issues Stop or release commands. */
export function EnforcementStatus({consumers=null,incidents=[],incidentReportingError=null,nowMs=Date.now()}){
  return <>
      {consumers===null?<p>Enforcement status unavailable</p>:consumers.map(item=>{const label=item.capability==='ha-stop'?'Power':item.capability==='portal-keys'?'Buttons':item.capability==='browser'?'App':item.capability;const presentation=presentEnforcement(item,nowMs);return <p key={`${item.deviceId}:${item.capability}`}>{item.deviceLabel??item.deviceId} — {label}: {presentation.state}{['acknowledged','verified'].includes(presentation.state)?` (${presentation.reason})`:` — ${presentation.reason}`}</p>;})}
      {incidents.filter(incident=>incident.status!=='watching').map(incident=><p key={incident.incidentId}>{incident.deviceId} — {incident.capability}: alert {incident.alert.status}{incident.alert.status==='accepted'?' — phone delivery unknown':['pending','failed'].includes(incident.alert.status)?' — retry pending':''}{incident.recoveredAt?`; recovery ${incident.recovery.status}${incident.recovery.status==='accepted'?' — phone delivery unknown':['pending','failed'].includes(incident.recovery.status)?' — retry pending':''}`:''}</p>)}
      {(incidentReportingError || consumers?.some(item=>item.incidentReportingError)) && <p>Incident reporting unavailable</p>}
  </>;
}
