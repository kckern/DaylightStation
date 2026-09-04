import { describe, it, expect } from 'vitest';
import { barModel, fmtKcal, OVERSHOOT_CAP } from './dayBars.js';

// jsdom cannot measure a rendered bar, so the number the component SETS is
// what a test can pin — which is the reason this arithmetic is a function.

const day = (over = {}) => ({ date: '2026-09-01', budget: 2000, food: 1000, status: 'under', ...over });

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

describe('fmtKcal', () => {
  it('compacts thousands and dashes the unknown', () => {
    expect(fmtKcal(1234)).toBe('1.2k');
    expect(fmtKcal(940)).toBe('940');
    expect(fmtKcal(0)).toBe('0');
    expect(fmtKcal(null)).toBe('—');
    expect(fmtKcal(undefined)).toBe('—');
  });
});
