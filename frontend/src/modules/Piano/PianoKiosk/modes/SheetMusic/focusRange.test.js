import { describe, it, expect } from 'vitest';
import { rangeSteps, clampStepToRange, nextStepInRange, nextPlayableStep, sectionToRange, homeStep } from './focusRange.js';

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

// Steps whose staff mix mirrors real piano writing: a cross-measure tie or a
// left-hand-only onset leaves steps that one hand has nothing to play at.
// staff 0 = RH, staff 1 = LH.
const MIXED = [
  { notes: [{ midi: 67, staff: 0 }, { midi: 60, staff: 1 }] }, // 0 · both hands
  { notes: [{ midi: 60, staff: 1 }] },                          // 1 · LH only
  { notes: [{ midi: 65, staff: 0 }] },                          // 2 · RH only
  { notes: [{ midi: 62, staff: 1 }] },                          // 3 · LH only
];
const RH = { 0: true };
const BOTH = { 0: true, 1: true };

describe('nextPlayableStep', () => {
  it('skips steps the active hands have nothing to play at', () => {
    // RH-only from step 0: step 1 is LH-only (nothing to strike) → land on 2.
    expect(nextPlayableStep(0, { steps: MIXED, activeParts: RH, range: null }))
      .toEqual({ next: 2, wrapped: false });
  });

  it('advances one step when the very next step is playable', () => {
    expect(nextPlayableStep(0, { steps: MIXED, activeParts: BOTH, range: null }))
      .toEqual({ next: 1, wrapped: false });
  });

  it('completes when every remaining step is silent for the active hands', () => {
    // RH-only from step 2: only step 3 remains and it is LH-only.
    expect(nextPlayableStep(2, { steps: MIXED, activeParts: RH, range: null }))
      .toEqual({ complete: true });
  });

  it('wraps past a trailing unplayable step and reports the wrap', () => {
    // Range [0,3], RH-only, from 2: step 3 is LH-only → wrap to 0.
    expect(nextPlayableStep(2, { steps: MIXED, activeParts: RH, range: [0, 3] }))
      .toEqual({ next: 0, wrapped: true });
  });

  it('reports stuck when a range holds nothing the active hands can play', () => {
    expect(nextPlayableStep(3, { steps: MIXED, activeParts: RH, range: [3, 3] }))
      .toEqual({ stuck: true });
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
