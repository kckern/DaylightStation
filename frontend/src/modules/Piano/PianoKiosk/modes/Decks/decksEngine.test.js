import { describe, it, expect } from 'vitest';
import { barDuration, nextBoundary } from './decksEngine.js';

describe('barDuration', () => {
  it('is 2s for one 4/4 bar at 120 BPM', () => {
    expect(barDuration(120, 1)).toBeCloseTo(2);
  });
  it('scales with bars and tempo', () => {
    expect(barDuration(120, 2)).toBeCloseTo(4);
    expect(barDuration(60, 1)).toBeCloseTo(4);
  });
  it('guards bad tempo', () => {
    expect(barDuration(0)).toBe(0);
  });
});

describe('nextBoundary', () => {
  const origin = 10, bar = 2;
  it('returns the next bar boundary after now', () => {
    expect(nextBoundary(10, origin, bar)).toBeCloseTo(10); // exactly on origin
    expect(nextBoundary(10.5, origin, bar)).toBeCloseTo(12);
    expect(nextBoundary(13, origin, bar)).toBeCloseTo(14);
  });
  it('does not re-quantise when already on a boundary', () => {
    expect(nextBoundary(12, origin, bar)).toBeCloseTo(12);
  });
  it('clamps to now for a bad bar length', () => {
    expect(nextBoundary(5, origin, 0)).toBe(5);
  });
});
