import React, { useEffect, useRef } from 'react';
import { DaylightImagePath } from '@/lib/api.mjs';
export default function SkylineControlPanel({controls,onPress,compact=false}){
 const hold=useRef({timer:null,click:null,handled:false});
 const clear=()=>clearTimeout(hold.current.timer);
 useEffect(()=>()=>{clear();clearTimeout(hold.current.click)},[controls.map(c=>c.label).join('|')]);
 return <aside className={'skyline-controls'+(compact?' skyline-controls--compact':'')} aria-label="Bike controls">
  <p className="skyline-controls__heading">Your bike buttons</p>
  <div className="skyline-controls__pad">{controls.map(c=><button key={c.position} type="button" data-position={c.position} disabled={c.disabled} title={c.reason||c.hint}
   onPointerDown={()=>{clear();hold.current.handled=false;hold.current.timer=setTimeout(()=>{hold.current.handled=true;onPress(c.position,'long')},650)}}
   onPointerUp={clear} onPointerCancel={clear} onPointerLeave={clear}
   onClick={()=>{if(!hold.current.handled){if(c.avatarSrc){clearTimeout(hold.current.click);hold.current.click=setTimeout(()=>onPress(c.position,'single'),300)}else onPress(c.position,'single')}hold.current.handled=false}}
   onDoubleClick={()=>{clearTimeout(hold.current.click);if(c.avatarSrc)onPress(c.position,'double')}}>
   <span className="skyline-controls__position">{c.position}</span>
   {c.avatarSrc?<img src={c.avatarSrc} alt={c.label} onError={e=>{if(e.currentTarget.dataset.fallback){e.currentTarget.style.visibility='hidden';return}e.currentTarget.dataset.fallback='true';e.currentTarget.src=DaylightImagePath('users/_default')}}/>:<span className="skyline-controls__icon" aria-hidden="true">{c.icon}</span>}
   <strong>{c.label}</strong><small>{c.reason||c.hint}</small>
  </button>)}</div>
 </aside>;
}
