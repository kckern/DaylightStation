import { useMemo, useReducer } from 'react';

const slots=['active','studyLaunch','reelLaunch','cubeLaunch','debriefLaunch','gratitudeLaunch','bookLaunch','bankLaunch'];
/** One activity owns the workspace. Cleanup of another activity cannot revoke it. */
export function schoolActivityReducer(state, action) {
  if(action.clear) return null;
  const current=state?.key===action.key ? state.value : null;
  const value=typeof action.value==='function' ? action.value(current) : action.value;
  if(value===current) return state;
  if(value==null) return state?.key===action.key ? null : state;
  return {key:action.key,value};
}
export function useSchoolActivityState({initialGratitude=null}={}) {
  const [state,dispatch]=useReducer(schoolActivityReducer,initialGratitude,value=>{
    const initial=typeof value==='function'?value():value;
    return initial?{key:'gratitudeLaunch',value:initial}:null;
  });
  const actions=useMemo(()=>Object.fromEntries([
    ...slots.map(key=>[`set${key[0].toUpperCase()}${key.slice(1)}`,value=>dispatch({key,value})]),
    ['clearActivity',()=>dispatch({clear:true})],
  ]),[]);
  return {...Object.fromEntries(slots.map(key=>[key,state?.key===key?state.value:null])),...actions};
}
