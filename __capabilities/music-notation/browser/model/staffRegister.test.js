import {describe,it,expect} from 'vitest';
import {displayStaffMidi,rankStaffCandidates} from './staffRegister.js';
describe('staff register candidates',()=>{
  it.each([[-1,0,36,48],[1,0,84,72],[0,-2,24,48]])('uses signed clef and residual shifts', (octave,residualOctave,midi,written)=>{
    expect(displayStaffMidi(midi,{octave,residualOctave})).toBe(written);
  });
  it('can split a compact voicing using two-part context',()=>{
    const ranked=rankStaffCandidates({columns:[{midis:[55,59,62,65]}],previousParts:{bass:[55,59],treble:[62,65]},octaves:{treble:0,bass:0}});
    const fixed=ranked.find(c=>c.octaves.treble===0&&c.octaves.bass===0);
    expect(fixed.parts.bass.midis).toEqual([55,59]);
    expect(fixed.parts.treble.midis).toEqual([62,65]);
  });
});
