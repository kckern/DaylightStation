import {emptyStaffPlan,advanceStaffPlan} from '../../../__capabilities/music-notation/browser/model/staffPlanner.js';
const PHRASE=[[[48,55],[72,76,79]],[[50,57],[74,77,81]],[[52,59],[76,79,83]],[[48,55],[72,76,79]]];
export function makeStaffFixture(name,{transpose=0,count}={}) {
  const names=['paired','upper-only-shift','lower-only-shift','alternating','close-parts','sustained-bass','crossing-ambiguous','split-after-transition','equal-timestamps'];
  if(!names.includes(name))throw new Error('Unknown staff fixture '+name);
  count??=(name.includes('only-shift')?24:12);
  const columns=[],frames=[],expected={};
  for(let i=0;i<count;i++) {
    let [bass,treble]=PHRASE[i%4].map(a=>a.map(m=>m+transpose));
    if(name==='upper-only-shift'&&i>=8)treble=treble.map(m=>m+12);
    if(name==='lower-only-shift'&&i>=8)bass=bass.map(m=>m-12);
    if(name==='alternating'){if(i%2)bass=[];else treble=[];}
    if(name==='sustained-bass'&&i>0)bass=[];
    if(name==='close-parts'&&i>=4){bass=[55,59];treble=[62,65];}
    if(name==='crossing-ambiguous'&&i>=4){bass=[59];treble=[60,62];}
    const midis=[...bass,...treble].sort((a,b)=>a-b),startedAt=name==='equal-timestamps'?0:i*500;
    const column={id:i,originId:i,startedAt,lastOnsetAt:startedAt,midis,arrivals:midis.map(midi=>({midi,at:startedAt})),duration:'q',closeDuration:'q',unitStart:i*2,breathBefore:false};
    columns.push(column);expected[i]={bass,treble};
    frames.push({flow:{columns:columns.slice(-16),nextColumnId:i+1,lastOnsetAt:startedAt,recentIois:[]},keySignature:'C'});
  }
  if(name==='split-after-transition') {
    const last=columns.at(-1); const split=last.midis.slice(0,2),rest=last.midis.slice(2);
    const a={...last,midis:split},b={...last,id:999,midis:rest};
    frames.push({flow:{...frames.at(-1).flow,columns:[...columns.slice(-15,-1),a,b]},keySignature:'C'});
  }
  return {frames,expected};
}
export function runStaffFixture(fixture) {
  let state=emptyStaffPlan();const history=[],events=[];
  for(const frame of fixture.frames){const out=advanceStaffPlan(state,frame.flow,{keySignature:frame.keySignature});state=out.state;history.push(out);events.push(...out.events);}
  return {state,history,events};
}


// Test/harness boundary checks; no private recording or physical-hand assumptions.
export function staffPlanFailures(flow,state) {
  const failures=[];
  for(const raw of flow.columns.slice(-16)) {
    const c=state.columns.find(c=>c.id===raw.id);
    if(!c){failures.push(`missing-column:${raw.id}`);continue;}
    const pitches=[...c.parts.treble.midis,...c.parts.bass.midis].sort((a,b)=>a-b);
    if(JSON.stringify(pitches)!==JSON.stringify([...raw.midis].sort((a,b)=>a-b)))failures.push(`pitch-coverage:${raw.id}`);
    const epoch=state.epochs.find(e=>e.id===c.epoch);
    if(!epoch||['treble','bass'].some(s=>c.parts[s].octave!==epoch[s]))failures.push(`epoch-mismatch:${raw.id}`);
    if(Object.values(c.parts).some(p=>!Number.isInteger(p.octave)||!Number.isInteger(p.residualOctave)||Math.abs(p.octave)>2||Math.abs(p.residualOctave)>2))failures.push(`invalid-octave:${raw.id}`);
  }
  return failures;
}
