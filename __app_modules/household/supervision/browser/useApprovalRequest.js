import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {DaylightAPI} from '@/lib/api.mjs';
import {setRequestContextHeaders} from '@/lib/requestContextHeaders.mjs';
import getLogger from '@/lib/logging/Logger.js';
const keyFor=context=>JSON.stringify([context?.deviceId,context?.learnerId,context?.activityId]);
const storageKey=key=>`supervision-request:${key}`;
function stored(key){try{return JSON.parse(sessionStorage.getItem(storageKey(key)))?.request??null;}catch{return null;}}
function save(key,request){try{if(request)sessionStorage.setItem(storageKey(key),JSON.stringify({request}));else sessionStorage.removeItem(storageKey(key));}catch{ /* Access still requires the server. */ }}
/** Stored metadata never grants access. Start consumes server authority; the host still obtains a permit. */
export function useApprovalRequest({context,api=DaylightAPI}){
  const key=keyFor(context),current=useRef({key,context}),version=useRef(0),busy=useRef(false),mounted=useRef(true);
  const [state,setState]=useState(()=>({key,request:stored(key),session:null,error:null,busy:false}));
  const valid=()=>context?.deviceId && context?.learnerId && context?.activityId;
  const update=(generation,next)=>{if(mounted.current && generation===version.current)setState(previous=>({...previous,...next,key}));};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;version.current++;};},[]);
  useEffect(()=>{
    if(current.current.key!==key){
      const old=current.current;version.current++;busy.current=false;
      const previous=stored(old.key);save(old.key,null);
      if(previous?.id)void api(`api/v1/supervision/requests/${encodeURIComponent(previous.id)}/end`,old.context,'POST').catch(()=>{});
      current.current={key,context};setState({key,request:stored(key),session:null,error:null,busy:false});
    }else current.current.context=context;
  },[key,api]);
  const active=state.key===key?state:{request:null,session:null,error:null,busy:false};
  useLayoutEffect(()=>{
    setRequestContextHeaders('supervision',active.session?{'X-Supervision-Request':active.session.requestId,'X-Supervision-Session':active.session.sessionId,'X-Supervision-Learner':context.learnerId}:null);
    return()=>setRequestContextHeaders('supervision',null);
  },[key,active.session]);
  useEffect(()=>{
    const request=active.request;if(!request?.id || !valid())return;
    const generation=version.current;let disposed=false,inFlight=false;
    const read=async()=>{if(inFlight)return;inFlight=true;try{
      const query=new URLSearchParams(context),reply=await api(`api/v1/supervision/requests/${encodeURIComponent(request.id)}?${query}`);
      if(!disposed && generation===version.current){save(key,reply);update(generation,{request:reply,error:null,...(reply.status!=='approved'?{session:null}:{})});}
    }catch{if(!disposed)update(generation,{error:'Unable to check permission.'});}finally{inFlight=false;}};
    void read();const timer=setInterval(()=>void read(),1000);return()=>{disposed=true;clearInterval(timer);};
  },[key,active.request?.id,api]);
  const requestPermission=useCallback(async()=>{
    if(busy.current || !valid() || active.request?.status==='pending')return;
    busy.current=true;const generation=version.current;update(generation,{busy:true,error:null});
    try{const request=await api('api/v1/supervision/requests',{...context,idempotencyKey:globalThis.crypto.randomUUID()},'POST');if(generation===version.current){save(key,request);update(generation,{request,session:null});getLogger().info('supervision.request.submitted',{requestId:request.id,activityId:context.activityId});}else void api(`api/v1/supervision/requests/${encodeURIComponent(request.id)}/end`,context,'POST').catch(()=>{});}
    catch{update(generation,{error:'Permission could not be requested. Please wait before trying again.'});}
    finally{if(generation===version.current){busy.current=false;update(generation,{busy:false});}}
  },[key,api,active.request?.status]);
  const cancelRequest=useCallback(async()=>{
    if(busy.current || !active.request?.id)return;busy.current=true;const generation=version.current;update(generation,{busy:true,error:null});
    try{const request=await api(`api/v1/supervision/requests/${encodeURIComponent(active.request.id)}/cancel`,context,'POST');save(key,request);update(generation,{request,session:null});}
    catch{update(generation,{error:'Unable to cancel permission.'});}finally{if(generation===version.current){busy.current=false;update(generation,{busy:false});}}
  },[key,active.request?.id,api]);
  const startSession=useCallback(async()=>{
    if(busy.current || active.request?.status!=='approved')return;busy.current=true;const generation=version.current;update(generation,{busy:true,error:null});
    try{const session=await api(`api/v1/supervision/requests/${encodeURIComponent(active.request.id)}/consume`,context,'POST');
      if(generation===version.current)update(generation,{session:{...session,requestId:active.request.id}});
      else void api(`api/v1/supervision/requests/${encodeURIComponent(active.request.id)}/end`,context,'POST').catch(()=>{});
    }catch{update(generation,{session:null,error:'This permission is no longer available.'});}finally{if(generation===version.current){busy.current=false;update(generation,{busy:false});}}
  },[key,active.request?.id,active.request?.status,api]);
  const endSession=useCallback(async()=>{
    const request=active.request;if(!request?.id)return;
    version.current++;busy.current=false;save(key,null);setState({key,request:null,session:null,error:null,busy:false});
    try{await api(`api/v1/supervision/requests/${encodeURIComponent(request.id)}/end`,context,'POST');}catch{getLogger().warn('supervision.session.end-unconfirmed',{requestId:request.id});}
  },[key,active.request?.id,api]);
  return {...active,endSession,status:active.request?.status??'idle',requestPermission,cancelRequest,startSession};
}
