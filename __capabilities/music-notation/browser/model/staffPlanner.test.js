import {describe,it,expect} from 'vitest';
import {emptyStaffPlan,advanceStaffPlan} from './staffPlanner.js';
import {displayStaffMidi} from './staffRegister.js';
import {makeStaffFixture,runStaffFixture,staffPlanFailures} from '../../../../tests/_fixtures/piano/staffRegisterFixtures.mjs';
const epoch=state=>state.epochs.find(e=>e.id===state.activeEpoch);
describe('adaptive staff planner',()=>{
  it.each([-12,0,12])('acquires paired register for transposition %s',transpose=>{
    const fixture=makeStaffFixture('paired',{transpose});
    const out=runStaffFixture(fixture);
    expect(epoch(out.state)).toMatchObject({treble:transpose/12,bass:transpose/12});
    expect(out.history.slice(0,3).every(r=>r.state.activeEpoch===0)).toBe(true);
    for(const c of out.state.columns){
      const expected=fixture.expected[c.id];
      if(c.epoch!==0 || transpose===0){
        expect(c.parts.treble.midis).toEqual(expected.treble);
        expect(c.parts.bass.midis).toEqual(expected.bass);
      }
      for(const part of Object.values(c.parts))for(const midi of part.midis)
        expect(displayStaffMidi(midi,part)+12*(part.octave+part.residualOctave)).toBe(midi);
    }
  });
  it.each(['upper-only-shift','lower-only-shift'])('allows an independent move: %s',name=>{
    const out=runStaffFixture(makeStaffFixture(name));
    expect(epoch(out.state)).toMatchObject(name==='upper-only-shift'?{treble:1,bass:0}:{treble:0,bass:-1});
  });
  it('a lone note displays immediately and a key change is not register evidence',()=>{
    const flow={columns:[{id:0,originId:0,midis:[60],arrivals:[{midi:60,at:0}],unitStart:0}]};
    const a=advanceStaffPlan(emptyStaffPlan(),flow);
    expect(a.state.columns[0].parts.treble.midis).toEqual([60]);
    expect(a.state.columns[0].parts.bass.midis).toEqual([]);
    expect(advanceStaffPlan(a.state,flow,{keySignature:'F#'}).state).toBe(a.state);
  });
  it.each([-1,1])('does not change octave for a small pitch shift: %s',transpose=>{
    expect(runStaffFixture(makeStaffFixture('paired',{transpose})).state.activeEpoch).toBe(0);
  });
  it('does not infer or vote on 10000 repeated ticks',()=>{
    const frame=makeStaffFixture('paired').frames[0];
    const first=advanceStaffPlan(emptyStaffPlan(),frame.flow);
    for(let i=0;i<10000;i++){
      const next=advanceStaffPlan(first.state,frame.flow);
      expect(next.state).toBe(first.state);expect(next.events).toEqual([]);
    }
  });
  it('one origin votes once while a roll grows or splits',()=>{
    const frame=makeStaffFixture('paired',{transpose:12}).frames[0];
    const first=advanceStaffPlan(emptyStaffPlan(),frame.flow);
    const column=frame.flow.columns[0];
    const flow={...frame.flow,columns:[{...column,midis:column.midis.slice(0,2)},{...column,id:99,midis:column.midis.slice(2)}]};
    const next=advanceStaffPlan(first.state,flow);
    expect(next.state.evidence).toHaveLength(1);
    expect(next.state.activeEpoch).toBe(0);
    expect(next.state.columns.every(c=>c.epoch===0)).toBe(true);
  });
  it('bounds evidence and plans and retains frozen assignments while scrolling',()=>{
    const fixture=makeStaffFixture('paired',{count:40});
    const out=runStaffFixture(fixture);
    expect(out.state.evidence.length).toBeLessThanOrEqual(8);
    expect(out.state.evidence.map(e=>e.originId)).toEqual([32,33,34,35,36,37,38,39]);
    expect(out.state.columns.length).toBeLessThanOrEqual(16);
    const old=out.history.at(-2).state.columns.filter(c=>c.frozen);
    for(const c of old){const retained=out.state.columns.find(n=>n.id===c.id);if(retained)expect(retained).toEqual(c);}
  });
  it.each(['alternating','close-parts','sustained-bass','crossing-ambiguous','split-after-transition','equal-timestamps'])('preserves every MIDI and epoch in %s',name=>{
    const f=makeStaffFixture(name);const out=runStaffFixture(f);
    for(const p of out.state.columns){
      const raw=f.frames.at(-1).flow.columns.find(c=>c.id===p.id);
      expect([...p.parts.bass.midis,...p.parts.treble.midis].sort((a,b)=>a-b)).toEqual(raw.midis);
      expect(out.state.epochs.some(e=>e.id===p.epoch)).toBe(true);
    }
  });
  it('requires several origins and an eligible boundary to change register',()=>{
    const fixture=makeStaffFixture('paired',{transpose:12});
    const frames=fixture.frames.map(f=>({...f,flow:{...f.flow,columns:f.flow.columns.map(c=>({...c,unitStart:1,breathBefore:false}))}}));
    let s=emptyStaffPlan();for(const f of frames)s=advanceStaffPlan(s,f.flow).state;
    expect(s.activeEpoch).toBe(0);
    const c={...frames.at(-1).flow.columns.at(-1),id:99,originId:99,unitStart:0,breathBefore:true};
    s=advanceStaffPlan(s,{...frames.at(-1).flow,columns:[...frames.at(-1).flow.columns,c]}).state;
    expect(epoch(s)).toMatchObject({treble:1,bass:1});
  });
});


