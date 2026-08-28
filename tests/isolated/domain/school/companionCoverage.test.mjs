import { describe, it, expect } from 'vitest';
import {
  SATISFACTION_THRESHOLD, mergeRanges, coveredSeconds, coverageFraction, isSatisfied,
} from '#domains/school/companionCoverage.mjs';

describe('mergeRanges', () => {
  it('sorts, merges overlaps, and joins ranges that touch', () => {
    expect(mergeRanges([[10, 20], [0, 5], [15, 30]])).toEqual([[0, 5], [10, 30]]);
    expect(mergeRanges([[0, 10], [10, 20]])).toEqual([[0, 20]]);
  });

  it('drops empty, inverted and unusable entries instead of throwing', () => {
    expect(mergeRanges([[5, 5], [10, 4], null, [1, 2], ['a', 3]])).toEqual([[1, 2]]);
    expect(mergeRanges(null)).toEqual([]);
  });

  it('accumulates across calls so coverage can be banked incrementally', () => {
    const first = mergeRanges([[0, 100]]);
    expect(mergeRanges([...first, [90, 200]])).toEqual([[0, 200]]);
  });
});

describe('coverageFraction', () => {
  it('is covered seconds over duration', () => {
    expect(coveredSeconds([[0, 40], [60, 100]])).toBe(80);
    expect(coverageFraction({ ranges: [[0, 80]], duration: 100 })).toBeCloseTo(0.8);
  });

  it('is zero when the duration is unknown, rather than dividing by nothing', () => {
    expect(coverageFraction({ ranges: [[0, 80]], duration: 0 })).toBe(0);
    expect(coverageFraction({ ranges: [[0, 80]], duration: null })).toBe(0);
  });

  it('never exceeds 1 even if a range runs past the reported duration', () => {
    expect(coverageFraction({ ranges: [[0, 120]], duration: 100 })).toBe(1);
  });
});

describe('isSatisfied', () => {
  const duration = 495;

  it('accepts a play that covered the timeline bar its trailing silence', () => {
    expect(SATISFACTION_THRESHOLD).toBe(0.95);
    expect(isSatisfied({ ranges: [[0, 483]], duration, maxRate: 1 })).toBe(true);
  });

  it('refuses a stream that died five seconds in', () => {
    expect(isSatisfied({ ranges: [[0, 5]], duration, maxRate: 1 })).toBe(false);
  });

  it('refuses full coverage that was played fast', () => {
    expect(isSatisfied({ ranges: [[0, 495]], duration, maxRate: 1.5 })).toBe(false);
  });

  it('treats a missing rate as normal speed, and a slow rate as fine', () => {
    expect(isSatisfied({ ranges: [[0, 495]], duration })).toBe(true);
    expect(isSatisfied({ ranges: [[0, 495]], duration, maxRate: 0.75 })).toBe(true);
  });

  it('refuses an unknown duration rather than passing on no evidence', () => {
    expect(isSatisfied({ ranges: [[0, 495]], duration: 0 })).toBe(false);
  });
});
