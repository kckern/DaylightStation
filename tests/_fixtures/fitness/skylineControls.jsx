// Development-only acceptance fixture. Never writes real household assignments.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FitnessContext} from '../../../__app_modules/wellness/fitness/browser/context/FitnessContext.jsx';
import {IdentityContext} from '../../../__app_modules/wellness/fitness/browser/identity/IdentityProvider.jsx';
import SkylineGlider from '../../../__app_modules/wellness/fitness/browser/widgets/SkylineGlider/SkylineGlider.jsx';
import {createSelectorInputRouter} from '../../../__app_modules/wellness/fitness/browser/lib/selectorInputRouter.js';
import {dispatchRiderSelection} from '../../../__app_modules/wellness/fitness/browser/lib/riderSelection.js';

const router=createSelectorInputRouter(),assignments=[],awards=[];
const riding=new Map(),cadence={rpm:0,connected:true,transportStalled:false};
const users=[{id:'test-child',name:'Test child'},{id:'test-other',name:'Other child'},{id:'test-parent',name:'Parent'},{id:'guest',name:'Guest'}];
const equipment=[{id:'test-bike',name:'Test bike',cadence:7,rpm:{min:30,max:130}}];
const selectors=[{id:'test-pad',equipment:'test-bike',buttons:{'1_single':'test-child','2_single':'test-other','3_single':'test-parent','4_single':'guest','2_long':'test-parent'}}];
const gated=new URLSearchParams(location.search).has('gated');
let notify=()=>{};
const session={sessionId:'skyline-acceptance',getEquipmentRider:id=>riding.get(id),
 getEquipmentCadence:()=>({...cadence,ts:Date.now()}),
 setEquipmentRider:(equipmentId,userId)=>{assignments.push({equipmentId,userId});riding.set(equipmentId,userId);notify()},
 treasureBox:{awardBonus:award=>{if(!awards.some(a=>a.idempotencyKey===award.idempotencyKey))awards.push(award)}}};
window.__skylineTest={
 press:({selectorId='test-pad',equipmentId='test-bike',action,userId})=>dispatchRiderSelection(
  {topic:'rider_select',selectorId,equipmentId,action,userId:userId??selectors.find(s=>s.id===selectorId)?.buttons[action]},
  {route:router.route,ingest:data=>session.setEquipmentRider(data.equipmentId,data.userId),emit:()=>false,toast:()=>{}}),
 pedal:rpm=>{cadence.rpm=rpm;notify()},disconnect:()=>{cadence.connected=false;cadence.transportStalled=true;notify()},
 connect:()=>{cadence.connected=true;cadence.transportStalled=false;notify()},
 snapshot:()=>({assignments:[...assignments],awards:[...awards],cadence:{...cadence}}),
};
const identity={registerAdmin:async()=>({matched:false}),clearUnlock:()=>{},unlockState:'idle',unlockedUser:null};
function Fixture(){
 const[,tick]=useState(0);notify=()=>tick(x=>x+1);
 const ctx={equipment,riderSelectors:selectors,selectorInputRouter:router,fitnessSessionInstance:session,users,
  getDisplayName:id=>({displayName:users.find(u=>u.id===id)?.name||id}),
  getUserByName:id=>({id,schoolLearner:gated&&id==='test-child'}),setGovernanceSuspended:()=>{}};
 return <FitnessContext.Provider value={ctx}><IdentityContext.Provider value={identity}><SkylineGlider/></IdentityContext.Provider></FitnessContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
