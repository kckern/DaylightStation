import { schoolDeviceHeaders } from '../../schoolDevice.js';
import { gratitudeLog } from './gratitudeLog.js';
export function createGratitudeApi({learnerId,grant}) {
  const base=`/api/v1/school/gratitude/${encodeURIComponent(learnerId)}/day`;
  async function call(day,path,{method='GET',body,raw=false,takeId}={}){
    try {
      const headers=schoolDeviceHeaders({'X-School-Gratitude-Grant':grant});
      if(takeId)headers['X-School-Take-Id']=takeId;
      if(body!==undefined)headers['Content-Type']=raw?(body.type||'audio/webm'):'application/json';
      const result=await fetch(`${base}/${encodeURIComponent(day)}${path}`,{method,credentials:'same-origin',headers,...(body===undefined?{}:{body:raw?body:JSON.stringify(body)}),...(typeof AbortSignal.timeout==='function'?{signal:AbortSignal.timeout(35000)}:{})});
      const data=await result.json().catch(()=>null);
      if(!result.ok)gratitudeLog.apiRejected({path,status:result.status});
      return {ok:result.ok,status:result.status,data};
    }catch(error){gratitudeLog.apiFailed({path,error:error.message});return {ok:false,status:0,data:null};}
  }
  return {day:d=>call(d,''),open:d=>call(d,'/open',{method:'POST'}),draft:(d,body)=>call(d,'/draft',{method:'POST',body}),submit:(d,body)=>call(d,'/submit',{method:'POST',body}),retry:(d,body)=>call(d,'/retry',{method:'POST',body}),take:(d,blob,takeId)=>call(d,'/take',{method:'POST',body:blob,raw:true,takeId})};
}
