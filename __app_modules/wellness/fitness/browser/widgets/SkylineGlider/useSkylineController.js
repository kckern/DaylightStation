import { useCallback,useEffect,useRef,useState } from 'react';
import { DaylightImagePath } from '@/lib/api.mjs';
import { createSkylineControlState,reduceSkylineControl,describeSkylineControls } from '../../lib/skylineGlider/controllerModel.js';

export function useSkylineController({ctx,courses=[],world,access,saved,saveState,flight,onEffect,modalOpen=false}){
 const latest=useRef(null);latest.current={ctx,onEffect,saved,modalOpen};
 const activeSelectorId=useRef(null);
 const selector=(ctx?.riderSelectors||[]).find(s=>s.id===activeSelectorId.current)||(ctx?.riderSelectors||[])[0];
 const configured=[...(ctx?.users||[]),...(ctx?.userCollections?.all||[]),...Object.values(ctx?.usersConfig||{}).flatMap(g=>Array.isArray(g)?g:[])];
 const people=new Map();
 for(const p of configured){const id=typeof p==='string'?p:p?.id||p?.userId||p?.name;if(id)people.set(id,typeof p==='string'?{id}:p)}
 for(const id of Object.values(selector?.buttons||{}))if(!people.has(id))people.set(id,{id});
 const riders=[...people].map(([id,p])=>{
  const position=Number(Object.keys(selector?.buttons||{}).find(k=>/_single$/.test(k)&&selector.buttons[k]===id)?.split('_')[0])||null;
  return {id,name:ctx?.getDisplayName?.(id)?.displayName||p.displayName||p.name||id,position,
   avatarSrc:p.avatarSrc||DaylightImagePath('users/'+id),
   gestureHint:Object.entries(selector?.buttons||{}).filter(([k])=>k.startsWith(position+'_')&&!k.endsWith('_single')).map(([k,who])=>(k.endsWith('_double')?'Double: ':'Hold: ')+(ctx?.getDisplayName?.(who)?.displayName||who)).join(' · ')||'Hold: other riders'};
 });
 const mapActs=new Map((world?.zones||[]).flatMap(z=>z.acts||[]).map(a=>[a.id,a]));
 const acts=courses.map(c=>({...c,...mapActs.get(c.id),status:mapActs.get(c.id)?.status||'open'}));
 const lastPlayedByRider={};
 for(const r of riders)try{lastPlayedByRider[r.id]=localStorage.getItem('fitness:skyline-glider:last-act:'+r.id)}catch{/* in-memory selection still works */}
 const [state,setState]=useState(()=>createSkylineControlState({riders,acts,lastPlayedByRider}));
 const stateRef=useRef(state),captureRef=useRef(null),dispatchRef=useRef(null),handleRef=useRef(null);
 const previousSelectorSignature=useRef(JSON.stringify(ctx?.riderSelectors||[]));
 const captureSelector=useCallback(config=>{
  const router=latest.current.ctx?.selectorInputRouter;
  if(!config||!router||!handleRef.current)return false;
  captureRef.current?.();captureRef.current=null;
  captureRef.current=router.capture({selectorId:config.id,equipmentId:config.equipment,onInput:input=>handleRef.current(input)});
  activeSelectorId.current=config.id;
  return true;
 },[]);
 const dispatch=useCallback(event=>{
  let before=stateRef.current,stallInput=null;
  if(event.type==='PRESS'&&latest.current.modalOpen){
   if(event.position===3)latest.current.onEffect?.({type:'cancel-unlock'});
   return;
  }
  if(event.type==='PRESS'&&before.phase==='flight'){
   const input=latest.current.ctx?.fitnessSessionInstance?.getEquipmentCadence?.(before.equipmentId);
   const armed=before.flight?.inputReady||Number(input?.ts)>Number(before.flight?.armedAtMs||0);
   if(input?.connected&&!input.transportStalled&&input.rpm===0&&armed){
    stallInput={...input};
    event={type:'FLIGHT_CHANGED',flight:{...before.flight,stalled:true},weaponsEnabled:before.weaponsEnabled};
   }
  }
  if(event.type==='PRESS'&&before.phase==='identity'){
   const config=latest.current.ctx?.riderSelectors?.find(s=>s.id===before.selectorId)||latest.current.ctx?.riderSelectors?.[0];
   if(config&&!captureRef.current){
    captureSelector(config);
    before={...before,selectorId:config.id,equipmentId:config.equipment};stateRef.current=before;
   }
   const id=config?.buttons?.[event.position+'_'+(event.gesture||'single')],rider=before.riders.find(r=>r.id===id);
   if(rider)event={type:'IDENTIFY',rider,selectorId:config.id,equipmentId:config.equipment};
  }
  if(event.type==='PRESS'&&event.position===4&&before.phase==='flights')event=latest.current.saved?.status==='pending_terminal'?{type:'RECOVER_TERMINAL'}:{...event,resume:latest.current.saved?.status==='compatible'};
  const next=reduceSkylineControl(before,event);
  if(stallInput)next.effects.unshift({type:'commit-stall',cadence:stallInput});
  stateRef.current=next.state;setState(next.state);
  for(const effect of next.effects){
   if(effect.type==='release-selector'){captureRef.current?.();captureRef.current=null;activeSelectorId.current=null}
   latest.current.onEffect?.({...effect,equipmentId:next.state.equipmentId||latest.current.ctx?.riderSelectors?.[0]?.equipment,selectorId:next.state.selectorId,riderId:effect.riderId||next.state.riderId,actId:effect.actId||next.state.actId});
  }
 },[captureSelector]);
 dispatchRef.current=dispatch;
 const configSignature=JSON.stringify({riders,acts:acts.map(a=>({id:a.id,name:a.name,status:a.status})),selectors:ctx?.riderSelectors});
 useEffect(()=>{
  const before=stateRef.current;
  dispatch({type:'CONFIG_CHANGED',config:{riders,acts,lastPlayedByRider}});
  if(before.riderId&&world?.riderId===before.riderId&&before.worldRider!==world.riderId&&before.phase==='flights'){
   const next=world.next||lastPlayedByRider[before.riderId]||stateRef.current.actId;
   dispatch({type:'CONFIG_CHANGED',config:{actId:next,worldRider:world.riderId}});
  }
 },[configSignature,world?.riderId,dispatch]);
 useEffect(()=>{dispatch({type:'ACCESS_CHANGED',allowed:!!access?.unlocked,reason:access?.status==='loading'?'Checking flight access…':access?.state==='incomplete'?'Finish today’s schoolwork to fly.':access?.state==='unavailable'?'School status unavailable':'Admin approval required'})},[access?.unlocked,access?.state,access?.status,state.riderId,dispatch]);
 useEffect(()=>{if(saveState?.status&&saveState.status!=='idle')dispatch({type:'SAVE_CHANGED',status:saveState.status})},[saveState?.status,dispatch]);
 useEffect(()=>{if(flight)dispatch({type:'FLIGHT_CHANGED',flight,weaponsEnabled:courses.find(c=>c.id===stateRef.current.actId)?.rules?.weapons?.enabled!==false})},[flight,dispatch]);
 const selectorSignature=JSON.stringify(ctx?.riderSelectors||[]);
 useEffect(()=>{
  const router=ctx?.selectorInputRouter;if(!router)return;
  const handle=input=>{
   const current=stateRef.current,match=/^([1-4])_(single|long|hold|double)$/.exec(input.action||'');
   if(!match)return true;
   const gesture=match[2]==='hold'?'long':match[2],position=Number(match[1]);
   if(current.phase==='identity'){
    const rider=current.riders.find(r=>r.id===input.userId);
    if(rider&&latest.current.ctx?.riderSelectors?.some(s=>s.id===input.selectorId&&s.buttons?.[input.action]===rider.id)){
     dispatchRef.current({type:'IDENTIFY',rider,selectorId:input.selectorId,equipmentId:input.equipmentId});return true;
    }
    stateRef.current={...current,equipmentId:input.equipmentId,selectorId:input.selectorId};
   }
   dispatchRef.current({type:'PRESS',position,gesture,source:'rider-button'});return true;
  };
  handleRef.current=handle;
  if(previousSelectorSignature.current!==selectorSignature){
   previousSelectorSignature.current=selectorSignature;
   const current=stateRef.current;
   if(['saving','result','save-details'].includes(current.phase)&&['saving','error'].includes(current.saveStatus)){
    const replacement=latest.current.ctx?.riderSelectors?.find(s=>s.equipment===current.equipmentId);
    dispatchRef.current({type:'CONFIG_CHANGED',config:{selectorId:replacement?.id||null}});
    if(replacement)captureSelector(replacement);
   }else dispatchRef.current({type:'CONFIG_CHANGED',config:{},resetIdentity:true});
  }
  const stop=router.onUnclaimed(input=>{
   if(stateRef.current.phase!=='identity')return false;
   const config=latest.current.ctx?.riderSelectors?.find(s=>s.id===input.selectorId&&s.equipment===input.equipmentId);
   if(!config||!latest.current.ctx?.equipment?.some(e=>e.id===input.equipmentId&&e.cadence!=null))return false;
   captureSelector(config);
   return handle(input);
  });
  return ()=>{stop();captureRef.current?.();captureRef.current=null};
 },[ctx?.selectorInputRouter,selectorSignature,captureSelector]);
 useEffect(()=>{
  const key=e=>{
   if(e.ctrlKey||e.metaKey||e.altKey||e.repeat||e.target?.isContentEditable||e.target?.matches?.('input,textarea,select'))return;
   if(/^[1-4]$/.test(e.key)){e.preventDefault();dispatchRef.current({type:'PRESS',position:Number(e.key),gesture:'single',source:'keyboard'})}
   else if(e.key==='Escape'&&stateRef.current.phase==='flight'){e.preventDefault();dispatchRef.current({type:'PRESS',position:4,gesture:'long',source:'keyboard'})}
  };
  window.addEventListener('keydown',key);return ()=>window.removeEventListener('keydown',key);
 },[]);
 useEffect(()=>{
  if(!['ready','countdown'].includes(state.phase))return;
  let prior=performance.now();
  const timer=setInterval(()=>{
   const now=performance.now(),current=stateRef.current;
   dispatchRef.current({type:'TICK',dt:Math.min(.25,(now-prior)/1000),nowMs:Date.now(),cadence:latest.current.ctx?.fitnessSessionInstance?.getEquipmentCadence?.(current.equipmentId||latest.current.ctx?.riderSelectors?.[0]?.equipment)});
   prior=now;
  },50);return ()=>clearInterval(timer);
 },[state.phase]);
 return {state,controls:describeSkylineControls(state),dispatch};
}
