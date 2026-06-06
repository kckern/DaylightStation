import { describe, it, expect } from 'vitest';
import { tickFraction } from './tickFraction.js';

describe('tickFraction', () => {
  it('is 0 at the tick instant and 1 a full tick later', () => {
    expect(tickFraction(1000, 1000, 1000)).toBe(0);
    expect(tickFraction(2000, 1000, 1000)).toBe(1);
    expect(tickFraction(1500, 1000, 1000)).toBeCloseTo(0.5, 5);
  });
  it('clamps below 0 and above 1 (a stalled/overdue tick saturates)', () => {
    expect(tickFraction(900, 1000, 1000)).toBe(0);
    expect(tickFraction(5000, 1000, 1000)).toBe(1);
  });
  it('returns 1 for a non-positive interval', () => {
    expect(tickFraction(1234, 1000, 0)).toBe(1);
  });
});
