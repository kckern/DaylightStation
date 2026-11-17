import React,{useState,useEffect} from 'react';
import {DaylightAPI} from '@/lib/api.mjs';
import {EnforcementStatus} from './EnforcementStatus.jsx';
import {publishLocalStop,clearLocalStop} from './localStop.js';
/** Verify one parent command without leaving an adult login on the child kiosk. */
export function ParentControls({api=DaylightAPI,onChanged,onOpenChange,devices=[]}){
  const [open,setOpen]=useState(false),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[action,setAction]=useState('stop'),[deviceId,setDeviceId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(null),[health,setHealth]=useState([]),[nowMs,setNowMs]=useState(()=>Date.now()),[diagnostics,setDiagnostics]=useState(null),[incidents,setIncidents]=useState([]),[enforcementError,setEnforcementError]=useState(null);
  useEffect(()=>{if(!open)return;let disposed=false;const read=async()=>{setNowMs(Date.now());try{const result=await api('api/v1/supervision/status');if(!disposed){setNowMs(Date.now());setHealth(result.enforcement?.consumers??result.consumers??[]);setIncidents(result.enforcement?.incidents??result.incidents??[]);setEnforcementError(result.enforcement?.incidentReportingError??result.incidentReportingError??null);}}catch{if(!disposed)setHealth(null);}};void read();const timer=setInterval(()=>void read(),2000);return()=>{disposed=true;clearInterval(timer);};},[open,api]);
  async function submit(event){
    event.preventDefault();setBusy(true);setError(null);
    try{
      if(action==='diagnostics'){const result=await api('api/v1/supervision/parent-diagnostics',{username,password},'POST');setDiagnostics(result);setPassword('');return;}
      const result=await api(`api/v1/supervision/${action==='enroll'?'enroll':'parent-command'}`,{username,password,action,...(action==='enroll'?{deviceId:deviceId||devices[0]}:{})},'POST');
      if(action!=='enroll'){if(result.active)publishLocalStop({epoch:result.epoch});else clearLocalStop();}
      setPassword('');setOpen(false);onOpenChange?.(false);await onChanged?.();
    }catch{setPassword('');setError('Could not verify parent access.');}
    finally{setBusy(false);}
  }
  return <div className="supervision-parent-controls">
    <button type="button" onClick={()=>{setOpen(true);onOpenChange?.(true);}}>Parent controls</button>
    {open && <section role="dialog" aria-modal="true" aria-label="Parent controls"><form onSubmit={submit}>
      <label>Parent username<input aria-label="Parent username" autoComplete="username" value={username} onChange={event=>setUsername(event.target.value)}/></label>
      <label>Parent password<input aria-label="Parent password" type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)}/></label>
      <label>Action<select aria-label="Parent action" value={action} onChange={event=>setAction(event.target.value)}><option value="enroll">Pair this kiosk</option><option value="stop">Stop all kiosks</option><option value="release">Release parental stop</option><option value="diagnostics">View parent diagnostics</option></select></label>
      {action==='enroll' && <label>Kiosk<select aria-label="Kiosk" value={deviceId||devices[0]||''} onChange={event=>setDeviceId(event.target.value)}>{devices.map(id=><option key={id} value={id}>{id}</option>)}</select></label>}
      <EnforcementStatus consumers={health} incidents={incidents} incidentReportingError={enforcementError} nowMs={nowMs}/>
      {diagnostics && <div aria-label="Parent diagnostics"><p>{diagnostics.mode?.known?(diagnostics.mode.required?'Approval required':'Normal mode'):'Source unavailable or stale'}</p><p>Condition: {diagnostics.condition?.entityId??'Not configured'}</p>{diagnostics.enforcement?.errors?.map(error=><p key={error}>{error}</p>)}{diagnostics.requests?.map(request=><p key={request.id}>{request.learnerId}: {request.activityId} — {request.status}; notification {request.notification?.status??'unknown'}</p>)}</div>}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy?'Verifying…':'Confirm'}</button>
      <button type="button" onClick={()=>{setPassword('');setDiagnostics(null);setOpen(false);onOpenChange?.(false);}}>Close</button>
    </form></section>}
  </div>;
}
