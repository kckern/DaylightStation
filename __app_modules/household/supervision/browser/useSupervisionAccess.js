import {useCallback,useEffect,useRef,useState} from 'react';
import {DaylightAPI} from '@/lib/api.mjs';
import {wsService} from '@/services/WebSocketService.js';
import {readLocalStop,clearLocalStop,LOCAL_STOP_EVENT} from './localStop.js';
const monotonicClock={now:()=>performance.now()};
const liveSubscribe=handler=>wsService.subscribe(['state-gates','supervision.changed'],handler);
/** Events only invalidate; a canonical bounded permit is the only way to open. */
export function useSupervisionAccess({deviceId,activityId,learnerId,requestId,sessionId,api=DaylightAPI,subscribe=liveSubscribe,clock=monotonicClock}){
  const [access,setAccess]=useState({allowed:false,reason:'checking',enabled:null,expiresAt:null,epoch:null});
  const generation=useRef(0),leaseGeneration=useRef(0),leaseTimer=useRef(null),leaseDeadline=useRef(0),mounted=useRef(false),canonicalDevice=useRef(deviceId),inFlight=useRef(false),latch=useRef(readLocalStop());
  const context=JSON.stringify({deviceId,activityId,learnerId,requestId,sessionId});
  const refresh=useCallback(async({invalidate=false,forceEnforcement=false}={})=>{
    if(inFlight.current && !invalidate)return;
    const version=++generation.current;inFlight.current=true;const startedAt=clock.now();let timeout;
    if(invalidate)setAccess(previous=>previous.enabled===false && !forceEnforcement?previous:{...previous,enabled:forceEnforcement?true:previous.enabled,allowed:false,reason:'checking'});
    const current=()=>mounted.current && version===generation.current;
    try{
      const work=async()=>{
        const bootstrap=await api('api/v1/supervision/bootstrap');
        if(bootstrap?.enabled===false)return {allowed:true,enabled:false,epoch:0,issuedAt:0,expiresAt:5000};
        canonicalDevice.current=bootstrap?.deviceId??canonicalDevice.current;
        if(bootstrap?.enabled!==true)throw Error('Supervision bootstrap unavailable');
        if(current())setAccess(previous=>previous.enabled===false?{...previous,enabled:true,allowed:false,reason:'checking'}:previous);
        if(bootstrap.pairingRequired)return {...bootstrap,allowed:false,reason:'KIOSK_AUTHENTICATION_REQUIRED',checkedAt:clock.now()};
        const query=new URLSearchParams(Object.entries(JSON.parse(context)).filter(([,value])=>value!=null));
        const permit=await api(`api/v1/supervision/access?${query}`);
        return {...bootstrap,...permit,enabled:true,checkedAt:clock.now()};
      };
      const reply=await Promise.race([work(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Access check timed out')),2000);})]);
      if(!current())return;
      const duration=Math.min(5000,reply.expiresAt-reply.issuedAt),deadline=startedAt+duration;
      if(!reply.allowed){setAccess({...reply,contextKey:context,allowed:false,reason:reply.reason??'SUPERVISION_BLOCKED'});return;}
      if(!Number.isFinite(duration) || duration<=0 || clock.now()>=deadline)throw Error('No current access permit');
      const pending=latch.current??readLocalStop();
      if(pending && (pending.epoch===null || !Number.isSafeInteger(reply.epoch) || reply.epoch<pending.epoch)){
        setAccess({...reply,contextKey:context,allowed:false,reason:'SUPERVISION_BLOCKED'});return;
      }
      if(pending){clearLocalStop();latch.current=null;}
      clearTimeout(leaseTimer.current);
      if(reply.enabled===false){
        leaseGeneration.current++;leaseDeadline.current=Infinity;
        setAccess({...reply,contextKey:context,allowed:true,reason:null,expiresAt:null});return;
      }
      leaseDeadline.current=deadline;
      const leaseVersion=++leaseGeneration.current;
      leaseTimer.current=setTimeout(()=>{if(mounted.current && leaseVersion===leaseGeneration.current)setAccess(previous=>({...previous,allowed:false,reason:'connection'}));},Math.max(0,deadline-clock.now()));
      setAccess({...reply,contextKey:context,allowed:true,reason:null});
    }catch(error){if(current())setAccess(previous=>{
      if(previous.enabled===false && !forceEnforcement)return previous;
      if(!invalidate && previous.allowed && clock.now()<leaseDeadline.current && error.status!==403)return previous;
      return {...previous,allowed:false,reason:error.status===403?'SUPERVISION_BLOCKED':'connection'};
    });}
    finally{clearTimeout(timeout);if(version===generation.current)inFlight.current=false;}
  },[api,subscribe,clock,context]);
  useEffect(()=>{
    mounted.current=true;
    const invalidate=()=>{void refresh({invalidate:true});};
    const stop=event=>{latch.current=event.detail??readLocalStop();generation.current++;inFlight.current=false;clearTimeout(leaseTimer.current);setAccess(previous=>({...previous,allowed:false,reason:'SUPERVISION_BLOCKED'}));};
    const visibility=()=>{if(document.visibilityState==='visible')invalidate();};
    const onEvent=event=>{
      if(event?.topic==='supervision.changed'){
        if(!event.deviceIds || event.deviceIds.includes(canonicalDevice.current))void refresh({invalidate:true,forceEnforcement:true});
        return;
      }
      const value=event?.payload?.current??event?.payload;
      if(!['supervision.interactive','supervision.activity','supervision.activity-normal'].includes(value?.capabilityId))return;
      if(value.subject?.id && canonicalDevice.current && value.subject.id!==canonicalDevice.current)return;
      const wantedPeriod=JSON.parse(context).requestId??'supervision-current';
      if(value.period?.id && value.period.id!==wantedPeriod)return;
      if((value.decision??value.to?.decision)==='granted')void refresh();
      else void refresh({invalidate:true,forceEnforcement:true});
    };
    const unsubscribe=subscribe(onEvent);const poll=setInterval(()=>{void refresh();},1000);
    window.addEventListener('focus',invalidate);document.addEventListener('visibilitychange',visibility);window.addEventListener(LOCAL_STOP_EVENT,stop);
    void refresh({invalidate:true});
    return()=>{mounted.current=false;generation.current++;inFlight.current=false;clearInterval(poll);clearTimeout(leaseTimer.current);unsubscribe?.();window.removeEventListener('focus',invalidate);document.removeEventListener('visibilitychange',visibility);window.removeEventListener(LOCAL_STOP_EVENT,stop);};
  },[refresh,subscribe]);
  const sameContext=access.contextKey===context;
  return {...access,allowed:access.allowed && (access.enabled===false || sameContext),reason:sameContext?access.reason:'checking',refresh};
}
