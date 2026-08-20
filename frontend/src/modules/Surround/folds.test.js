import { describe, it, expect } from 'vitest';
import { foldedShares, FOLD_SHARE, FOLD_SHARE_CAP } from './band.js';

const sum = (a) => a.reduce((n, x) => n + x, 0);
const seg = (duration, collapsed = false) => ({ duration, collapsed });

describe('foldedShares', () => {
  it('is plain proportion when nothing is folded', () => {
    const s = foldedShares([seg(1), seg(3)]);
    expect(s).toEqual([0.25, 0.75]);
  });

  it('gives every fold the same minimal placeholder share', () => {
    const s = foldedShares([seg(100, true), seg(10), seg(100, true)]);
    expect(s[0]).toBeCloseTo(FOLD_SHARE, 6);
    expect(s[2]).toBeCloseTo(FOLD_SHARE, 6);
  });

  it('gives the sounding Part everything the folds gave up', () => {
    // Part Two is 10s of 210s — under 5% of the clock — yet it must take the
    // rail. THIS is the whole point: proportion is deliberately broken.
    const s = foldedShares([seg(100, true), seg(10), seg(100, true)]);
    expect(s[1]).toBeCloseTo(1 - 2 * FOLD_SHARE, 6);
    expect(s[1]).toBeGreaterThan(0.85);
  });

  it('always sums to exactly one rail', () => {
    for (const list of [
      [seg(100, true), seg(5), seg(5), seg(100, true)],
      [seg(1, true), seg(2)],
      [seg(3), seg(4), seg(5)],
    ]) expect(sum(foldedShares(list))).toBeCloseTo(1, 9);
  });

  it('splits the remainder among the drawn segments by their own durations', () => {
    const s = foldedShares([seg(50, true), seg(1), seg(3)]);
    const rest = 1 - FOLD_SHARE;
    expect(s[1]).toBeCloseTo(rest * 0.25, 6);
    expect(s[2]).toBeCloseTo(rest * 0.75, 6);
  });

  it('caps what the folds may take, so many folds cannot crowd out the music', () => {
    const many = Array.from({ length: 20 }, () => seg(10, true)).concat([seg(10)]);
    const s = foldedShares(many);
    expect(sum(s.slice(0, 20))).toBeCloseTo(FOLD_SHARE_CAP, 6);
    expect(s[20]).toBeCloseTo(1 - FOLD_SHARE_CAP, 6);
  });

  it('shares the rail evenly among folds when nothing else is drawn', () => {
    const s = foldedShares([seg(10, true), seg(30, true)]);
    expect(s).toEqual([0.5, 0.5]);
  });

  it('ignores a zero-duration segment rather than handing it a share', () => {
    const s = foldedShares([seg(0), seg(4)]);
    expect(s[0]).toBe(0);
    expect(s[1]).toBeCloseTo(1, 9);
  });

  it('survives an empty rail', () => {
    expect(foldedShares([])).toEqual([]);
  });
});
