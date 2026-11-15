import React,{useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {DaylightAPI} from '@/lib/api.mjs';
import {useWebSocketSubscription} from '@/hooks/useWebSocket.js';
import getLogger from '@/lib/logging/Logger.js';
import {useFitnessContext} from '../context/FitnessContext.jsx';
import {useIdentity} from '../identity/useIdentity.js';
import UnlockPrompt from '../player/overlays/UnlockPrompt.jsx';
import './FitnessGameGate.scss';
const CAPABILITY='fitness.games-unsupervised';
const current=(row,at)=>row && Number.isFinite(row.period?.startsAt) && Number.isFinite(row.period?.endsAt) && Number.isFinite(row.validFrom) && Number.isFinite(row.validUntil) && at>=row.period.startsAt && at<row.period.endsAt && at>=row.validFrom && at<row.validUntil;
function selectDecision(payload,householdId){
  const rows=(payload?.items??[]).filter(row=>row.capabilityId===CAPABILITY && row.subject?.kind==='household' && typeof row.subject.id==='string' && (!householdId || row.subject.id===householdId) && row.period?.kind==='local_day' && /^\d{4}-\d{2}-\d{2}$/.test(row.period.id??'') && current(row,Date.now()));
  return rows.length===1?rows[0]:null;
}
/** Calendar admission precedes mounting; existing game-specific gates remain inside. */
export function FitnessGameGate({moduleId,label,children,onClose}){
  const {fitnessConfiguration}=useFitnessContext();
  const householdId=fitnessConfiguration?._household??fitnessConfiguration?.fitness?._household??null;
  const identity=useIdentity(),identityRef=useRef(identity);identityRef.current=identity;
  const logger=useMemo(()=>getLogger().child({component:'fitness-game-gate'}),[]);
  const [snapshot,setSnapshot]=useState({row:null,status:'loading'}),[grant,setGrant]=useState(null),[pending,setPending]=useState(false),[error,setError]=useState(null);
  const generation=useRef(0),attempt=useRef(0),mounted=useRef(false),inFlight=useRef(false),live=useRef(null),pendingRef=useRef(false);
  const row=current(snapshot.row,Date.now()) && (!householdId || snapshot.row.subject.id===householdId)?snapshot.row:null;
  const scope=row?`${row.subject.id}:${row.period.id}:${moduleId}`:`unavailable:${householdId??''}:${moduleId}`;
  const known=row?.degraded!==true && ['satisfied','unsatisfied'].includes(row?.basisState);
  const allowed=known && (row.decision==='granted' || (grant?.scope===scope && Date.now()<grant.until));
  live.current={row,scope,known,allowed};
  const refresh=useCallback(async({invalidate=false}={})=>{
    if(inFlight.current && !invalidate)return;inFlight.current=true;const version=++generation.current;let timeout;
    if(invalidate)setSnapshot({row:null,status:'loading'});
    try{
      const payload=await Promise.race([DaylightAPI(`api/v1/entitlements?${new URLSearchParams({capabilityId:CAPABILITY,subjectKind:'household',periodKind:'local_day',...(householdId?{subjectId:householdId}:{})})}`),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Access check timed out')),2000);})]);
      if(!mounted.current || version!==generation.current)return;
      const next=selectDecision(payload,householdId);setSnapshot({row:next,status:next?'ready':'unavailable'});
    }catch{if(mounted.current && version===generation.current){setSnapshot(previous=>current(previous.row,Date.now())?previous:{row:null,status:'unavailable'});logger.warn('fitness.game.calendar_unavailable',{moduleId});}}
    finally{clearTimeout(timeout);if(version===generation.current)inFlight.current=false;}
  },[householdId,logger,moduleId]);
  useEffect(()=>{
    mounted.current=true;void refresh();const timer=setInterval(()=>void refresh(),15000);
    const focus=()=>void refresh();window.addEventListener('focus',focus);
    const visibility=()=>{if(document.visibilityState==='visible')void refresh();};document.addEventListener('visibilitychange',visibility);
    return()=>{mounted.current=false;generation.current++;inFlight.current=false;clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visibility);};
  },[refresh]);
  const event=useCallback(message=>{
    const value=message?.payload?.current??message?.payload;if(value?.capabilityId!==CAPABILITY)return;
    if(value.subject?.id && (householdId??live.current.row?.subject.id) && value.subject.id!==(householdId??live.current.row?.subject.id))return;
    const decision=value.decision??value.to?.decision;void refresh({invalidate:decision!=='granted' && live.current.row?.decision!==decision});
  },[refresh,householdId]);
  useWebSocketSubscription('state-gates',event,[event]);
  useEffect(()=>{
    if(!row)return;const timer=setTimeout(()=>{setSnapshot({row:null,status:'loading'});void refresh({invalidate:true});},Math.max(0,row.validUntil-Date.now()));return()=>clearTimeout(timer);
  },[row?.validUntil,refresh]);
  useLayoutEffect(()=>{
    attempt.current++;setGrant(null);setError(null);setPending(false);
    if(pendingRef.current){pendingRef.current=false;identityRef.current.clearUnlock();}
    return()=>{attempt.current++;if(pendingRef.current){pendingRef.current=false;identityRef.current.clearUnlock();}};
  },[scope]);
  useEffect(()=>{logger.info('fitness.game.calendar_verdict',{moduleId,householdId:row?.subject.id??householdId,periodId:row?.period.id??null,allowed:!!allowed,admin:!!grant && allowed});},[logger,moduleId,scope,!!allowed]);
  const cancel=()=>{attempt.current++;pendingRef.current=false;setPending(false);identityRef.current.clearUnlock();};
  async function unlock(){
    if(pendingRef.current || !live.current.known || live.current.row?.decision!=='denied')return;
    const version=++attempt.current,wanted=live.current.scope;pendingRef.current=true;setPending(true);setError(null);
    logger.info('fitness.game.sunday_unlock_requested',{moduleId,scope:wanted});
    try{
      const result=await identityRef.current.registerAdmin(moduleId);
      if(!mounted.current || version!==attempt.current || live.current.scope!==wanted || !current(live.current.row,Date.now()))return;
      if(result?.matched!==true || !result.userId){setError('Admin unlock was not granted.');return;}
      setGrant({scope:wanted,until:Math.min(live.current.row.validUntil,live.current.row.period.endsAt),adminId:result.userId});setPending(false);pendingRef.current=false;identityRef.current.clearUnlock();
      logger.info('fitness.game.sunday_unlock_granted',{moduleId,scope:wanted,adminId:result.userId});
    }catch{if(mounted.current && version===attempt.current)setError('Admin unlock was not granted.');}
    finally{if(mounted.current && version===attempt.current){setPending(false);pendingRef.current=false;}}
  }
  if(allowed)return children;
  return <section className="fitness-game-gate" aria-label={`${label} access`}>
    <h2>{label}</h2><p role="status">{known?'Admin unlock required for Fitness games on Sundays.':snapshot.status==='loading'?'Checking game access…':'Game access is unavailable. Please retry.'}</p>
    {known?<button type="button" disabled={pending} onClick={()=>void unlock()}>Admin unlock</button>:<button type="button" onClick={()=>void refresh({invalidate:true})}>Retry access check</button>}
    {onClose && <button type="button" onClick={onClose}>Back</button>}
    {error && <p role="alert">{error}</p>}
    <UnlockPrompt open={pending} state={identity.unlockState} unlockedUser={identity.unlockedUser} lockLabel={label} onCancel={cancel}/>
  </section>;
}
