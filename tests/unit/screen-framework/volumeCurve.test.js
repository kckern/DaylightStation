import { describe, it, expect } from 'vitest';
import { volumeCurve } from '../../../frontend/src/screen-framework/providers/volumeCurve.js';

// The office knee: slider 0.5 → gain 0.1. Bottom half scales 0→0.1, top half 0.1→1.
const KNEE = [{ in: 0, out: 0 }, { in: 0.5, out: 0.1 }, { in: 1, out: 1 }];

describe('volumeCurve', () => {
  it('passes through linearly when no curve is given', () => {
    expect(volumeCurve(0, null)).toBe(0);
    expect(volumeCurve(0.37, null)).toBeCloseTo(0.37, 5);
    expect(volumeCurve(1, [])).toBe(1);
  });

  it('hits the control points exactly', () => {
    expect(volumeCurve(0, KNEE)).toBeCloseTo(0, 5);
    expect(volumeCurve(0.5, KNEE)).toBeCloseTo(0.1, 5);
    expect(volumeCurve(1, KNEE)).toBeCloseTo(1, 5);
  });

  it('interpolates the lower segment between 0 and the knee (0→0.1)', () => {
    expect(volumeCurve(0.1, KNEE)).toBeCloseTo(0.02, 5);
    expect(volumeCurve(0.25, KNEE)).toBeCloseTo(0.05, 5);
    expect(volumeCurve(0.4, KNEE)).toBeCloseTo(0.08, 5);
  });

  it('interpolates the upper segment between the knee and 1 (0.1→1)', () => {
    expect(volumeCurve(0.6, KNEE)).toBeCloseTo(0.28, 5);
    expect(volumeCurve(0.75, KNEE)).toBeCloseTo(0.55, 5);
    expect(volumeCurve(0.9, KNEE)).toBeCloseTo(0.82, 5);
  });

  it('clamps out-of-range input to the end control points', () => {
    expect(volumeCurve(-1, KNEE)).toBeCloseTo(0, 5);
    expect(volumeCurve(2, KNEE)).toBeCloseTo(1, 5);
  });

  it('sorts unordered control points before interpolating', () => {
    const unsorted = [{ in: 1, out: 1 }, { in: 0, out: 0 }, { in: 0.5, out: 0.1 }];
    expect(volumeCurve(0.5, unsorted)).toBeCloseTo(0.1, 5);
    expect(volumeCurve(0.25, unsorted)).toBeCloseTo(0.05, 5);
  });

  it('clamps curve output that would exceed [0,1]', () => {
    const hot = [{ in: 0, out: 0 }, { in: 1, out: 5 }];
    expect(volumeCurve(1, hot)).toBe(1);
  });
});
