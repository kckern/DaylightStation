import { describe, it, expect } from 'vitest';
import { priceLadder, priceOf } from './budgetTiers.mjs';
import { zoneFor } from './budgetZone.mjs';

const range = { floor: 1200, top: 1791 };
const day = (food, exercise = 311, over = {}) => ({ food, exercise, maintenance: 2291, range, ...over });
const lefts = (l) => Object.fromEntries(l.tiers.map(t => [t.key, t.left]));

describe('priceLadder — the food-scale lines', () => {
  it('the 2026-09-25 day: top 1791, ceiling 2102, break even 2602', () => {
    expect(priceLadder(day(1470)).lines).toEqual({ food: 1470, exercise: 311, floor: 1200, top: 1791, ceiling: 2102, even: 2602, capped: false });
  });

  it('no maintenance: no break even', () => {
    expect(priceLadder(day(1470, 311, { maintenance: 0 })).lines.even).toBeNull();
  });

  it('a floor above maintenance caps the plan at break even, and says so', () => {
    const l = priceLadder({ food: 1000, exercise: 0, maintenance: 1100, range: { floor: 1200, top: 1200 } });
    expect(l.lines).toMatchObject({ top: 1100, ceiling: 1100, even: 1100, capped: true });
    expect(l.tiers.map(t => t.key)).toEqual(['free']);
  });

  it('missing or negative inputs read as 0', () => {
    expect(priceLadder({ food: null, exercise: -50, maintenance: 2291, range }).lines).toMatchObject({ food: 0, exercise: 0 });
  });
});

describe('priceLadder — tiers left', () => {
  it('in the free tier: 321 free, 311 workout, 500 deficit', () => {
    const l = priceLadder(day(1470));
    expect(l.spend).toBe('free');
    expect(lefts(l)).toEqual({ free: 321, workout: 311, deficit: 500 });
  });

  it('eating into the workout: free is gone, 109 of 311 used', () => {
    const l = priceLadder(day(1900));
    expect(l.spend).toBe('workout');
    expect(lefts(l)).toEqual({ free: 0, workout: 202, deficit: 500 });
    expect(l.tiers.find(t => t.key === 'workout').used).toBe(109);
  });

  it('over plan: 198 over, 302 to break even', () => {
    const l = priceLadder(day(2300));
    expect(l).toMatchObject({ spend: 'over', over: 198, gain: 0 });
    expect(lefts(l).deficit).toBe(302);
  });

  it('past break even: 198 gained, 698 over plan, nothing left', () => {
    const l = priceLadder(day(2800));
    expect(l).toMatchObject({ spend: 'gain', over: 698, gain: 198 });
    expect(Object.values(lefts(l))).toEqual([0, 0, 0]);
  });

  it('no exercise: no workout tier, the ceiling is the top', () => {
    const l = priceLadder(day(1470, 0));
    expect(l.tiers.map(t => t.key)).toEqual(['free', 'deficit']);
    expect(l.lines.ceiling).toBe(1791);
  });

  it('no maintenance: no deficit tier; past the ceiling is "over", never "gain"', () => {
    const l = priceLadder(day(2300, 311, { maintenance: 0 }));
    expect(l.tiers.map(t => t.key)).toEqual(['free', 'workout']);
    expect(l.spend).toBe('over');
  });
});

describe('priceLadder — agrees with the server zone rule', () => {
  const family = { free: ['incomplete', 'declared', 'in-range'], workout: ['in-range'], over: ['over'], gain: ['past-even'] };
  for (const exercise of [0, 311, 1600]) {
    it(`every food 0–4000 with ${exercise} burned lands in the zone family zoneFor picks`, () => {
      for (let food = 0; food <= 4000; food += 1) {
        const { spend } = priceLadder(day(food, exercise));
        const { zone } = zoneFor({ food, exercise, maintenance: 2291, range });
        expect(family[spend], `food ${food}`).toContain(zone);
      }
    });
  }

  it('the capped case (floor above maintenance) agrees too', () => {
    const capped = { floor: 1200, top: 1200 };
    for (let food = 0; food <= 2000; food += 1) {
      const { spend } = priceLadder({ food, exercise: 0, maintenance: 1100, range: capped });
      const { zone } = zoneFor({ food, exercise: 0, maintenance: 1100, range: capped });
      expect(family[spend], `food ${food}`).toContain(zone);
    }
  });
});

describe('priceOf — a portion split across the tiers it lands in', () => {
  it('200 kcal on the 2026-09-25 day is all free', () => {
    expect(priceOf(day(1470), 200)).toEqual([{ key: 'free', kcal: 200 }]);
  });

  it('430 kcal spends the free tier, then 109 of the workout', () => {
    expect(priceOf(day(1470), 430)).toEqual([{ key: 'free', kcal: 321 }, { key: 'workout', kcal: 109 }]);
  });

  it('1,500 kcal runs through every tier into a gain', () => {
    expect(priceOf(day(1470), 1500)).toEqual([
      { key: 'free', kcal: 321 }, { key: 'workout', kcal: 311 }, { key: 'deficit', kcal: 500 }, { key: 'gain', kcal: 368 },
    ]);
  });

  it('no maintenance: past the ceiling is "over", not "gain"', () => {
    expect(priceOf(day(1470, 311, { maintenance: 0 }), 1000).at(-1)).toEqual({ key: 'over', kcal: 368 });
  });

  it('nothing added costs nothing', () => {
    expect(priceOf(day(1470), 0)).toEqual([]);
    expect(priceOf(day(1470), -200)).toEqual([]);
  });
});
