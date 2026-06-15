import { describe, it, expect } from 'vitest';
import { niceNum, niceTicks } from './chartScale.js';

describe('niceNum', () => {
  it('rounds a range to a friendly magnitude', () => {
    expect(niceNum(433, false)).toBe(500);
    expect(niceNum(96, false)).toBe(100);
  });
});

describe('niceTicks', () => {
  it('produces round human ticks across a coin range', () => {
    expect(niceTicks(0, 433, 5)).toEqual([0, 100, 200, 300, 400, 500]);
  });
  it('never emits the toFixed garbage (172/303/433)', () => {
    const ticks = niceTicks(0, 433, 5);
    expect(ticks).not.toContain(172);
    expect(ticks).not.toContain(303);
  });
  it('handles a tiny range without dividing by zero', () => {
    expect(niceTicks(0, 0, 4)).toEqual([0]);
    expect(Array.isArray(niceTicks(40, 42, 4))).toBe(true);
  });
  it('handles a nonzero start', () => {
    const t = niceTicks(40, 440, 5);
    expect(t[0]).toBeLessThanOrEqual(40);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(440);
    expect(t.every(v => Number.isInteger(v))).toBe(true);
  });
});
