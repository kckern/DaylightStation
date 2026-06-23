import { describe, it, expect } from 'vitest';
import { splitByHand, getOttavaInfo } from './handSplit.js';

describe('splitByHand', () => {
  it('returns empty for no notes', () => {
    expect(splitByHand([])).toEqual({ bassNotes: [], trebleNotes: [] });
  });
  it('single note splits at C4', () => {
    expect(splitByHand([60])).toEqual({ bassNotes: [], trebleNotes: [60] });
    expect(splitByHand([59])).toEqual({ bassNotes: [59], trebleNotes: [] });
  });
  it('two notes an octave apart are a bass pattern', () => {
    expect(splitByHand([48, 60])).toEqual({ bassNotes: [48, 60], trebleNotes: [] });
  });
  it('two notes a fifth apart are a bass pattern', () => {
    expect(splitByHand([48, 55])).toEqual({ bassNotes: [48, 55], trebleNotes: [] });
  });
  it('three+ notes with bass octave split off the lowest two', () => {
    expect(splitByHand([36, 48, 64, 67])).toEqual({
      bassNotes: [36, 48],
      trebleNotes: [64, 67],
    });
  });
  it('splits at the largest significant gap', () => {
    // 40,41 cluster then big gap to 64,65 — split at the gap.
    expect(splitByHand([40, 41, 64, 65])).toEqual({
      bassNotes: [40, 41],
      trebleNotes: [64, 65],
    });
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
