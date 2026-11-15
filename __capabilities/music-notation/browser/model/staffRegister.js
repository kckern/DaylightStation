import { STAFF_GEOMETRY, staffYForPosition } from './staffGeometry.js';
import { getStaffPositionOnClef } from './pitch.js';

export const STAFF_REGISTER_COSTS = Object.freeze({
  center: 0.08, ledger: 0.8, reach: 0.1, closeSplit: 1.5,
  continuity: 0.05, changedPart: 6, registerChange: 0.8,
  independentChange: 3, collision: 0.3, outsideFrame: 1000,
});
const OCTAVES = [-2,-1,0,1,2];
const mean = xs => xs.reduce((a,b)=>a+b,0)/xs.length;
const position = (m,staff) => getStaffPositionOnClef(m,staff).position;
export const displayStaffMidi = (midi,part) => midi-12*(part.octave+part.residualOctave);

function partCost(midis, staff, octave, previous) {
  if (!midis.length) return 0;
  const w=STAFF_REGISTER_COSTS;
  const positions=midis.map(m=>position(m-12*octave,staff));
  let cost=mean(positions.map(p=>w.center*(p-4)**2+w.ledger*Math.max(0,-p,p-8)**2));
  cost+=w.reach*Math.max(0,midis.at(-1)-midis[0]-14)**2;
  if(previous?.length) cost+=w.continuity*(mean(midis)-mean(previous))**2;
  // Actual outer frame, independent of the conventional five staff lines.
  const ys=positions.map(p=>staffYForPosition(p,staff));
  if(ys.some(y=>y<STAFF_GEOMETRY.top+15||y>STAFF_GEOMETRY.bottom-23)) cost+=w.outsideFrame;
  return cost;
}

function assign(midis, octaves, previous={}) {
  const notes=[...new Set(midis)].sort((a,b)=>a-b);
  let best=null;
  for(let k=0;k<=notes.length;k++) {
    const bass=notes.slice(0,k),treble=notes.slice(k);
    let cost=partCost(bass,'bass',octaves.bass,previous.bass)+partCost(treble,'treble',octaves.treble,previous.treble);
    if(bass.length&&treble.length) {
      cost+=STAFF_REGISTER_COSTS.closeSplit*Math.max(0,7-treble[0]+bass.at(-1));
      for(const b of bass) for(const t of treble) {
        const by=staffYForPosition(position(b-12*octaves.bass,'bass'),'bass');
        const ty=staffYForPosition(position(t-12*octaves.treble,'treble'),'treble');
        cost+=STAFF_REGISTER_COSTS.collision*Math.max(0,12-Math.abs(by-ty))**2;
      }
    }
    for(const m of bass) if(previous.treble?.includes(m)) cost+=STAFF_REGISTER_COSTS.changedPart;
    for(const m of treble) if(previous.bass?.includes(m)) cost+=STAFF_REGISTER_COSTS.changedPart;
    if(!best||cost<best.cost) best={bass,treble,cost};
  }
  return best??{bass:[],treble:[],cost:0};
}

export function rankStaffCandidates({columns,previousParts={},octaves={treble:0,bass:0}}) {
  const ranked=[];
  for(const treble of OCTAVES) for(const bass of OCTAVES) {
    const pair={treble,bass};let prior=previousParts;let cost=0;let last={bass:[],treble:[]};
    let sawBass=false,sawTreble=false;
    for(const column of columns) {
      last=assign(column.midis,pair,prior);cost+=last.cost;
      if(last.bass.length){sawBass=true;prior={...prior,bass:last.bass};}
      if(last.treble.length){sawTreble=true;prior={...prior,treble:last.treble};}
    }
    cost/=Math.max(1,columns.length);
    const dt=treble-octaves.treble,db=bass-octaves.bass;
    cost+=STAFF_REGISTER_COSTS.registerChange*(Math.abs(dt)+Math.abs(db));
    cost+=STAFF_REGISTER_COSTS.independentChange*Math.abs(dt-db);
    if(!sawBass&&db || !sawTreble&&dt) cost+=STAFF_REGISTER_COSTS.outsideFrame;
    ranked.push({octaves:pair,cost,feasible:cost<STAFF_REGISTER_COSTS.outsideFrame,confidence:0,
      parts:{treble:{midis:last.treble,octave:treble,residualOctave:0},bass:{midis:last.bass,octave:bass,residualOctave:0}}});
  }
  ranked.sort((a,b)=>a.cost-b.cost ||
    (Math.abs(a.octaves.treble-octaves.treble)+Math.abs(a.octaves.bass-octaves.bass))-(Math.abs(b.octaves.treble-octaves.treble)+Math.abs(b.octaves.bass-octaves.bass)) ||
    a.octaves.treble-b.octaves.treble || a.octaves.bass-b.octaves.bass);
  for(const candidate of ranked) candidate.confidence=Math.max(0,(ranked[1]?.cost??candidate.cost)-candidate.cost);
  return ranked;
}

// Rare initial/outlier columns may need a local mark before sufficient register
// evidence exists. Evaluate the whole assigned range, never its lowest key alone.
export function fitStaffPart(part,staff) {
  const ys=part.midis.map(m=>staffYForPosition(position(displayStaffMidi(m,part),staff),staff));
  if(!ys.some(y=>y<STAFF_GEOMETRY.top+15||y>STAFF_GEOMETRY.bottom-23)) return part;
  const ranked=OCTAVES.map(residualOctave=>({residualOctave,
    cost:partCost(part.midis,staff,part.octave+residualOctave)+Math.abs(residualOctave)})).sort((a,b)=>a.cost-b.cost);
  return {...part,residualOctave:ranked[0].residualOctave};
}
