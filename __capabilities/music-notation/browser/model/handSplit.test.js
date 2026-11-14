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
