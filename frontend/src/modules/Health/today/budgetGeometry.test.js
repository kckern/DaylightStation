import { describe, it, expect } from 'vitest';
import { budgetGeometry } from './budgetGeometry.js';

const day = (over = {}) => ({
  food: 1390, exercise: 247, net: 1143, maintenance: 2291, range: { floor: 1200, top: 1791 },
  zone: 'in-range', remaining: 648, declared: null, ...over,
});
const close = (a, b) => expect(a).toBeCloseTo(b, 1);

describe('budgetGeometry — the ruler', () => {
  it('opens a left margin for exercise, rounded up to 250, and adds 12% headroom on the right', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    expect(g.left).toBe(-250);
    close(g.right, 2291 * 1.12);
  });

  it('with no exercise the ruler starts at 0 and there is no zero line or hatch', () => {
    const g = budgetGeometry(day({ exercise: 0, net: 1390, remaining: 401 }), { widthPx: 360 });
    expect(g.left).toBe(0);
    expect(g.zero).toBeNull();
    expect(g.earned).toBeNull();
  });
});

describe('budgetGeometry — segments', () => {
  it('food starts at −exercise and its right edge is net (the frontier)', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    close(g.food.fromPct, g.pct(-247));
    close(g.food.fromPct + g.food.widthPct, g.pct(1143));
    expect(g.food.value).toBe(1390);
    expect(g.zone).toBe('in-range');
  });

  it('the earned hatch runs from −exercise to 0', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    close(g.earned.fromPct, g.pct(-247));
    close(g.earned.fromPct + g.earned.widthPct, g.pct(0));
    expect(g.earned.value).toBe(247);
  });

  it('negative net: food ends left of 0, the hatch remainder is unused credit, no negative widths', () => {
    const g = budgetGeometry(day({ food: 100, exercise: 400, net: -300, zone: 'incomplete', remaining: 1100 }), { widthPx: 360 });
    expect(g.left).toBe(-500);
    close(g.food.fromPct + g.food.widthPct, g.pct(-300));
    expect(g.food.widthPct).toBeGreaterThan(0);
    expect(g.earned.widthPct).toBeGreaterThan(0);
    expect(g.run.widthPct).toBeGreaterThan(0);
  });
});

describe('budgetGeometry — band and marks', () => {
  it('the band runs from floor − exercise to top, labelled with the configured floor', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    close(g.band.fromPct, g.pct(1200 - 247));
    close(g.band.toPct, g.pct(1791));
    expect(g.band.label).toBe('Goal 1,200–1,791');
    expect(g.band.collapsed).toBe(false);
  });

  it('exercise past the floor puts the band edge left of zero', () => {
    const g = budgetGeometry(day({ food: 1300, exercise: 1500, net: -200, remaining: 1991 }), { widthPx: 360 });
    expect(g.band.fromPct).toBeLessThan(g.zero);
    expect(g.band.fromPct).toBeGreaterThanOrEqual(0);
  });

  it('collapses to one Goal line when the floor meets the top', () => {
    const g = budgetGeometry(day({ exercise: 0, net: 1000, range: { floor: 1200, top: 1200 }, zone: 'incomplete', remaining: 200 }), { widthPx: 360 });
    expect(g.band.collapsed).toBe(true);
    expect(g.band.label).toBe('Goal 1,200');
  });

  it('break-even keeps only its number when it crowds the top', () => {
    expect(budgetGeometry(day(), { widthPx: 360 }).even.wordless).toBe(false);
    expect(budgetGeometry(day({ maintenance: 1850 }), { widthPx: 360 }).even.wordless).toBe(true);
  });
});

describe('budgetGeometry — ticks', () => {
  it('every 250, numbered at 1,000s on a phone, none within 12px of a named mark', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    const values = g.ticks.map(t => t.value);
    expect(values).toContain(250);
    expect(values).toContain(2000);
    // 1,000 sits 6px from the band edge (953); 1,750 and 2,250 crowd top and break-even.
    expect(values).not.toContain(1000);
    expect(values).not.toContain(1750);
    expect(values).not.toContain(2250);
    expect(g.ticks.find(t => t.value === 2000).label).toBe('2,000');
    expect(g.ticks.find(t => t.value === 500).label).toBeNull();
  });

  it('numbered at 500s from 600px', () => {
    const g = budgetGeometry(day(), { widthPx: 640 });
    expect(g.ticks.find(t => t.value === 500).label).toBe('500');
  });

  it('never ticks the ruler\'s own left edge', () => {
    expect(budgetGeometry(day(), { widthPx: 360 }).ticks.some(t => t.value <= -250)).toBe(false);
  });
});

describe('budgetGeometry — labels fit or drop', () => {
  it('food is labelled at ≥70px, the hatch at ≥36px', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    expect(g.food.labelled).toBe(true);
    expect(g.earned.labelled).toBe(false); // 247 kcal ≈ 32px
    expect(budgetGeometry(day({ exercise: 0, food: 400, net: 400, zone: 'incomplete', remaining: 800 }), { widthPx: 280 }).food.labelled).toBe(false);
  });
});

describe('budgetGeometry — the remaining run', () => {
  const run = (over) => budgetGeometry(day(over), { widthPx: 360 });
  it('in range: frontier to top, carrying remaining', () => {
    const g = run({});
    close(g.run.fromPct, g.pct(1143));
    close(g.run.fromPct + g.run.widthPct, g.pct(1791));
    expect(g.run.value).toBe(648);
  });
  it('incomplete: frontier to the ceiling, like in range', () => {
    const g = run({ food: 700, net: 453, zone: 'incomplete', remaining: 1338 });
    close(g.run.fromPct + g.run.widthPct, g.pct(1791));
  });
  it('over: top to frontier; past break-even: break-even to frontier', () => {
    const over = run({ food: 2147, net: 1900, zone: 'over', remaining: 109 });
    close(over.run.fromPct, over.pct(1791));
    close(over.run.fromPct + over.run.widthPct, over.pct(1900));
    const past = run({ food: 2647, net: 2400, zone: 'past-even', remaining: 109 });
    close(past.run.fromPct, past.pct(2291));
  });
  it('declared: no run', () => {
    expect(run({ food: 600, net: 353, zone: 'declared', declared: 'fasting' }).run).toBeNull();
  });
});
