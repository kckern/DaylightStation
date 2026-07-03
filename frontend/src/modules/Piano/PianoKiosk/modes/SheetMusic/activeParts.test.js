import { describe, it, expect } from 'vitest';
import { staffLabels, defaultActiveParts, expectedMidisAtStep, isStepSatisfied } from './activeParts.js';

// notes: flat list from extractLayout, each { midi, staff, onsetQuarter }
const NOTES = [
  { midi: 60, staff: 0, onsetQuarter: 0 }, // RH
  { midi: 48, staff: 1, onsetQuarter: 0 }, // LH (same onset)
  { midi: 64, staff: 0, onsetQuarter: 1 },
];
// steps: one per onset, carrying its onsetQuarter and the midis at it (all staves)
const STEPS = [
  { onsetQuarter: 0, notes: [{ midi: 60, staff: 0 }, { midi: 48, staff: 1 }] },
  { onsetQuarter: 1, notes: [{ midi: 64, staff: 0 }] },
];

describe('activeParts', () => {
  it('labels staves RH/LH/P3…', () => {
    expect(staffLabels([0, 1, 2])).toEqual(['RH', 'LH', 'P3']);
  });

  it('defaults every staff to active (full hand)', () => {
    expect(defaultActiveParts(NOTES)).toEqual({ 0: true, 1: true });
  });

  it('expectedMidisAtStep filters to active staves', () => {
    expect(expectedMidisAtStep(STEPS[0], { 0: true, 1: true })).toEqual(new Set([60, 48]));
    expect(expectedMidisAtStep(STEPS[0], { 0: true, 1: false })).toEqual(new Set([60]));
  });

  it('isStepSatisfied requires ALL active-staff midis struck (all-notes rule)', () => {
    const need = new Set([60, 48]);
    expect(isStepSatisfied(need, new Set([60]))).toBe(false);
    expect(isStepSatisfied(need, new Set([60, 48]))).toBe(true);
    expect(isStepSatisfied(need, new Set([60, 48, 72]))).toBe(true); // extra ok
  });
});
