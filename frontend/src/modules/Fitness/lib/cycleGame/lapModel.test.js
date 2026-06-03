import { describe, it, expect } from 'vitest';
import { lapCount, lapProgress } from './lapModel.js';

describe('lapCount', () => {
  it('counts completed full laps', () => {
    expect(lapCount(0, 100)).toBe(0);
    expect(lapCount(99, 100)).toBe(0);
    expect(lapCount(100, 100)).toBe(1);
    expect(lapCount(250, 100)).toBe(2);
  });
  it('returns 0 when laps are disabled (lapLengthM falsy)', () => {
    expect(lapCount(500, 0)).toBe(0);
    expect(lapCount(500, null)).toBe(0);
  });
});

describe('lapProgress', () => {
  it('returns the 0..1 fraction into the current lap', () => {
    expect(lapProgress(0, 100)).toBe(0);
    expect(lapProgress(50, 100)).toBeCloseTo(0.5, 5);
    expect(lapProgress(100, 100)).toBe(0); // exactly on the line = start of next
    expect(lapProgress(150, 100)).toBeCloseTo(0.5, 5);
  });
  it('returns 0 when laps are disabled', () => {
    expect(lapProgress(50, 0)).toBe(0);
  });
});
