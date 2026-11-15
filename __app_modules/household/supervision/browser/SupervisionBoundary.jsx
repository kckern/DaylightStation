import React,{useLayoutEffect,useRef,useState} from 'react';
/** Unmount activity; parent controls remain outside the child access boundary. */
export function SupervisionBoundary({access,children,parentControls,suspendActivity,onResume,blockedContent}){
  const [resumeRequired,setResumeRequired]=useState(false);const wasAllowed=useRef(false);
  const blocked=!access.allowed;
  useLayoutEffect(()=>{
    if(blocked){
      if((wasAllowed.current && access.reason!=='checking') || access.reason==='SUPERVISION_BLOCKED')setResumeRequired(true);
      suspendActivity?.({epoch:access.epoch,reason:access.reason});
    }else wasAllowed.current=true;
  },[blocked,access.epoch,access.reason,suspendActivity]);
  return <>
    {parentControls}
    {blocked && blockedContent ? blockedContent : blocked || resumeRequired ? <section className="supervision-boundary" role="status" aria-live="polite">
      <p>{blocked?(access.reason==='SUPERVISION_BLOCKED'?'Paused by a parent':'Checking access…'):'Ready when you are'}</p>
      {!blocked && <button type="button" onClick={()=>{onResume?.();setResumeRequired(false);}}>Return to menu</button>}
    </section> : children}
  </>;
}
