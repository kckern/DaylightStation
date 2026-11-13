import React from 'react';
import './SkylineMenus.scss';
import SkylineAvatar from './SkylineAvatar.jsx';
import { PixelIcon } from './SkylinePixelIcons.jsx';
import GameSoundSheet from './GameSoundSheet.jsx';
// Why the last attempt ended, in words a rider can act on.
export function crashReason(flight,entity){
 if(!flight)return null;
 if(flight.crashCause==='stall')return 'You stopped pedaling, so the glider fell. Keep the pedals turning.';
 if(flight.crashCause==='lava')return 'Fell into the lava. Pedal faster to stay high over it.';
 if(flight.crashCause==='terrain')return 'Hit the ground. Pedal faster to climb, slower to drop.';
 if(flight.crashCause==='lives')return entity?.role==='shoot'?'Out of hearts — shoot the bracketed targets instead of flying into them.':'Out of hearts — fly around obstacles.';
 if(flight.crashCause==='entity'){
  if(entity?.piece==='shutter')return 'The gate shut before you got through. Boost (bottom right) as soon as it starts closing.';
  if(entity?.piece)return 'Hit the gate. Pedal to line up with the gap and fly through it.';
  if(entity?.role==='missile')return 'Crashed into the cracked wall. Fire a missile (bottom left) to break it.';
  if(entity?.role==='bomb')return 'Crashed into a tower. Fly over it, or drop a bomb (top right) on it.';
  return 'Crashed into an obstacle. Fly over or under it.';
 }
 return null;
}
const ACT_STATUS={locked:['lock','Admin unlock required'],completed:['check','Completed']};
const STAT_ICON={Bells:'bell',Targets:'target'};
// The flight list shows a fixed window of rows that follows the cursor, so any
// number of configured flights fits the screen and the chosen one is always in
// view. The bike buttons move the cursor; nothing scrolls on its own.
export const FLIGHT_ROWS=5;
export function flightWindow(count,index,rows=FLIGHT_ROWS){
 const start=Math.max(0,Math.min(Math.max(0,index)-Math.floor(rows/2),count-rows));
 return {start,end:Math.min(count,start+rows)};
}
// The list of flights (or, in Skyline Invaders, waves): a fixed window of rows
// that follows the cursor, a count of rows above and below it, a cursor on the
// chosen one. Each row: { id, name, status, status_label (a node) }.
export function FlightList({rows,selectedId,onSelect,testIdPrefix='skyline'}){
 const index=rows.findIndex(r=>r.id===selectedId),{start,end}=flightWindow(rows.length,index);
 return <>
  <p className="skyline-menus__more" data-dir="up" data-testid={`${testIdPrefix}-more-above`} data-empty={start===0||undefined}><PixelIcon name="right" className="skyline-menus__more-icon"/>{start} more</p>
  <div className="skyline-menus__options">{rows.slice(start,end).map(r=><button key={r.id} type="button" aria-pressed={r.id===selectedId} data-status={r.status} data-row={r.id} onClick={event=>{event.currentTarget.blur();onSelect?.(r.id)}}>
   <PixelIcon name="cursor" className="skyline-menus__cursor"/><strong>{r.name}</strong><small>{r.status_label}</small>
  </button>)}</div>
  <p className="skyline-menus__more" data-dir="down" data-testid={`${testIdPrefix}-more-below`} data-empty={end>=rows.length||undefined}><PixelIcon name="right" className="skyline-menus__more-icon"/>{rows.length-end} more</p>
 </>;
}
export default function SkylineMenus({state,riders,acts,onEvent,crashNote,summary,sound}){
 const selected=acts.find(a=>a.id===state.actId),rider=riders.find(r=>r.id===state.riderId);
 // The riders are listed once: on the bike-button panel beside this, where each
 // rider sits on the button that selects them (touch or physical). The 2×2 grid
 // of the same four riders that used to sit here duplicated it (2026-11-10).
 if(state.phase==='identity')return <section className="skyline-menus skyline-menus--identity" data-phase="identity" data-testid="skyline-identity"><h1>Who’s flying?</h1><p>Press your rider button on the pad. Hold for other riders.</p></section>;
 if(state.phase==='roster'){const r=riders[state.rosterIndex];return <section className="skyline-menus" data-phase="roster"><h1>Other riders</h1><p>Browse with the top buttons. Choose with bottom right.</p>{r&&<div className="skyline-menus__person"><SkylineAvatar src={r.avatarSrc} name={r.name}/><strong>{r.name}</strong></div>}</section>}
 if(state.phase==='flights')return <section className="skyline-menus" data-phase="flights">
  <p className="skyline-menus__kicker">{rider?.name} is flying</p><h1>Pick a flight</h1>
  <FlightList rows={acts.map(a=>{const [icon,label]=ACT_STATUS[a.status]||[null,'Ready to explore'];return {id:a.id,name:a.name,status:a.status,status_label:<>{icon&&<PixelIcon name={icon}/>}{label}</>}})} selectedId={state.actId} onSelect={actId=>onEvent({type:'SELECT_ACT',actId})}/>
  <p><span className="skyline-menus__position">{acts.findIndex(a=>a.id===state.actId)+1} of {acts.length}</span> Top buttons browse. Bottom right starts.</p>
 </section>;
 // The sound sheet: the house touch volume strip (11 keys, 0 = off) and a mute
 // key for touch; the bike buttons beside it step the same level (1 quieter,
 // 2 louder, 4 mute, 3 back) and say so on their own keys.
 if(state.phase==='settings')return <section className="skyline-menus skyline-menus--settings" data-phase="settings" data-testid="skyline-sound-sheet">
  <h1>Sound</h1>
  <GameSoundSheet level={sound?.level??0} muted={!!sound?.muted} onLevel={l=>sound?.onLevel?.(l)} onToggleMute={()=>sound?.onToggleMute?.()} controlId="skyline-volume"/>
 </section>;
 if(state.phase==='ready'||state.phase==='countdown')return <section className="skyline-menus" data-phase={state.phase}><p className="skyline-menus__kicker">{selected?.name}</p><h1>{state.phase==='ready'?'Pedal to take off':'Keep pedaling'}</h1><strong className="skyline-menus__count">{state.phase==='countdown'?Math.ceil(state.countdown):Math.round(state.cadence?.rpm||0)+' RPM'}</strong><p>Your flight waits until you’re pedaling steadily.</p></section>;
 const titles={menu:'Flight controls',crash:'Let’s try again',result:'Back at base',saving:'Saving your flight…',denied:'Flight locked','save-details':'Your flight is waiting to save',stall:'Stalled!'};
 return <section className="skyline-menus" data-phase={state.phase}>
  <h1>{titles[state.phase]||'Charting the course…'}</h1>
  {state.phase==='crash'&&crashNote&&<p className="skyline-menus__cause" data-testid="skyline-glider-crash-cause">{crashNote}</p>}
  {state.phase==='result'&&summary&&<dl className="skyline-menus__summary" data-testid="skyline-glider-summary">{summary.map(([label,value,icon])=><div key={label} data-stat={String(label).toLowerCase()}><dt>{icon||(STAT_ICON[label]&&<PixelIcon name={STAT_ICON[label]}/>)}{label}</dt><dd>{value}</dd></div>)}</dl>}
  <p>{state.phase==='crash'?'Your rider and flight are remembered. Choose your next step.':state.phase==='denied'?state.accessReason:state.phase==='save-details'?'Retry saving from the results panel. Starting another flight waits until this record is saved.':state.phase==='result'?(state.saveStatus==='error'?'Save failed. Your result is retained for retry.':state.saveStatus==='unsaved'?'This flight could not be saved. Choose what happens next using your bike buttons.':'Choose what happens next using your bike buttons.'):selected?.name}</p>
 </section>;
}
