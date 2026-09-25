import { describe, it, expect } from 'vitest';
import { zoneFor, statusForZone, headlineFor } from './budgetZone.mjs';

const range = { floor: 1200, top: 1791 };
const z = (food, exercise = 0, declared = null) => zoneFor({ food, exercise, maintenance: 2291, range, declared });

describe('zoneFor', () => {
  it('incomplete: under the floor, undeclared; remaining is still what is left to the ceiling', () => {
    expect(z(700)).toEqual({ zone: 'incomplete', remaining: 1091, complete: false, net: 700 });
  });

  it('floor compares FOOD, not net: a big workout does not make a full log incomplete', () => {
    expect(z(1300, 400)).toMatchObject({ zone: 'in-range', complete: true, net: 900, remaining: 891 });
  });

  it('declared: under the floor but closed as done or fasted', () => {
    expect(z(600, 0, 'fasting')).toMatchObject({ zone: 'declared', complete: true, remaining: 1191 });
    expect(z(600, 0, 'done')).toMatchObject({ zone: 'declared', complete: true });
  });

  it('a skipped (fasted) meal makes an under-floor day trustworthy, like a declaration', () => {
    const r = zoneFor({ food: 600, exercise: 0, maintenance: 2291, range, fastedMeals: ['morning'] });
    expect(r).toMatchObject({ zone: 'declared', complete: true, remaining: 1191 });
  });

  it('in-range boundary: food exactly at the floor, net exactly at the top', () => {
    expect(z(1200)).toMatchObject({ zone: 'in-range', remaining: 591 });
    expect(z(1791)).toMatchObject({ zone: 'in-range', remaining: 0 });
  });

  it('over: net past the top, remaining is the overrun', () => {
    expect(z(1900)).toMatchObject({ zone: 'over', remaining: 109, complete: true });
  });

  it('past-even: net past break-even', () => {
    expect(z(2400)).toMatchObject({ zone: 'past-even', remaining: 109 });
  });

  it('past-even still wins on an under-logged day, and completeness stays separate', () => {
    const tiny = zoneFor({ food: 1000, exercise: 0, maintenance: 900, range: { floor: 1200, top: 1200 } });
    expect(tiny).toMatchObject({ zone: 'past-even', complete: false });
  });

  it('negative net with food ≥ floor: in range, remaining exceeds the top, never negative', () => {
    const r = z(1300, 1600);
    expect(r).toMatchObject({ zone: 'in-range', net: -300, remaining: 2091 });
    expect(r.remaining).toBeGreaterThan(range.top);
  });

  it('rounds remaining (the drag preview passes fractional food)', () => {
    expect(z(1500.4).remaining).toBe(291);
  });
});

describe('statusForZone', () => {
  it('maps over and past-even to over, everything else to under', () => {
    expect(['incomplete', 'declared', 'in-range', 'over', 'past-even'].map(statusForZone))
      .toEqual(['under', 'under', 'under', 'over', 'over']);
  });
});

describe('headlineFor', () => {
  it('names the segment the number measures', () => {
    expect(headlineFor({ zone: 'incomplete', remaining: 1091 })).toEqual({ value: 1091, text: 'left' });
    expect(headlineFor({ zone: 'in-range', remaining: 648 })).toEqual({ value: 648, text: 'left' });
    expect(headlineFor({ zone: 'over', remaining: 109 })).toEqual({ value: 109, text: 'over' });
    expect(headlineFor({ zone: 'past-even', remaining: 109 })).toEqual({ value: 109, text: 'past break even' });
    expect(headlineFor({ zone: 'declared', remaining: 1191, declared: 'fasting' })).toEqual({ value: 1191, text: 'left' });
  });
});
