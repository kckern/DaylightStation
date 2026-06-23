import { describe, it, expect } from 'vitest';
import { isBlackKey, spellAccidental, getStaffPosition, WHITE_KEYS } from './pitch.js';

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
