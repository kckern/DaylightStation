import { describe, it, expect } from 'vitest';
import { makeSmoothNoise } from './povNoise.js';

describe('makeSmoothNoise', () => {
  it('stays within ~[-1,1] and is deterministic for a seed', () => {
    const n = makeSmoothNoise(42);
    for (let t = 0; t < 30; t += 0.37) {
      expect(n(t)).toBeGreaterThanOrEqual(-1.001);
      expect(n(t)).toBeLessThanOrEqual(1.001);
    }
    expect(makeSmoothNoise(42)(3.3)).toBeCloseTo(makeSmoothNoise(42)(3.3), 10);
  });

  it('is continuous — a tiny dt makes a tiny change (no per-frame jitter)', () => {
    const n = makeSmoothNoise(7);
    for (let t = 1; t < 6; t += 0.5) {
      expect(Math.abs(n(t + 0.001) - n(t))).toBeLessThan(0.01);
    }
  });

  it('different seeds decorrelate', () => {
    const a = makeSmoothNoise(1); const b = makeSmoothNoise(9);
    let maxDiff = 0;
    for (let t = 0; t < 12; t += 0.5) maxDiff = Math.max(maxDiff, Math.abs(a(t) - b(t)));
    expect(maxDiff).toBeGreaterThan(0.3);
  });
});