it('replay invariants reject dropped pitches and incorrect epoch signs',()=>{
 const fixture=makeStaffFixture('paired');const out=runStaffFixture(fixture);const flow=fixture.frames.at(-1).flow;
 expect(staffPlanFailures(flow,out.state)).toEqual([]);
 const bad={...out.state,columns:out.state.columns.map((c,i)=>i?c:{...c,parts:{...c.parts,treble:{...c.parts.treble,midis:[],octave:1}}})};
 expect(staffPlanFailures(flow,bad)).toContain('pitch-coverage:0');
 expect(staffPlanFailures(flow,bad)).toContain('epoch-mismatch:0');
});


it('keeps the two ranges distinct during double-octave acquisition',()=>{
 const frame=makeStaffFixture('paired',{transpose:-24}).frames[0];
 const out=advanceStaffPlan(emptyStaffPlan(),frame.flow);
 expect(out.state.activeEpoch).toBe(0);
 expect(out.state.columns[0].parts.bass.midis).toEqual([24,31]);
 expect(out.state.columns[0].parts.treble.midis).toEqual([48,52,55]);
});


it('retains established close parts and ordinary clefs after wide context scrolls away',()=>{
 const fixture=makeStaffFixture('close-parts',{count:40});
 const out=runStaffFixture(fixture);
 for(const {state} of out.history){
   expect(epoch(state)).toMatchObject({treble:0,bass:0});
   for(const column of state.columns){
     expect(column.parts.bass.midis).toEqual(fixture.expected[column.id].bass);
     expect(column.parts.treble.midis).toEqual(fixture.expected[column.id].treble);
   }
 }
 expect(out.events).toEqual([]);
});


it.each(['alternating','sustained-bass','equal-timestamps','upper-only-shift','lower-only-shift'])('preserves labeled part membership in %s',name=>{
 const fixture=makeStaffFixture(name),out=runStaffFixture(fixture);
 for(const column of out.state.columns)for(const staff of ['bass','treble'])
   expect(column.parts[staff].midis).toEqual(fixture.expected[column.id][staff]);
});


it.each([-12,12])('retains close parts after acquiring octave %s',transpose=>{
 const fixture=makeStaffFixture('paired',{transpose,count:40});
 for(const frame of fixture.frames)frame.flow.columns=frame.flow.columns.map(c=>c.id<8?c:{
   ...c,midis:[55,59,62,65].map(m=>m+transpose),
   arrivals:[55,59,62,65].map(m=>({midi:m+transpose,at:c.startedAt}))
 });
 const out=runStaffFixture(fixture);
 for(const {state} of out.history.slice(8)){
   expect(epoch(state)).toMatchObject({treble:transpose/12,bass:transpose/12});
   for(const column of state.columns.filter(c=>c.id>=8)){
     expect(column.parts.bass.midis).toEqual([55,59].map(m=>m+transpose));
     expect(column.parts.treble.midis).toEqual([62,65].map(m=>m+transpose));
   }
 }
 expect(out.events.every(e=>e.columnId<8)).toBe(true);
});
