import React,{useState,useEffect} from 'react';
import './Supervision.scss';
import {useSupervisionAccess} from './useSupervisionAccess.js';
import {useApprovalRequest} from './useApprovalRequest.js';
import {ApprovalRequestShell} from './ApprovalRequestShell.jsx';
import {SupervisionBoundary} from './SupervisionBoundary.jsx';
import {ActivityScopeProvider} from './ActivityScope.jsx';
import {ParentControls} from './ParentControls.jsx';
import {DaylightAPI} from '@/lib/api.mjs';
import {suspendActivities} from './activityLifecycle.js';
export function SupervisionHost({children,activityId='kiosk:menu',routePath=null,api=DaylightAPI,subscribe,onResume,homeHref='/'}){
  const [parentOpen,setParentOpen]=useState(false),[learnerId,setLearnerId]=useState(''),[catalog,setCatalog]=useState(null);
  const canonicalReady=!routePath || catalog?.path===routePath;
  const canonicalActivity=routePath?(canonicalReady?catalog.currentActivityId:null):activityId;
  // The authenticated device comes from bootstrap, never the route or identity picker.
  const [deviceId,setDeviceId]=useState(null);
  const context={deviceId,learnerId,activityId:canonicalActivity??'kiosk:unlisted'};
  const approval=useApprovalRequest({context,api});
  const access=useSupervisionAccess({activityId:context.activityId,learnerId,...(canonicalReady && approval.session?{requestId:approval.session.requestId,sessionId:approval.session.sessionId}:{}),api,subscribe});
  useEffect(()=>{if(access.deviceId && deviceId!==access.deviceId)setDeviceId(access.deviceId);},[access.deviceId,deviceId]);
  useEffect(()=>{
    if(!routePath || access.enabled!==true || !access.deviceId)return;let disposed=false;
    void api(`api/v1/supervision/catalog?${new URLSearchParams({path:routePath})}`).then(result=>{if(!disposed)setCatalog({...result,path:routePath});}).catch(()=>{if(!disposed)setCatalog({path:routePath,activities:[],learners:[],currentActivityId:null});});
    return()=>{disposed=true;};
  },[routePath,access.enabled,access.deviceId,api]);
  const effective=parentOpen?{...access,allowed:false,reason:'parent-controls'}:access.enabled!==false && !canonicalReady?{...access,allowed:false,reason:'checking'}:access;
  useEffect(()=>{
    if(access.enabled!==true || !Number.isSafeInteger(access.commandRevision))return;
    void api('api/v1/supervision/consumer-ack',{protocol:2,blocked:!effective.allowed,commandRevision:access.commandRevision},'POST').catch(()=>{});
  },[api,access.enabled,effective.allowed,access.commandRevision,access.checkedAt]);
  const requestOnly=canonicalReady && !parentOpen && access.reason==='SUPERVISION_APPROVAL_REQUIRED';
  return <SupervisionBoundary key={approval.session?.sessionId??'ordinary'} access={effective} suspendActivity={suspendActivities}
    onResume={onResume??(()=>window.location.replace(homeHref))}
    blockedContent={requestOnly?<ApprovalRequestShell context={context} activities={catalog?.activities??[]} learners={catalog?.learners??[]} approval={approval} onLearnerChange={setLearnerId} onActivityChange={id=>{const selected=catalog?.activities?.find(activity=>activity.id===id);if(selected?.path)window.location.assign(selected.path);}}/>:null}
    parentControls={access.enabled!==false?<ParentControls devices={access.devices??[]} api={api} onOpenChange={setParentOpen} onChanged={()=>access.refresh({invalidate:true})}/>:null}>
    <ActivityScopeProvider value={{restricted:!!approval.session,activityId:context.activityId,learnerId,onMismatch:approval.endSession}}>{children}</ActivityScopeProvider>
  </SupervisionBoundary>;
}
