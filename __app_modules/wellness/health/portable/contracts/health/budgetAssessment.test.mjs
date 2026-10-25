import { describe, it, expect } from 'vitest';
import { assessBudgetDay } from './budgetAssessment.mjs';

const past = { date: '2026-10-24', today: '2026-10-25' };
const live = { date: '2026-10-25', today: '2026-10-25' };
const day = (food, exercise = 0, extra = {}) => ({ food, exercise, maintenance: 2000,
  range: { floor: 1200, top: 1600 }, macros: { protein: 90 }, ...extra });

describe('assessBudgetDay', () => {
  it('credits exercise once on the food scale without confusing the floor with surplus', () => {
    expect(assessBudgetDay(day(1704, 997), past)).toEqual({
      date: past.date, availability: 'available', finished: true, trustworthy: true,
      proteinKnown: true, goalBasis: null, food: 1704, exercise: 997, net: 707,
      floorFood: 1200, basePlan: 1600, planFood: 2597, breakEvenFood: 2997,
      planState: 'within', energyState: 'below-maintenance', overPlanKcal: 0, surplusKcal: 0,
    });
  });

  it.each([
    [1300, 'within', 'below-maintenance', 0, 0],
    [1600, 'within', 'below-maintenance', 0, 0],
    [1800, 'over', 'below-maintenance', 200, 0],
    [2000, 'over', 'at-maintenance', 400, 0],
    [2100, 'over', 'surplus', 500, 100],
  ])('%i food distinguishes plan and maintenance with strict boundaries', (food, planState, energyState, overPlanKcal, surplusKcal) => {
    expect(assessBudgetDay(day(food), past)).toMatchObject({ planState, energyState, overPlanKcal, surplusKcal });
  });

  it('a past date finishes a partial log without making its intake trustworthy', () => {
    expect(assessBudgetDay(day(330, 300), past)).toMatchObject({
      finished: true, trustworthy: false, food: 330, net: 30, floorFood: 1200,
      planFood: 1900, breakEvenFood: 2300, planState: 'unknown', energyState: 'unknown',
      overPlanKcal: null, surplusKcal: null,
    });
  });

  it('never interprets an incomplete log as surplus even when above a low maintenance', () => {
    expect(assessBudgetDay(day(1000, 0, { maintenance: 900 }), past)).toMatchObject({
      trustworthy: false, planState: 'unknown', energyState: 'unknown', surplusKcal: null,
    });
  });

  it('keeps complete current-day arithmetic separate from being finished', () => {
    expect(assessBudgetDay(day(1800), live)).toMatchObject({
      finished: false, trustworthy: true, planState: 'over', energyState: 'below-maintenance',
    });
  });

  it('a declared fast finishes and trusts a day, without inventing measured protein', () => {
    expect(assessBudgetDay(day(0, 0, { declared: 'fasting', macros: {} }), live)).toMatchObject({
      finished: true, trustworthy: true, proteinKnown: false, planState: 'within', energyState: 'below-maintenance',
    });
  });

  it('declared done finishes an under-floor log', () => {
    expect(assessBudgetDay(day(330, 0, { declared: 'done' }), live)).toMatchObject({ finished: true, trustworthy: true });
  });

  it('a skipped meal trusts the log but does not finish today', () => {
    expect(assessBudgetDay(day(330, 0, { fastedMeals: ['morning'] }), live)).toMatchObject({ finished: false, trustworthy: true });
  });

  it('reconstructed calories retain energy evidence but never claim known protein', () => {
    expect(assessBudgetDay(day(1704, 997), { ...past, provenance: 'reconstructed' })).toMatchObject({
      proteinKnown: false, planState: 'within', energyState: 'below-maintenance',
    });
  });

  it.each([undefined, null, NaN, Infinity, '90'])('protein value %s is not a measured finite macro', (protein) => {
    expect(assessBudgetDay(day(1300, 0, { macros: { protein } }), past).proteinKnown).toBe(false);
  });

  it('measured zero protein is known', () => {
    expect(assessBudgetDay(day(1300, 0, { macros: { protein: 0 } }), past).proteinKnown).toBe(true);
  });

  it.each([null, undefined, { error: 'NO_WEIGHT_DATA' }, new Error('unavailable')])('a missing/error budget is unavailable without fabricated facts: %s', (budget) => {
    expect(assessBudgetDay(budget, past)).toEqual({
      date: past.date, availability: 'unavailable', finished: true, trustworthy: false,
      proteinKnown: false, goalBasis: null, food: null, exercise: null, net: null,
      floorFood: null, basePlan: null, planFood: null, breakEvenFood: null,
      planState: 'unknown', energyState: 'unknown', overPlanKcal: null, surplusKcal: null,
    });
  });

  it.each([undefined, null, 0, NaN])('missing maintenance %s leaves known plan boundaries and energy unknown', (maintenance) => {
    expect(assessBudgetDay(day(1800, 0, { maintenance }), past)).toMatchObject({
      food: 1800, exercise: 0, net: 1800, floorFood: 1200, basePlan: 1600, planFood: 1600,
      breakEvenFood: null, planState: 'over', overPlanKcal: 200, energyState: 'unknown', surplusKcal: null,
    });
  });

  it('missing exercise is unknown rather than zero or an inferred overrun', () => {
    expect(assessBudgetDay(day(2100, undefined, { exercise: null }), past)).toMatchObject({
      food: 2100, exercise: null, net: null, floorFood: 1200, basePlan: 1600,
      planFood: null, breakEvenFood: null, planState: 'unknown', energyState: 'unknown', surplusKcal: null,
    });
  });

  it('missing food and range do not become zero intake and a trustworthy zero floor', () => {
    expect(assessBudgetDay({ exercise: 0, maintenance: 2000 }, past)).toMatchObject({
      food: null, floorFood: null, basePlan: null, planFood: null, trustworthy: false,
      planState: 'unknown', energyState: 'unknown',
    });
  });

  it('caps the plan consistently with the existing food-scale boundaries', () => {
    expect(assessBudgetDay(day(1300, 300, { maintenance: 1100, range: { floor: 1200, top: 1200 } }), past)).toMatchObject({
      basePlan: 1200, planFood: 1400, breakEvenFood: 1400, planState: 'within', energyState: 'below-maintenance',
    });
  });

  it('retains the explicitly supplied goal basis without inventing historical goals', () => {
    expect(assessBudgetDay(day(1300, 0, { goalBasis: 'current' }), past).goalBasis).toBe('current');
    expect(assessBudgetDay(day(1300), past).goalBasis).toBeNull();
  });

  it('has no implicit clock or date fallback', () => {
    expect(assessBudgetDay(day(1300), {}).finished).toBe(false);
  });
});
