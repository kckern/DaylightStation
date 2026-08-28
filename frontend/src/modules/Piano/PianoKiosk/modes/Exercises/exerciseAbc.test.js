// exerciseAbc.test.js — instanceToAbc's clef chain (rule 1, per
// docs/reference/piano/exercise-bank.md:140-175: instance.staff → explicit
// hand → pitch-range majority) and the retirement of the ordering:'any'
// grand-staff branch. String-level guards only; the rendered-DOM authority is
// Task 10 (SvgSequenceStaff / KeysAsk).
//
// The chain-order tests below use CONTRADICTING signals deliberately — every
// link has to win over the ones below it, not merely agree with them, or a
// dropped link would pass silently.
import { describe, expect, it } from 'vitest';
import { instanceToAbc } from './exerciseAbc.js';
import { midiToAbc } from '../../../../MusicNotation/renderers/abc.js';

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

  describe('chain priority — instance.staff wins over hand, hand wins over pitch', () => {
    it('staff:bass overrides an all-right-hand, treble-register instance (the bank\'s re-notation case)', () => {
      // exercise-bank.md's worked example: a hand-tagged triad re-notated
      // across the staff axis is a genuinely different exercise, not a no-op.
      // If hand ever outranks staff, this renders identically to a plain
      // right-hand triad — which is exactly the bug the reviewer reproduced.
      const abc = instanceToAbc({
        ...base,
        staff: 'bass',
        events: [{ notes: [{ midi: 60, hand: 'right' }, { midi: 64, hand: 'right' }, { midi: 67, hand: 'right' }] }],
      });

      expect(abc).toContain('V:MAIN clef=bass');
    });

    it('staff accepts treble/bass case-insensitively, with surrounding whitespace', () => {
      const abc = instanceToAbc({
        ...base,
        staff: '  BASS  ',
        events: [{ notes: [{ midi: 60, hand: 'right' }] }],
      });

      expect(abc).toContain('V:MAIN clef=bass');
    });

    it('a garbage staff value (not treble/bass, e.g. the bank\'s own "grand") falls through to hand', () => {
      const abc = instanceToAbc({
        ...base,
        staff: 'grand',
        events: [{ notes: [{ midi: 60, hand: 'left' }] }],
      });

      expect(abc).toContain('V:MAIN clef=bass');
    });

    it('with no staff declared, hand wins over a contradicting pitch majority', () => {
      // Left hand playing in the treble register: pitch majority alone would
      // say treble, but the hand says bass, and hand must win when staff is
      // silent.
      const abc = instanceToAbc({
        ...base,
        events: [
          { notes: [{ midi: 72, hand: 'left' }] },
          { notes: [{ midi: 76, hand: 'left' }] },
        ],
      });

      expect(abc).toContain('V:MAIN clef=bass');
    });
  });

  describe('mixed hand-tagged and hand-less notes', () => {
    it('a hand-less note inside hand-tagged material lands on exactly one staff, by its own pitch register', () => {
      // Three events: right hand high, a hand-less LOW note (must land left,
      // pitch < middle C), right hand high again. Neither dropped (silence)
      // nor duplicated onto both staves (the old bug) is acceptable — every
      // note the child must play has to appear exactly once.
      const right1 = { midi: 60, hand: 'right' };
      const middle = { midi: 48 }; // hand-less, below middle C -> left
      const right2 = { midi: 67, hand: 'right' };
      const abc = instanceToAbc({
        ...base,
        events: [{ notes: [right1] }, { notes: [middle] }, { notes: [right2] }],
      });

      const rh = abc.match(/^\[V:RH\] (.*) \|\]$/m)?.[1];
      const lh = abc.match(/^\[V:LH\] (.*) \|\]$/m)?.[1];
      expect(rh).toBe(`${midiToAbc(60, 'C')} x ${midiToAbc(67, 'C')}`);
      expect(lh).toBe(`x ${midiToAbc(48, 'C')} x`);
      // Every one of the three input notes appears exactly once across both staves.
      for (const midi of [60, 48, 67]) {
        const token = midiToAbc(midi, 'C');
        const occurrences = (rh.split(' ').includes(token) ? 1 : 0) + (lh.split(' ').includes(token) ? 1 : 0);
        expect(occurrences).toBe(1);
      }
    });

    it('a hand-less note that falls on the same side as every hand-tagged note keeps the instance single-voice', () => {
      const abc = instanceToAbc({
        ...base,
        events: [
          { notes: [{ midi: 60, hand: 'right' }] },
          { notes: [{ midi: 64 }] }, // hand-less, at/above middle C -> right
        ],
      });

      expect(abc.match(/^V:.*/gm)).toEqual(['V:MAIN clef=treble']);
      expect(abc).not.toContain('V:LH');
    });
  });
});
