import { rankStaffCandidates, fitStaffPart } from './staffRegister.js';

export const emptyStaffPlan = () => ({columns:[],evidence:[],epochs:[{id:0,treble:0,bass:0}],activeEpoch:0,challenger:null,sourceKey:'',nextEpoch:1,lastOriginId:-1});
const pairEqual=(a,b)=>a.treble===b.treble&&a.bass===b.bass;
const partsOf=p=>({treble:p?.parts.treble.midis??[],bass:p?.parts.bass.midis??[]});

/** Pure history owner. Original MIDI is never changed by notation decisions. */
export function advanceStaffPlan(previous,flow,{keySignature='C'}={}) {
  const raw=flow.columns.slice(-16);
  if(!raw.length) return {state:previous.columns.length?emptyStaffPlan():previous,events:[]};
  const sourceKey=raw.map(c=>`${c.id}/${c.originId}:${c.midis.join('.')}:${c.unitStart}:${!!c.breathBefore}`).join('|');
  if(sourceKey===previous.sourceKey) return {state:previous,events:[]};
  let evidence=previous.evidence.map(e=>({...e,midis:[...e.midis],arrivals:[...e.arrivals]}));
  const lastOriginId=previous.lastOriginId ?? -1;
  const fresh=[];
  for(const c of raw) {
    const originId=c.originId??c.id;
    let e=evidence.find(e=>e.originId===originId);
    if(!e){e={originId,midis:[],arrivals:[]};evidence.push(e);if(originId>lastOriginId)fresh.push(originId);}
    e.midis=[...new Set([...e.midis,...c.midis])].sort((a,b)=>a-b);
    for(const arrival of c.arrivals??[]) if(!e.arrivals.some(a=>a.midi===arrival.midi&&a.at===arrival.at))e.arrivals.push(arrival);
  }
  evidence.sort((a,b)=>a.originId-b.originId);
  evidence=evidence.slice(-8);
  let epochs=[...previous.epochs],activeEpoch=previous.activeEpoch,nextEpoch=previous.nextEpoch;
  let current=epochs.find(e=>e.id===activeEpoch),challenger=previous.challenger;
  const events=[];
  const last=raw.at(-1);
  if(fresh.length) {
    const ranked=rankStaffCandidates({columns:evidence,octaves:current,keySignature});
    const incumbent=ranked.find(c=>pairEqual(c.octaves,current)),best=ranked[0];
    const improvement=incumbent.cost-best.cost;
    if(!pairEqual(best.octaves,current)&&improvement>=Math.max(1,incumbent.cost*0.20)) {
      challenger={...best.octaves,votes:pairEqual(challenger??{},best.octaves)?challenger.votes+1:1};
      const eligible=last.breathBefore||(last.unitStart??0)%4===0;
      if(evidence.length>=4&&challenger.votes>=3&&eligible) {
        const before={treble:current.treble,bass:current.bass};
        current={id:nextEpoch++,...best.octaves};activeEpoch=current.id;epochs.push(current);challenger=null;
        events.push({type:'register-changed',columnId:last.id,before,after:best.octaves,origins:evidence.length,improvement});
      }
    } else challenger=null;
  }
  const oldById=new Map(previous.columns.map(c=>[c.id,c]));
  const originPlan=new Map(previous.columns.map(c=>[c.originId,c]));
  const columns=[];
  for(let i=0;i<raw.length;i++) {
    const c=raw[i],old=oldById.get(c.id),originId=c.originId??c.id;
    const frozen=i<raw.length-2;
    if(old?.frozen){columns.push(old);continue;}
    const inherited=old??originPlan.get(originId);
    const epoch=inherited?epochs.find(e=>e.id===inherited.epoch):current;
    let parts;
    const originMidis=inherited?[...inherited.parts.treble.midis,...inherited.parts.bass.midis]:[];
    if(inherited&&c.midis.every(m=>originMidis.includes(m))) {
      parts=Object.fromEntries(['treble','bass'].map(staff=>[staff,{...inherited.parts[staff],midis:inherited.parts[staff].midis.filter(m=>c.midis.includes(m))}]));
    } else {
      const context=partsOf(columns.at(-1)??previous.columns.at(-1));
      const ranked=rankStaffCandidates({columns:[c],previousParts:context,octaves:epoch,keySignature});
      const candidate=ranked.find(x=>pairEqual(x.octaves,epoch));
      parts=Object.fromEntries(['treble','bass'].map(staff=>[staff,fitStaffPart(candidate.parts[staff],staff)]));
    }
    columns.push({id:c.id,originId,epoch:epoch.id,parts,frozen});
  }
  const retained=new Set([...columns.map(c=>c.epoch),activeEpoch]);
  epochs=epochs.filter(e=>retained.has(e.id));
  return {state:{columns,evidence,epochs,activeEpoch,challenger,sourceKey,nextEpoch,lastOriginId:Math.max(lastOriginId,...raw.map(c=>c.originId??c.id))},events};
}
