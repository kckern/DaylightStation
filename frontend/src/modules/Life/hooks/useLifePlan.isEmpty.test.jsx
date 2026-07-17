import { describe, it, expect } from 'vitest';
import { planIsEmpty } from './useLifePlan.js';

describe('planIsEmpty', () => {
  it('is empty for null / {} / all-empty sections', () => {
    expect(planIsEmpty(null)).toBe(true);
    expect(planIsEmpty({})).toBe(true);
    expect(planIsEmpty({ goals: [], values: [], beliefs: [], qualities: [] })).toBe(true);
  });
  it('is NOT empty when only a belief exists', () => {
    expect(planIsEmpty({ beliefs: [{ id: 'b1' }] })).toBe(false);
  });
  it('is NOT empty when only a quality exists', () => {
    expect(planIsEmpty({ qualities: [{ id: 'q1' }] })).toBe(false);
  });
});
