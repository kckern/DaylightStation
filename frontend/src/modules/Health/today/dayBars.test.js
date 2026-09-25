import { describe, it, expect } from 'vitest';
import { barModel, barScale, barCellLabel, fmtKcal, OVERSHOOT_CAP } from './dayBars.js';

// jsdom cannot measure a rendered bar, so the number the component SETS is
// what a test can pin — which is the reason this arithmetic is a function.

const day = (over = {}) => ({ date: '2026-09-01', budget: 2000, food: 1000, exercise: 0, remaining: 1000, status: 'under', ...over });

describe('barModel', () => {
  it('a day exactly on budget lands on the reference line (1/cap of the box)', () => {
    const m = barModel(day({ food: 2000 }));
    expect(m.kind).toBe('day');
    expect(m.ratio).toBe(1);
    expect(m.heightPct).toBe(80); // 1 / 1.25
    expect(m.clamped).toBe(false);
  });

  it('scales linearly below budget', () => {
    expect(barModel(day({ food: 1000 })).heightPct).toBe(40);  // 0.5 / 1.25
    expect(barModel(day({ food: 500 })).heightPct).toBe(20);
  });

  it('clamps the PAINT at the overshoot cap but reports the TRUE ratio', () => {
    const m = barModel(day({ food: 2000 * 2, status: 'over' }));
    expect(m.heightPct).toBe(100);          // clamped to the top of the box
    expect(m.ratio).toBe(2);                // the accessible name says 200%
    expect(m.clamped).toBe(true);
    expect(m.status).toBe('over');
  });

  it(`the cap is ${OVERSHOOT_CAP}: a day exactly at the cap fills the box without clamping`, () => {
    const m = barModel(day({ food: 2000 * OVERSHOOT_CAP, status: 'over' }));
    expect(m.heightPct).toBe(100);
    expect(m.clamped).toBe(false);
  });

  // THE honesty rule (PRD F7.1). These two must not produce the same model.
  it('a genuine ZERO day is a day, not a gap', () => {
    const m = barModel(day({ food: 0 }));
    expect(m.kind).toBe('day');
    expect(m.heightPct).toBe(0);
  });

  it('a server gap is a gap and carries NO height at all', () => {
    const m = barModel({ date: '2026-08-30', error: 'NO_WEIGHT_DATA' });
    expect(m.kind).toBe('gap');
    expect(m.heightPct).toBeUndefined();
    expect(barModel(null).kind).toBe('gap');
  });

  it('a nonsense budget is a gap, not a divide-by-zero bar', () => {
    expect(barModel(day({ budget: 0 })).kind).toBe('gap');
    expect(barModel(day({ budget: null })).kind).toBe('gap');
  });

  it('a negative food total cannot push the bar below the floor', () => {
    expect(barModel(day({ food: -500 })).heightPct).toBe(0);
  });
});

// The bar is NET calories against the goal — the same quantity the server's
// status judges — so the sentence names every term the picture used.
describe('barCellLabel', () => {
  const DAY_NAME = 'Friday, July 25';

  it('names eaten, burned, net against goal, break even and outcome as ONE claim', () => {
    const d = day({ budget: 1791, maintenance: 2291, food: 2040, exercise: 530, remaining: 281, status: 'under' });
    expect(barCellLabel(d, barModel(d), DAY_NAME))
      .toBe('Friday, July 25, ate 2040, burned 530, 1510 net of 1791 kcal goal, 84%, break even 2291, 281 kcal left');
  });

  it('says so explicitly when nothing was burned, and leaves break even out when unknown', () => {
    const d = day({ budget: 1791, food: 2040, exercise: 0, remaining: -249, status: 'over' });
    expect(barCellLabel(d, barModel(d), DAY_NAME))
      .toBe('Friday, July 25, ate 2040, no exercise logged, 2040 net of 1791 kcal goal, 114%, 249 kcal over goal');
  });

  it('announces the TRUE percentage even when the paint is clamped', () => {
    const d = day({ budget: 2000, food: 4000, exercise: 0, remaining: -2000, status: 'over' });
    expect(barModel(d).heightPct).toBe(100);
    expect(barCellLabel(d, barModel(d), DAY_NAME)).toMatch(/200%/);
  });

  it('a gap says only that there is no data — never a number', () => {
    const g = { date: '2026-07-25', error: 'NO_WEIGHT_DATA' };
    const label = barCellLabel(g, barModel(g), DAY_NAME);
    expect(label).toBe('Friday, July 25, no data');
    expect(label).not.toMatch(/\d+ kcal/);
  });
});

describe('barModel net, zones and break even', () => {
  it('draws NET calories, so eating past goal and training it off stays under the line', () => {
    // Jul 25 from live data: 2040 eaten, 530 burned — 1510 net of a 1791 goal.
    const m = barModel(day({ budget: 1791, food: 2040, exercise: 530, remaining: 281, status: 'under' }));
    expect(m.net).toBe(1510);
    expect(m.ratio).toBeCloseTo(1510 / 1791, 5);
    expect(m.zone).toBe('under');
  });

  it('past the goal but under break even is the deficit zone; past break even is surplus', () => {
    const at = food => barModel(day({ budget: 2000, maintenance: 2500, food, remaining: 2000 - food, status: food > 2000 ? 'over' : 'under' })).zone;
    expect(at(1900)).toBe('under');
    expect(at(2300)).toBe('deficit');
    expect(at(2600)).toBe('surplus');
    // No break even known: anything past the goal is surplus.
    expect(barModel(day({ food: 2300, status: 'over' })).zone).toBe('surplus');
  });

  it('places the goal and break-even lines in the same box the fill uses', () => {
    const m = barModel(day({ budget: 2000, maintenance: 2500 }), 1.5);
    expect(m.goalPct).toBe(66.7);
    expect(m.breakEvenPct).toBe(83.3);
    expect(barModel(day({ budget: 2000, maintenance: 4000 }), 1.5).breakEvenPct).toBeNull(); // off the top
    expect(barModel(day()).breakEvenPct).toBeNull();
  });

  it('barScale raises the box to fit the highest break even, within bounds', () => {
    expect(barScale([day()])).toBe(OVERSHOOT_CAP);
    expect(barScale([day({ maintenance: 2500 }), day({ maintenance: 2600 })])).toBeCloseTo(1.3 * 1.1, 5);
    expect(barScale([day({ maintenance: 10000 })])).toBe(2);
    expect(barScale([null, { error: 'NO_WEIGHT_DATA' }])).toBe(OVERSHOOT_CAP);
  });
});

describe('fmtKcal', () => {
  it('compacts thousands and dashes the unknown', () => {
    expect(fmtKcal(1234)).toBe('1.2k');
    expect(fmtKcal(940)).toBe('940');
    expect(fmtKcal(0)).toBe('0');
    expect(fmtKcal(null)).toBe('—');
    expect(fmtKcal(undefined)).toBe('—');
  });
});

describe('barCellLabel — names the zone segment', () => {
  it('an under-logged day is "to floor"', () => {
    const d = day({ food: 700, zone: 'incomplete', remaining: 500, status: 'under', range: { floor: 1200, top: 2000 } });
    expect(barCellLabel(d, barModel(d), 'Mon')).toMatch(/500 kcal to floor$/);
  });
  it('a fasted day says Fasted', () => {
    const d = day({ food: 300, zone: 'declared', declared: 'fasting', remaining: 1700, status: 'under', range: { floor: 1200, top: 2000 } });
    expect(barCellLabel(d, barModel(d), 'Mon')).toMatch(/Fasted$/);
  });
});
