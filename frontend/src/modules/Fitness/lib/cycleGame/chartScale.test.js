import { describe, it, expect } from 'vitest';
import { gapFrac } from './chartScale.js';

describe('gapFrac (leader-anchored log scale)', () => {
  it('pins the leader at the top (frac = 1) and trailing rider at the bottom (frac = 0)', () => {
    expect(gapFrac(1500, 1500, 1000)).toBeCloseTo(1, 5);
    expect(gapFrac(1000, 1500, 1000)).toBeCloseTo(0, 5);
  });
  it('separates two near-leaders 3 m apart far more than a linear window would', () => {
    const leader = 1500, trail = 1000, k = 4;
    const sep = gapFrac(1500, leader, trail, k) - gapFrac(1497, leader, trail, k);
    expect(sep).toBeGreaterThan(0.05);
  });
  it('compresses the back: an equal 3 m gap far behind maps to less separation than at the front', () => {
    const leader = 1500, trail = 1000, k = 4;
    const front = gapFrac(1500, leader, trail, k) - gapFrac(1497, leader, trail, k);
    const back = gapFrac(1100, leader, trail, k) - gapFrac(1097, leader, trail, k);
    expect(front).toBeGreaterThan(back);
  });
  it('is monotonic and clamped to [0,1] (no NaN when all riders are tied)', () => {
    expect(gapFrac(1200, 1200, 1200)).toBeCloseTo(1, 5);
    expect(gapFrac(0, 1500, 1000)).toBeGreaterThanOrEqual(0);
    expect(gapFrac(0, 1500, 1000)).toBeLessThanOrEqual(1);
  });
});
