#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emptyFlow,pushOnsets,flowDurations} from '../../../__capabilities/music-notation/browser/model/noteFlow.js';
import {emptyStaffPlan,advanceStaffPlan} from '../../../__capabilities/music-notation/browser/model/staffPlanner.js';
import {makeStaffFixture,runStaffFixture} from '../../_fixtures/piano/staffRegisterFixtures.mjs';
import {openStaffInkHarness} from './chord-staff-ink.mjs';
export async function checkStaffRegisters() {
  const harness=await openStaffInkHarness(); let cases=0;
  try {
    // Real flow promotion must not move a frozen staff's heads. Width and plan
    // identity alone cannot catch an independently recalculated bass displacement.
    let heldFlow=emptyFlow(),heldPlan=emptyStaffPlan();
    const held=new Set([43,50,72,76,79]);
    for(const at of [0,200,400,600]) {
      heldFlow=pushOnsets(heldFlow,at===0?[...held]:[96],at,{held});
      heldPlan=advanceStaffPlan(heldPlan,heldFlow).state;
    }
    assert.equal(heldPlan.columns[0].frozen,true);
    const heldSnapshots=[];
    for(const now of [600,900]) {
      const durations=flowDurations(heldFlow,now);
      const columns=heldFlow.columns.map((c,i)=>({...c,duration:durations[i],widthDuration:c.closeDuration??durations[i],staffPlan:heldPlan.columns.find(p=>p.id===c.id)}));
      const result=await harness.measureCase({columns,aspect:3});cases++;
      assert.deepEqual(result.pitchFailures,[]);assert.deepEqual(result.crossStaffInkHits,[]);assert.equal(result.clipped,false);
      heldSnapshots.push(result.headPositions.filter(p=>p.id===0));
    }
    assert.deepEqual(heldSnapshots[1],heldSnapshots[0],'frozen heads move when a held eighth promotes to a half');
    const control=await harness.measureCase({columns:[[48,72]],positiveControl:true});
    assert(control.crossStaffInkHits.length>0,'ink detector must detect its positive control');
    const planned={id:0,originId:0,epoch:0,parts:{treble:{midis:[60],octave:-1,residualOctave:0},bass:{midis:[36],octave:-1,residualOctave:0}}};
    const plannedColumn={id:0,midis:[36,60],duration:'q',staffPlan:planned};
    const wrongSign=await harness.measureCase({columns:[plannedColumn],corruptClefSign:true});
    assert.notDeepEqual(wrongSign.pitchFailures??[],[],'visual oracle must detect an incorrect clef sign');
    const dropped=await harness.measureCase({columns:[plannedColumn],dropFirstHead:true});
    assert.notDeepEqual(dropped.pitchFailures??[],[],'visual oracle must detect a missing notehead');
    for(const midis of [[36,48,60,64,67],[24,36,60,64,67],[43,48,53,60,64,67]])
      for(const duration of ['8','q','h']) for(const aspect of [560/210,300/220]) {
        const opts={columns:[{midis,duration}],keySignature:'C',aspect};
        const result=await harness.measureCase(opts); cases++;
        assert.equal(result.clipped,false,JSON.stringify({opts,result}));
        assert.deepEqual(result.pitchFailures??[],[],JSON.stringify({opts,result}));
        assert.deepEqual(result.crossStaffInkHits,[],JSON.stringify({opts,result}));
      }
    for(const midis of [[28,40,68,71,75],[29,41,69,72,76],[30,42,70,73,77],[31,43,71,74,78],[32,44,72,75,79],[33,45,73,76,80],[34,46,74,77,81]]) {
      const columns=[midis,midis.map(m=>m+1),midis].map(midis=>({midis,duration:'8'}));
      const result=await harness.measureCase({columns,keySignature:'C',aspect:560/210});cases++;
      assert.deepEqual(result.crossStaffInkHits,[],JSON.stringify({midis,result}));
      assert.deepEqual(result.pitchFailures,[]);assert.equal(result.clipped,false);
    }
    const widePlan={id:0,originId:0,epoch:0,parts:{treble:{midis:[96],octave:0,residualOctave:2},bass:{midis:[29,40,50],octave:0,residualOctave:-1}}};
    const wideResult=await harness.measureCase({columns:[{id:0,midis:[29,40,50,96],duration:'8',staffPlan:widePlan}],aspect:2.8});cases++;
    assert.equal(wideResult.clipped,false,JSON.stringify(wideResult));
    assert.deepEqual(wideResult.crossStaffInkHits,[]);assert.deepEqual(wideResult.pitchFailures,[]);
    const nextTreble=midi=>({midis:[midi],duration:'8',staffPlan:{id:midi,originId:midi,epoch:0,parts:{treble:{midis:[midi],octave:0,residualOctave:0},bass:{midis:[],octave:0,residualOctave:0}}}});
    const mixed=await harness.measureCase({columns:[{midis:[29,40,50,96],duration:'8',staffPlan:widePlan},nextTreble(84),nextTreble(73)],aspect:2.8});cases++;
    assert.deepEqual(mixed.crossStaffInkHits,[],JSON.stringify(mixed));assert.equal(mixed.clipped,false);
    for(const transpose of [-24,-12,0,12,24]) {
      const fixture=makeStaffFixture('paired',{transpose});
      const out=runStaffFixture(fixture);
      const raw=fixture.frames.at(-1).flow.columns;
      const columns=raw.map(c=>({...c,staffPlan:out.state.columns.find(p=>p.id===c.id)}));
      for(const keySignature of ['C','G','D','A','E','B','F#','F','Bb','Eb','Ab','Db','Gb'])
      for(const aspect of [560/210,300/220,1,1.7,3.5,0.6])
      for(const duration of ['8','q','h']) {
      const opts={columns:columns.map(c=>({...c,duration})),keySignature,aspect};
      const result=await harness.measureCase(opts);cases++;
      assert.equal(result.clipped,false,JSON.stringify({transpose,keySignature,aspect,duration,result}));
      assert.deepEqual(result.pitchFailures??[],[],JSON.stringify({transpose,keySignature,aspect,duration,result}));
      assert.deepEqual(result.crossStaffInkHits,[],JSON.stringify({transpose,keySignature,aspect,duration,result}));
      }
    }
    for(const [transpose,midi] of [[-12,108],[12,21],[-24,108],[24,21]]) {
      const fixture=makeStaffFixture('paired',{transpose}),before=runStaffFixture(fixture).state;
      const flow={...fixture.frames.at(-1).flow,columns:[...fixture.frames.at(-1).flow.columns,{id:999,originId:999,midis:[midi],unitStart:25,arrivals:[{midi,at:9999}]}]};
      const after=advanceStaffPlan(before,flow).state;
      assert.equal(after.activeEpoch,before.activeEpoch,'one extreme does not change the clef');
      const result=await harness.measureCase({columns:[{midis:[midi],duration:'8',staffPlan:after.columns.at(-1)}],aspect:2.8});cases++;
      assert.equal(result.clipped,false,JSON.stringify({transpose,midi,result}));
      assert.deepEqual(result.pitchFailures,[]);
    }
    if(process.argv[2]) {
      const snapshots=JSON.parse(readFileSync(process.argv[2],'utf8'));
      assert(snapshots.length>0,'replay snapshot corpus must not be empty');
      for(let i=0;i<snapshots.length;i++) {
        const snapshot=snapshots[i];
        const result=await harness.measureCase({columns:snapshot.columns,keySignature:snapshot.keySignature,aspect:2.8});
        assert.deepEqual(result.pitchFailures,[],JSON.stringify({snapshot:i,result}));
        assert.deepEqual(result.crossStaffInkHits,[],JSON.stringify({snapshot:i,result}));
        assert.equal(result.clipped,false,JSON.stringify({snapshot:i,result}));cases++;
      }
      process.stdout.write(`Real replay snapshots checked: ${snapshots.length}.\n`);
    }
    process.stdout.write(`Staff register/ink check: ${cases} cases passed; overlap positive control detected.\n`);
  } finally {await harness.close();}
}
if(import.meta.url === `file://${process.argv[1]}`) checkStaffRegisters().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=error instanceof assert.AssertionError?1:2;});
