import React, { useEffect, useRef } from 'react';
import './SkylineMenus.scss';
import SkylineAvatar from './SkylineAvatar.jsx';
import { PixelIcon, iconForSymbol } from './SkylinePixelIcons.jsx';
// `heading` names the buttons; a game played off the bike (Invaders) passes its own.
export default function SkylineControlPanel({controls,onPress,heading='Your bike buttons',label='Bike controls'}){
 const hold=useRef({timer:null,click:null,handled:false});
 const clear=()=>clearTimeout(hold.current.timer);
 useEffect(()=>()=>{clear();clearTimeout(hold.current.click)},[controls.map(c=>c.label).join('|')]);
 return <aside className="skyline-controls" aria-label={label}>
  <p className="skyline-controls__heading">{heading}</p>
  <div className="skyline-controls__pad">{controls.map(c=><button key={c.position} type="button" data-position={c.position} data-kind={c.avatarSrc?'rider':'action'} disabled={c.disabled} title={c.reason||c.hint}
   onPointerDown={()=>{clear();hold.current.handled=false;hold.current.timer=setTimeout(()=>{hold.current.handled=true;onPress(c.position,'long')},650)}}
   onPointerUp={clear} onPointerCancel={clear} onPointerLeave={clear}
   onClick={()=>{if(!hold.current.handled){if(c.avatarSrc){clearTimeout(hold.current.click);hold.current.click=setTimeout(()=>onPress(c.position,'single'),300)}else onPress(c.position,'single')}hold.current.handled=false}}
   onDoubleClick={()=>{clearTimeout(hold.current.click);if(c.avatarSrc)onPress(c.position,'double')}}>
   <span className="skyline-controls__position">{c.position}</span>
   {c.avatarSrc?<SkylineAvatar src={c.avatarSrc} name={c.label}/>:<span className="skyline-controls__icon" aria-hidden="true">{iconForSymbol(c.icon)?<PixelIcon name={iconForSymbol(c.icon)}/>:c.icon}</span>}
   <strong>{c.label}</strong><small>{c.reason||c.hint}</small>
  </button>)}</div>
 </aside>;
}
