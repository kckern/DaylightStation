import { describe, it, expect } from 'vitest';
import { barModel, barCellLabel, fmtKcal, OVERSHOOT_CAP } from './dayBars.js';

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

// The bar carries TWO denominators on purpose: height is food/budget, hue is
// budget − food + exercise. That is informative, and exercise offset is a
// headline theme — but a sentence asserting "114% of budget" and "under budget"
// with nothing between them contradicts itself. The reconciling term has to be
// IN the sentence.
describe('barCellLabel', () => {
  const DAY_NAME = 'Friday, July 25';

  it('names intake, exercise and outcome as ONE claim when exercise is what reconciles them', () => {
    const d = day({ budget: 1791, food: 2040, exercise: 530, remaining: 281, status: 'under' });
    const label = barCellLabel(d, barModel(d), DAY_NAME);
    expect(label).toBe('Friday, July 25, ate 2040 of 1791 kcal, 114% of budget, with 530 kcal exercise, 281 kcal left');
    // The old sentence said "114% of budget, under budget" and stopped there.
    expect(label).toMatch(/530 kcal exercise/);
    expect(label).not.toMatch(/% of budget, under budget/);
  });

  it('says so explicitly when nothing was burned, rather than leaving the term out', () => {
    const d = day({ budget: 1791, food: 2040, exercise: 0, remaining: -249, status: 'over' });
    expect(barCellLabel(d, barModel(d), DAY_NAME))
      .toBe('Friday, July 25, ate 2040 of 1791 kcal, 114% of budget, with no exercise logged, 249 kcal over budget');
  });

  it('announces the TRUE percentage even when the paint is clamped', () => {
    const d = day({ budget: 2000, food: 4000, exercise: 0, remaining: -2000, status: 'over' });
    expect(barModel(d).heightPct).toBe(100);
    expect(barCellLabel(d, barModel(d), DAY_NAME)).toMatch(/200% of budget/);
  });

  it('a gap says only that there is no data — never a number', () => {
    const g = { date: '2026-07-25', error: 'NO_WEIGHT_DATA' };
    const label = barCellLabel(g, barModel(g), DAY_NAME);
    expect(label).toBe('Friday, July 25, no data');
    expect(label).not.toMatch(/\d+ kcal/);
  });
});

describe('barModel exercise offset', () => {
  it('flags a day that ate past budget and still came in under', () => {
    // Jul 25 from live data: 113.9% of budget, and GREEN, because exercise
    // covered it. Without a flag the cell is a green bar above the reference
    // line, which reads as a bug.
    expect(barModel(day({ budget: 1791, food: 2040, exercise: 530, remaining: 281, status: 'under' })).offsetByExercise).toBe(true);
  });

  it('does NOT flag an ordinary under day, nor an over day', () => {
    expect(barModel(day({ food: 1000, remaining: 1000, status: 'under' })).offsetByExercise).toBe(false);
    expect(barModel(day({ budget: 1791, food: 2040, exercise: 0, remaining: -249, status: 'over' })).offsetByExercise).toBe(false);
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
