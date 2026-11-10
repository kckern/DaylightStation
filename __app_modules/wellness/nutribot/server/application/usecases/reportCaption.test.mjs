import { describe, it, expect } from 'vitest';
import { buildReportCaption } from "./reportCaption.mjs";

const budget = (over = {}) => ({ food: 1257, exercise: 248, maintenance: 2291, range: { floor: 1200, top: 1791 }, zone: 'in-range', remaining: 782, declared: null, ...over });

describe('buildReportCaption', () => {
  it('uses the budget range and names the segment, exactly as the Today bar does', () => {
    expect(buildReportCaption({ totals: { calories: 1250 }, goals: {}, budget: budget() }))
      .toBe('🔥 1257 / 1200–2039 cal • 782 cal left • includes 248 cal exercise adjustment');
  });

  it('an under-logged day says what is left to the ceiling, never "below minimum"', () => {
    expect(buildReportCaption({ totals: { calories: 700 }, budget: budget({ food: 700, zone: 'incomplete', remaining: 1091 }) }))
      .toBe('🔥 700 / 1200–2039 cal • 1339 cal left • includes 248 cal exercise adjustment');
  });

  it('a declared day still states what is left', () => {
    expect(buildReportCaption({ totals: { calories: 300 }, budget: budget({ food: 300, zone: 'declared', declared: 'fasting', remaining: 1491 }) }))
      .toBe('🔥 300 / 1200–2039 cal • 1739 cal left • includes 248 cal exercise adjustment');
  });

  it('over and past break-even', () => {
    expect(buildReportCaption({ totals: {}, budget: budget({ food: 1900, exercise: 0, zone: 'over', remaining: 109 }) })).toMatch(/109 cal over plan$/);
    expect(buildReportCaption({ totals: {}, budget: budget({ food: 2400, exercise: 0, zone: 'past-even', remaining: 109 }) })).toMatch(/109 cal above estimated maintenance$/);
  });

  it('without a budget, reports logged totals with unavailable assessment', () => {
    expect(buildReportCaption({ totals: { calories: 1000 }, goals: { calories_min: 1200, calories_max: 1600 }, budget: null }))
      .toBe('🔥 1000 cal logged • budget assessment unavailable');
  });
});
