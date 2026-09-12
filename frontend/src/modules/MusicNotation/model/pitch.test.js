import { describe, it, expect } from 'vitest';
import {
  isBlackKey,
  spellAccidental,
  getStaffPosition,
  getStaffPositionOnClef,
  DEFAULT_BLACK_KEY_SPELLING,
  WHITE_KEYS,
} from './pitch.js';
import { spellPitchClass } from './spelling.js';

describe('isBlackKey', () => {
  it('identifies white keys', () => {
    for (const pc of WHITE_KEYS) expect(isBlackKey(60 + pc)).toBe(false);
  });
  it('identifies black keys', () => {
    for (const pc of [1, 3, 6, 8, 10]) expect(isBlackKey(60 + pc)).toBe(true);
  });
});

describe('spellAccidental', () => {
  it('white keys are neither sharp nor flat', () => {
    expect(spellAccidental(60)).toEqual({ isSharp: false, isFlat: false });
  });
  it('honors forced sharp/flat for black keys', () => {
    expect(spellAccidental(61, 'sharp')).toEqual({ isSharp: true, isFlat: false });
    expect(spellAccidental(61, 'flat')).toEqual({ isSharp: false, isFlat: true });
  });

  // This used to be `Math.random() < 0.5`. Because the spelling decides the
  // staff POSITION downstream, a coin flip moved the same note a diatonic step
  // between renders: a piano-chess rim card the child could not recognise
  // twice, and one note of a dyad coming out flat while its partner came out
  // sharp. Determinism here is not tidiness, it is the whole point.
  it('spells a black key the same way every single time', () => {
    for (const pc of [1, 3, 6, 8, 10]) {
      const first = spellAccidental(60 + pc);
      for (let i = 0; i < 100; i += 1) expect(spellAccidental(60 + pc)).toEqual(first);
    }
  });

  it('gives a black key a stable staff position across repeated calls', () => {
    for (const midi of [51, 58, 61, 66, 70]) {
      const first = getStaffPosition(midi);
      for (let i = 0; i < 100; i += 1) {
        const again = getStaffPosition(midi);
        expect(again.position).toBe(first.position);
        expect(again.isSharp).toBe(first.isSharp);
        expect(again.isFlat).toBe(first.isFlat);
      }
    }
  });

  // model/spelling.js is the authority on which way each chromatic degree
  // leans; the table here is its no-key reduction, duplicated only because it
  // is read once per notehead per render. If the two ever disagree, a card and
  // a chord symbol for the same note will disagree too.
  it('the default lean matches spelling.js read in C', () => {
    for (const pc of [1, 3, 6, 8, 10]) {
      const houseLean = spellPitchClass(pc).alter === 1 ? 'sharp' : 'flat';
      expect(DEFAULT_BLACK_KEY_SPELLING[pc]).toBe(houseLean);
    }
  });
});

describe('getStaffPosition', () => {
  it('places middle C one ledger below the treble bottom line', () => {
    const { position, clef } = getStaffPosition(60);
    expect(clef).toBe('treble');
    expect(position).toBe(-2);
  });
  it('places E4 on the treble bottom line', () => {
    expect(getStaffPosition(64)).toMatchObject({ position: 0, clef: 'treble' });
  });
  it('places F5 on the treble top line', () => {
    expect(getStaffPosition(77)).toMatchObject({ position: 8, clef: 'treble' });
  });
  it('places G2 on the bass bottom line', () => {
    expect(getStaffPosition(43)).toMatchObject({ position: 0, clef: 'bass' });
  });
  it('spells a black key as sharp from the natural below', () => {
    // C#4 spelled sharp shares C4 position, flagged sharp.
    expect(getStaffPosition(61, 'sharp')).toMatchObject({ position: -2, isSharp: true });
  });
  it('spells a black key as flat from the natural above', () => {
    // C#4 spelled flat (Db4) sits a step up from C4, flagged flat.
    expect(getStaffPosition(61, 'flat')).toMatchObject({ position: -1, isFlat: true });
  });
});

describe('getStaffPositionOnClef', () => {
  it('reads middle C on the bass staff, ten steps above its bottom line', () => {
    // Same pitch, different staff: getStaffPosition alone would answer -2 for
    // both, which is the treble answer written on a bass staff.
    expect(getStaffPositionOnClef(60, 'bass')).toMatchObject({ position: 10, clef: 'bass' });
    expect(getStaffPositionOnClef(60, 'treble')).toMatchObject({ position: -2, clef: 'treble' });
  });
  it('reads a low bass note on the treble staff, far below it', () => {
    // G2 is the bass bottom line; on a treble staff it sits twelve steps under.
    expect(getStaffPositionOnClef(43, 'treble')).toMatchObject({ position: -12, clef: 'treble' });
  });
  it('accepts the pitch\'s own clef when none is given', () => {
    expect(getStaffPositionOnClef(43)).toEqual(getStaffPosition(43));
  });
  it('carries the spelling through unchanged', () => {
    expect(getStaffPositionOnClef(61, 'bass', 'flat')).toMatchObject({ position: 11, isFlat: true });
  });
});
