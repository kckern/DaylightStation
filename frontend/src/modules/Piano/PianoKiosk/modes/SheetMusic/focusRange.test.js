import { describe, it, expect } from 'vitest';
import { rangeSteps, clampStepToRange, nextStepInRange, sectionToRange, homeStep, nudgeRange } from './focusRange.js';

const MEAS = [
  { index: 0, firstStep: 0, lastStep: 1 },
  { index: 1, firstStep: 2, lastStep: 3 },
  { index: 2, firstStep: 4, lastStep: 5 },
];

describe('focusRange', () => {
  it('rangeSteps → [firstStep, lastStep] spanning the measure range', () => {
    expect(rangeSteps(MEAS, { inMeasure: 1, outMeasure: 2 })).toEqual([2, 5]);
  });
  it('clampStepToRange keeps a step inside the range', () => {
    expect(clampStepToRange(0, [2, 5])).toBe(2);
    expect(clampStepToRange(9, [2, 5])).toBe(5);
    expect(clampStepToRange(3, [2, 5])).toBe(3);
  });
  it('nextStepInRange wraps at the out-point', () => {
    expect(nextStepInRange(3, [2, 5])).toBe(4);
    expect(nextStepInRange(5, [2, 5])).toBe(2); // wrap
  });
  it('sectionToRange maps a section (measure numbers) to measure indices', () => {
    expect(sectionToRange({ startMeasure: 3, endMeasure: 4 }, [{ number: 3, index: 1 }, { number: 4, index: 2 }]))
      .toEqual({ inMeasure: 1, outMeasure: 2 });
  });
});

describe('nudgeRange', () => {
  const f = { kind: 'custom', inMeasure: 4, outMeasure: 8 };
  it('moves an edge by delta, returning a custom-kind focus', () => {
    expect(nudgeRange(f, 'in', -1, 20)).toEqual({ kind: 'custom', inMeasure: 3, outMeasure: 8 });
    expect(nudgeRange(f, 'out', +1, 20)).toEqual({ kind: 'custom', inMeasure: 4, outMeasure: 9 });
  });
  it('clamps: in ≥ 0, out ≤ count-1, in ≤ out', () => {
    expect(nudgeRange({ ...f, inMeasure: 0 }, 'in', -1, 20)).toEqual({ ...f, inMeasure: 0 });
    expect(nudgeRange({ ...f, outMeasure: 19 }, 'out', +1, 20)).toEqual({ kind: 'custom', inMeasure: 4, outMeasure: 19 });
    expect(nudgeRange({ kind: 'custom', inMeasure: 5, outMeasure: 5 }, 'in', +1, 20).inMeasure).toBe(5);
  });
  it('a clamped no-op returns the SAME object (identity-stable for React state)', () => {
    const g = { ...f, inMeasure: 0 };
    expect(nudgeRange(g, 'in', -1, 20)).toBe(g);
  });
  it('a section focus becomes custom when nudged (label no longer true)', () => {
    expect(nudgeRange({ kind: 'section', label: 'A', inMeasure: 2, outMeasure: 6 }, 'out', +1, 20)).toEqual({ kind: 'custom', inMeasure: 2, outMeasure: 7 });
  });
  it('null focus is a no-op', () => {
    expect(nudgeRange(null, 'in', 1, 20)).toBeNull();
  });
});

describe('homeStep', () => {
  it('returns the range in-point when a loop is active', () => {
    expect(homeStep([4, 9])).toBe(4);
  });
  it('returns 0 with no loop', () => {
    expect(homeStep(null)).toBe(0);
  });
});
