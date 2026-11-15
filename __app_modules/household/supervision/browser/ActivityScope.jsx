import React,{createContext,useContext,useLayoutEffect} from 'react';
import {suspendActivities} from './activityLifecycle.js';
const ActivityScope=createContext(null);
export const ActivityScopeProvider=ActivityScope.Provider;
export function useActivityScope(){return useContext(ActivityScope);}
/** Owners supply their actual selection. This never turns a mismatch into authority. */
export function SupervisedActivity({activityId,learnerId,children,fallback=null}){
  const scope=useActivityScope();
  const allowed=!scope?.restricted || (scope.activityId===activityId && (learnerId===undefined || scope.learnerId===learnerId));
  useLayoutEffect(()=>{if(!allowed){suspendActivities({reason:'scope-changed'});if(learnerId!==null)scope.onMismatch?.();}},[allowed,scope?.onMismatch,learnerId]);
  return allowed?children:fallback??<p role="status">Return to the menu to request this activity.</p>;
}
