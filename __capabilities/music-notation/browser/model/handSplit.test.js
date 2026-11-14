import { describe, it, expect } from 'vitest';
import { splitByHand, getOttavaInfo } from "./handSplit.js";

describe('splitByHand', () => {
  it('returns empty for no notes', () => {
    expect(splitByHand([])).toEqual({ bassNotes: [], trebleNotes: [] });
  });
  it('single note splits at C4', () => {
    expect(splitByHand([60])).toEqual({ bassNotes: [], trebleNotes: [60] });
    expect(splitByHand([59])).toEqual({ bassNotes: [59], trebleNotes: [] });
  });
  it('two notes an octave apart below C4 are one hand on bass', () => {
    expect(splitByHand([48, 60])).toEqual({ bassNotes: [48, 60], trebleNotes: [] });
  });
  it('two notes a fifth apart below C4 stay on bass', () => {
    expect(splitByHand([48, 55])).toEqual({ bassNotes: [48, 55], trebleNotes: [] });
  });
  it('three+ notes with bass octave split at C4', () => {
    expect(splitByHand([36, 48, 64, 67])).toEqual({
      bassNotes: [36, 48],
      trebleNotes: [64, 67],
    });
  });
  it('splits a wide two-hand column at C4', () => {
    expect(splitByHand([40, 41, 64, 65])).toEqual({
      bassNotes: [40, 41],
      trebleNotes: [64, 65],
    });
  });
  it('RH octave C5-C6 stays on treble', () => {
    expect(splitByHand([72, 84])).toEqual({ bassNotes: [], trebleNotes: [72, 84] });
  });
  it('RH rolled C4 E4 G4 C5 stays on treble', () => {
    expect(splitByHand([60, 64, 67, 72])).toEqual({ bassNotes: [], trebleNotes: [60, 64, 67, 72] });
  });
  it('RH fifth E5+B5 stays on treble', () => {
    expect(splitByHand([76, 83])).toEqual({ bassNotes: [], trebleNotes: [76, 83] });
  });
  it('RH C5 G5 C6 stays on treble', () => {
    expect(splitByHand([72, 79, 84])).toEqual({ bassNotes: [], trebleNotes: [72, 79, 84] });
  });
  it('two-hand C3 E3 G3 + C5 E5 splits at C4', () => {
    expect(splitByHand([48, 52, 55, 72, 76])).toEqual({
      bassNotes: [48, 52, 55],
      trebleNotes: [72, 76],
    });
  });
  it('close two-hand C3 E3 G3 + C4 E4 G4 splits at C4', () => {
    expect(splitByHand([48, 52, 55, 60, 64, 67])).toEqual({
      bassNotes: [48, 52, 55],
      trebleNotes: [60, 64, 67],
    });
  });
  it('a left-hand C4 under a high right-hand chord is bass, not a 3-octave treble chord', () => {
    expect(splitByHand([48, 60, 88, 91, 95])).toEqual({
      bassNotes: [48, 60],
      trebleNotes: [88, 91, 95],
    });
  });
  it('a right-hand note below C4 over a deep left hand goes to treble', () => {
    expect(splitByHand([30, 58, 62, 66])).toEqual({
      bassNotes: [30],
      trebleNotes: [58, 62, 66],
    });
  });
  it('a bass pair reaching just over middle C keeps both notes, treble stays inside one reach', () => {
    // k=2 is the only split with both hands within 14 semitones; the C-pivot split left a 7-note treble.
    expect(splitByHand([52, 64, 92, 95, 99])).toEqual({ bassNotes: [52, 64], trebleNotes: [92, 95, 99] });
  });
  it('three-hand cluster [30,60,62,90]: no playable split, least-bad is a lone bass note', () => {
    // Every split overflows. Wrong-side count decides: k=1 [30]|[60,62,90] has 0 wrong-side notes, k=2 and
    // k=3 each have 1-2 (60/62 on bass), so k=1 wins on `wrong` before overflow is consulted.
    // and the smallest overflow (16): the deep note is plainly left hand, the rest is one stretched right.
    expect(splitByHand([30, 60, 62, 90])).toEqual({ bassNotes: [30], trebleNotes: [60, 62, 90] });
  });
  it('[48,60,64,67,72,76]: bass 48 + treble 60..76 is out of reach (16), so the playable 48,60 | 64..76 wins', () => {
    // Two hands each spanning 12 beat one 16-wide hand despite one note (60) on the wrong side of the pivot.
    expect(splitByHand([48, 60, 64, 67, 72, 76])).toEqual({ bassNotes: [48, 60], trebleNotes: [64, 67, 72, 76] });
  });
  it('[60,88,91,95]: wholly at/above C4, so it stays one treble column even at 35 wide', () => {
    // [60]|[88..95] would be playable, but C4 is not evidence of a left hand: the replay gate treats any
    // all-at/above-C4 column reaching the bass as a right-hand-on-bass fault (1933 of them without this).
    expect(splitByHand([60, 88, 91, 95])).toEqual({ bassNotes: [], trebleNotes: [60, 88, 91, 95] });
  });
  it('a >14-wide column wholly below C4 stays whole on bass (no second-hand evidence)', () => {
    expect(splitByHand([36, 48, 55])).toEqual({ bassNotes: [36, 48, 55], trebleNotes: [] });
  });
  it('HAND_SPAN boundary: [60,74] is one hand (treble); [60,75] is wide but still wholly >= C4, so treble', () => {
    expect(splitByHand([60, 74])).toEqual({ bassNotes: [], trebleNotes: [60, 74] });
    expect(splitByHand([60, 75])).toEqual({ bassNotes: [], trebleNotes: [60, 75] });
  });
  it('[50,64] (span 14, mean 57) is one hand on bass', () => {
    expect(splitByHand([50, 64])).toEqual({ bassNotes: [50, 64], trebleNotes: [] });
  });
  it('[59,74] (span 15, straddles C4) is treated as wide and divides', () => {
    expect(splitByHand([59, 74])).toEqual({ bassNotes: [59], trebleNotes: [74] });
  });
  it('wide LH stays bass', () => {
    expect(splitByHand([36, 55])).toEqual({ bassNotes: [36, 55], trebleNotes: [] });
  });
});

describe('getOttavaInfo', () => {
  it('no ottava for empty', () => {
    expect(getOttavaInfo([], true)).toEqual({ octaves: 0, marker: '' });
  });
  it('8va for very high treble', () => {
    expect(getOttavaInfo([96], true)).toEqual({ octaves: 1, marker: '8va' });
  });
  it('15ma for extreme high treble', () => {
    expect(getOttavaInfo([108], true)).toEqual({ octaves: 2, marker: '15ma' });
  });
  it('8vb for very low bass', () => {
    expect(getOttavaInfo([36], false)).toEqual({ octaves: 1, marker: '8vb' });
  });
  it('15mb for extreme low bass', () => {
    expect(getOttavaInfo([24], false)).toEqual({ octaves: 2, marker: '15mb' });
  });
});
