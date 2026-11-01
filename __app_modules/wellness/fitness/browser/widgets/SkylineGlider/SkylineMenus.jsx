import React from 'react';
import SkylineAvatar from './SkylineAvatar.jsx';
// Why the last attempt ended, in words a rider can act on.
export function crashReason(flight,entity){
 if(!flight)return null;
 if(flight.crashCause==='stall')return 'You stopped pedaling, so the glider fell. Keep the pedals turning.';
 if(flight.crashCause==='lava')return 'Fell into the lava. Pedal faster to stay high over it.';
 if(flight.crashCause==='terrain')return 'Hit the ground. Pedal faster to climb, slower to drop.';
 if(flight.crashCause==='lives')return entity?.role==='shoot'?'Out of hearts — shoot the bracketed targets instead of flying into them.':'Out of hearts — fly around obstacles.';
 if(flight.crashCause==='entity')return entity?.role==='bomb'?'Crashed into a wall. Drop a bomb (top right) on walls marked BOMB.':'Crashed into an obstacle. Fly over or under it.';
 return null;
}
export default function SkylineMenus({state,riders,acts,onEvent,crashNote,summary}){
 const selected=acts.find(a=>a.id===state.actId),rider=riders.find(r=>r.id===state.riderId);
 const press=position=>onEvent({type:'PRESS',position,gesture:'single',source:'touch'});
 const person=r=><><SkylineAvatar src={r.avatarSrc} name={r.name}/><strong>{r.name}</strong></>;
 if(state.phase==='identity')return <section className="skyline-menus"><h1>Who’s flying?</h1><p>Press your rider button. Hold for other riders.</p><div className="skyline-menus__options">{riders.filter(r=>r.position).map(r=><button key={r.id} onClick={()=>press(r.position)}>{person(r)}<small>Button {r.position}</small></button>)}</div></section>;
 if(state.phase==='roster'){const r=riders[state.rosterIndex];return <section className="skyline-menus"><h1>Other riders</h1><p>Browse with the top buttons. Choose with bottom right.</p>{r&&<div className="skyline-menus__person">{person(r)}</div>}</section>}
 if(state.phase==='flights')return <section className="skyline-menus"><p>{rider?.name} is flying</p><h1>Pick a flight</h1><p>Top buttons browse. Bottom right starts.</p><div className="skyline-menus__options">{acts.map(a=><button key={a.id} aria-pressed={a.id===state.actId} onClick={()=>onEvent({type:'SELECT_ACT',actId:a.id})}><strong>{a.name}</strong><small>{a.status==='locked'?'🔒 Admin unlock required':a.status==='completed'?'✓ Completed':'Ready to explore'}</small></button>)}</div></section>;
 if(state.phase==='ready'||state.phase==='countdown')return <section className="skyline-menus"><p>{selected?.name}</p><h1>{state.phase==='ready'?'Pedal to take off':'Keep pedaling'}</h1><strong className="skyline-menus__count">{state.phase==='countdown'?Math.ceil(state.countdown):Math.round(state.cadence?.rpm||0)+' RPM'}</strong><p>Your flight waits until you’re pedaling steadily.</p></section>;
 const titles={menu:'Flight controls',crash:'Let’s try again',result:'Back at base',saving:'Saving your flight…',denied:'Flight locked','save-details':'Your flight is waiting to save',stall:'Stalled!'};
 return <section className="skyline-menus"><h1>{titles[state.phase]||'Charting the course…'}</h1>{state.phase==='crash'&&crashNote&&<p className="skyline-menus__cause" data-testid="skyline-glider-crash-cause">{crashNote}</p>}{state.phase==='result'&&summary&&<dl className="skyline-menus__summary" data-testid="skyline-glider-summary">{summary.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}<p>{state.phase==='crash'?'Your rider and flight are remembered. Choose your next step.':state.phase==='denied'?state.accessReason:state.phase==='save-details'?'Retry saving from the results panel. Starting another flight waits until this record is saved.':state.phase==='result'?(state.saveStatus==='error'?'Save failed. Your result is retained for retry.':'Choose what happens next using your bike buttons.'):selected?.name}</p></section>;
}
