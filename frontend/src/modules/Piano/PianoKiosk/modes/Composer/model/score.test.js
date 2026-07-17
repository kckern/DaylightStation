import { describe, it, expect } from 'vitest';
import { makeEmptyScore } from './score.js';

describe('makeEmptyScore', () => {
  it('creates a 4/4 C-major treble score with one empty measure', () => {
    const s = makeEmptyScore();
    expect(s.timeSig).toEqual({ beats: 4, beatType: 4 });
    expect(s.key).toEqual({ fifths: 0, mode: 'major' });
    expect(s.clef).toEqual({ sign: 'G', line: 2 });
    expect(s.tempo).toBe(100);
    expect(s.divisions).toBe(24);
    expect(s.parts).toHaveLength(1);
    expect(s.parts[0].measures).toHaveLength(1);
    expect(s.parts[0].measures[0].notes).toEqual([]);
  });
  it('accepts setup overrides', () => {
    const s = makeEmptyScore({ time: { beats: 3, beatType: 4 }, key: { fifths: 1 }, tempo: 120 });
    expect(s.timeSig.beats).toBe(3);
    expect(s.key.fifths).toBe(1);
    expect(s.tempo).toBe(120);
  });
});
