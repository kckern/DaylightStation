import { describe, it, expect } from 'vitest';
import { midiOfHalfTone, pickMelodyNote } from './osmdRender.js';

const note = ({ halfTone, rest = false, grace = false, tieCont = false, staff = 0 }) => {
  const n = {
    halfTone,
    isRest: () => rest,
    IsGraceNote: grace,
    ParentStaffEntry: { ParentStaff: { idInMusicSheet: staff } },
  };
  n.NoteTie = tieCont ? { StartNote: {} } : null; // StartNote !== n → continuation
  return n;
};

describe('midiOfHalfTone', () => {
  it('maps OSMD halfTone to MIDI (C4: halfTone 48 → midi 60)', () => {
    expect(midiOfHalfTone(48)).toBe(60);
    expect(midiOfHalfTone(57)).toBe(69); // A4
  });
});

describe('pickMelodyNote', () => {
  it('picks the highest non-rest note on the top staff', () => {
    const lo = note({ halfTone: 40 });
    const hi = note({ halfTone: 52 });
    expect(pickMelodyNote([lo, hi])).toBe(hi);
  });

  it('ignores rests, grace notes, tie continuations, and lower staves', () => {
    expect(pickMelodyNote([note({ halfTone: 60, rest: true })])).toBe(null);
    expect(pickMelodyNote([note({ halfTone: 60, grace: true })])).toBe(null);
    expect(pickMelodyNote([note({ halfTone: 60, tieCont: true })])).toBe(null);
    expect(pickMelodyNote([note({ halfTone: 60, staff: 1 })])).toBe(null);
  });

  it('keeps a tie START note (it is a real onset)', () => {
    const n = note({ halfTone: 50 });
    n.NoteTie = { StartNote: n };
    expect(pickMelodyNote([n])).toBe(n);
  });

  it('survives malformed entries and empty input', () => {
    expect(pickMelodyNote(null)).toBe(null);
    expect(pickMelodyNote([null, {}, note({ halfTone: 45 })])?.halfTone).toBe(45);
  });
});
