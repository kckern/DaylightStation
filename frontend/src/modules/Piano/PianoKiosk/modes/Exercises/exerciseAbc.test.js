// exerciseAbc.test.js — instanceToAbc's clef chain (rule 1: explicit hand →
// instance.staff → pitch-range majority) and the retirement of the
// ordering:'any' grand-staff branch. String-level guards only; the rendered-DOM
// authority is Task 10 (SvgSequenceStaff / KeysAsk).
import { describe, expect, it } from 'vitest';
import { instanceToAbc } from './exerciseAbc.js';

const base = {
  key: 'C',
  meter: '4/4',
  ordering: 'strict',
};

describe('instanceToAbc clef chain', () => {
  it('explicit hand: an all-right-hand strict instance gets one treble V: line, no V:LH', () => {
    const abc = instanceToAbc({
      ...base,
      events: [
        { notes: [{ midi: 60, hand: 'right', finger: 1 }] },
        { notes: [{ midi: 64, hand: 'right', finger: 3 }] },
      ],
    });

    expect(abc.match(/^V:.*/gm)).toEqual(['V:MAIN clef=treble']);
    expect(abc).not.toContain('V:LH');
  });

  it('instance.staff: a hand-less instance with staff:bass gets clef=bass', () => {
    const abc = instanceToAbc({
      ...base,
      staff: 'bass',
      events: [
        { notes: [{ midi: 43 }] },
        { notes: [{ midi: 45 }] },
      ],
    });

    expect(abc).toContain('V:MAIN clef=bass');
  });

  it('pitch-range majority: a hand-less, staff-less instance with median pitch 48 gets clef=bass', () => {
    const abc = instanceToAbc({
      ...base,
      events: [
        { notes: [{ midi: 45 }] },
        { notes: [{ midi: 48 }] },
        { notes: [{ midi: 51 }] },
      ],
    });

    expect(abc).toContain('V:MAIN clef=bass');
  });

  it('pitch-range majority picks treble when most notes sit at or above middle C', () => {
    const abc = instanceToAbc({
      ...base,
      events: [
        { notes: [{ midi: 60 }] },
        { notes: [{ midi: 64 }] },
        { notes: [{ midi: 43 }] },
      ],
    });

    expect(abc).toContain('V:MAIN clef=treble');
  });

  it('ordering:any never reaches the ABC renderer — returns the empty string', () => {
    const abc = instanceToAbc({
      ...base,
      ordering: 'any',
      events: [{ notes: [{ midi: 60 }, { midi: 64 }, { midi: 67 }] }],
    });

    expect(abc).toBe('');
  });

  it('a genuine two-hand instance still gets a grand staff via generateMelodyAbc', () => {
    const abc = instanceToAbc({
      ...base,
      events: [{ notes: [{ midi: 48, hand: 'left' }, { midi: 60, hand: 'right' }] }],
    });

    expect(abc).toContain('%%staves {(RH) (LH)}');
    expect(abc).toContain('V:RH clef=treble');
    expect(abc).toContain('V:LH clef=bass');
  });
});
