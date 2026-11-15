#!/usr/bin/env node
import assert from 'node:assert/strict';
import {openStaffInkHarness} from './chord-staff-ink.mjs';
export async function checkStaffRegisters() {
  const harness=await openStaffInkHarness(); let cases=0;
  try {
    const control=await harness.measureCase({columns:[[48,72]],positiveControl:true});
    assert(control.crossStaffInkHits.length>0,'ink detector must detect its positive control');
    for(const midis of [[36,48,60,64,67],[24,36,60,64,67],[43,48,53,60,64,67]])
      for(const duration of ['8','q','h']) for(const aspect of [560/210,300/220]) {
        const opts={columns:[{midis,duration}],keySignature:'C',aspect};
        const result=await harness.measureCase(opts); cases++;
        assert.equal(result.clipped,false,JSON.stringify({opts,result}));
        assert.deepEqual(result.crossStaffInkHits,[],JSON.stringify({opts,result}));
      }
    process.stdout.write(`Staff register/ink check: ${cases} cases passed; overlap positive control detected.\n`);
  } finally {await harness.close();}
}
if(import.meta.url === `file://${process.argv[1]}`) checkStaffRegisters().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=error instanceof assert.AssertionError?1:2;});
