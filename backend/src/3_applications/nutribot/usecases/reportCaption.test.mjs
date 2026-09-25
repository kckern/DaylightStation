import { describe, it, expect } from 'vitest';
import { buildReportCaption } from './reportCaption.mjs';

const budget = (over = {}) => ({ food: 1257, range: { floor: 1200, top: 1791 }, zone: 'in-range', remaining: 782, declared: null, ...over });

describe('buildReportCaption', () => {
  it('uses the budget range and names the segment, exactly as the Today bar does', () => {
    expect(buildReportCaption({ totals: { calories: 1250 }, goals: {}, budget: budget() }))
      .toBe('🔥 1257 / 1200–1791 cal • 782 cal left');
  });

  it('an under-logged day is "to floor", never "below minimum"', () => {
    expect(buildReportCaption({ totals: { calories: 700 }, budget: budget({ food: 700, zone: 'incomplete', remaining: 500 }) }))
      .toBe('🔥 700 / 1200–1791 cal • 500 cal to floor');
  });

  it('a declared day says so', () => {
    expect(buildReportCaption({ totals: { calories: 300 }, budget: budget({ food: 300, zone: 'declared', declared: 'fasting', remaining: 1491 }) }))
      .toBe('🔥 300 / 1200–1791 cal • Fasted');
  });

  it('over and past break-even', () => {
    expect(buildReportCaption({ totals: {}, budget: budget({ food: 1900, zone: 'over', remaining: 109 }) })).toMatch(/109 cal over$/);
    expect(buildReportCaption({ totals: {}, budget: budget({ food: 2400, zone: 'past-even', remaining: 109 }) })).toMatch(/109 cal past break even$/);
  });

  it('without a budget, keeps the legacy min/max caption', () => {
    expect(buildReportCaption({ totals: { calories: 1000 }, goals: { calories_min: 1200, calories_max: 1600 }, budget: null }))
      .toBe('🔥 1000 / 1200-1600 cal (63%) • 200 cal below minimum');
  });
});
