import { describe, it, expect } from 'vitest';
import { findPauses, snapCut } from './pauses.js';

const RATE = 1000; // 1 sample per ms keeps the arithmetic readable
/** Build a signal from [ms, loud?] runs. */
const signal = (...runs) => {
  const out = [];
  for (const [ms, loud] of runs) for (let i = 0; i < ms; i += 1) out.push(loud ? (i % 2 ? 0.5 : -0.5) : 0);
  return Float32Array.from(out);
};

describe('findPauses', () => {
  it('returns the midpoint of a silence between two stretches of speech', () => {
    expect(findPauses(signal([1000, true], [200, false], [800, true]), RATE)).toEqual([1100]);
  });

  it('ignores leading and trailing silence — only a pause INSIDE the sentence can be a cut', () => {
    expect(findPauses(signal([300, false], [1000, true], [400, false]), RATE)).toEqual([]);
  });

  it('ignores a gap shorter than a pause (a stop consonant, not a phrase break)', () => {
    expect(findPauses(signal([1000, true], [60, false], [800, true]), RATE)).toEqual([]);
  });
});

describe('snapCut', () => {
  it('moves a late press back to the pause the learner meant', () => {
    expect(snapCut(1350, [1100])).toBe(1100);
  });

  it('keeps the raw point when no pause is within reach', () => {
    expect(snapCut(1800, [1100])).toBe(1800);
  });

  it('never snaps forward — the learner has not heard what comes after the press', () => {
    expect(snapCut(1000, [1100])).toBe(1000);
  });

  it('takes the latest pause in reach', () => {
    expect(snapCut(1400, [1000, 1300])).toBe(1300);
  });
});
