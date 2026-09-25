import { describe, it, expect } from 'vitest';
import { budgetGeometry } from './budgetGeometry.js';

// food 1390 − exercise 247 = net 1143; ceiling = 1791 + 247 = 2038; even = 2291 + 247 = 2538.
const day = (over = {}) => ({
  food: 1390, exercise: 247, net: 1143, maintenance: 2291, range: { floor: 1200, top: 1791 },
  zone: 'in-range', remaining: 648, declared: null, ...over,
});
const close = (a, b) => expect(a).toBeCloseTo(b, 1);
// A segment's length back in kcal, so a run can be checked against `remaining`.
const kcal = (g, seg) => (seg.widthPct / 100) * g.right;

describe('budgetGeometry — the ruler is food, from 0', () => {
  it('starts at 0 even on an exercise day, with 12% headroom past the furthest mark', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    close(g.pct(0), 0);
    close(g.right, 2538 * 1.12);
  });

  it('with no exercise there is no hatch, and the ceiling is the top', () => {
    const g = budgetGeometry(day({ exercise: 0, net: 1390, remaining: 401 }), { widthPx: 360 });
    expect(g.earned).toBeNull();
    expect(g.ceiling).toBe(1791);
    close(g.right, 2291 * 1.12);
  });
});

describe('budgetGeometry — segments sit at the values they name', () => {
  it('food runs 0 → food eaten', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    close(g.food.fromPct, 0);
    close(g.food.fromPct + g.food.widthPct, g.pct(1390));
    expect(g.food.value).toBe(1390);
    expect(g.zone).toBe('in-range');
  });

  it('the exercise hatch runs top → top + exercise', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    close(g.earned.fromPct, g.pct(1791));
    close(g.earned.fromPct + g.earned.widthPct, g.pct(2038));
    expect(g.earned.value).toBe(247);
    expect(g.ceiling).toBe(2038);
  });

  it('negative net: nothing goes below 0 and no width is negative', () => {
    const g = budgetGeometry(day({ food: 100, exercise: 400, net: -300, zone: 'incomplete', remaining: 2091 }), { widthPx: 360 });
    close(g.food.fromPct, 0);
    expect(g.food.widthPct).toBeGreaterThan(0);
    expect(g.earned.widthPct).toBeGreaterThan(0);
    expect(g.run.widthPct).toBeGreaterThan(0);
    close(kcal(g, g.run), 2091);
  });
});

describe('budgetGeometry — band and marks', () => {
  it('the band runs from the floor to the ceiling, labelled with the configured goal', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    close(g.band.fromPct, g.pct(1200));
    close(g.band.toPct, g.pct(2038));
    expect(g.band.label).toBe('Goal 1,200–1,791');
  });

  it('floor = top with no exercise: a band with no width, labelled with one number', () => {
    const g = budgetGeometry(day({ exercise: 0, net: 1000, food: 1000, range: { floor: 1200, top: 1200 }, zone: 'incomplete', remaining: 200 }), { widthPx: 360 });
    close(g.band.fromPct, g.band.toPct);
    close(g.band.toPct, g.pct(1200));
    expect(g.band.label).toBe('Goal 1,200');
  });

  it('floor = top with exercise: the band is the hatch, top → ceiling', () => {
    const g = budgetGeometry(day({ range: { floor: 1200, top: 1200 } }), { widthPx: 360 });
    close(g.band.fromPct, g.pct(1200));
    close(g.band.toPct, g.pct(1447));
    expect(g.band.label).toBe('Goal 1,200');
  });

  it('break-even sits at maintenance + exercise and is labelled with that value', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    expect(g.even.value).toBe(2538);
    close(g.even.pct, g.pct(2538));
  });

  it('break-even keeps only its number when it crowds the ceiling', () => {
    expect(budgetGeometry(day(), { widthPx: 360 }).even.wordless).toBe(false);
    // even 1850 + 247 = 2097, 59 kcal from the 2038 ceiling ≈ 9 px.
    expect(budgetGeometry(day({ maintenance: 1850 }), { widthPx: 360 }).even.wordless).toBe(true);
  });

  it('no maintenance, no break-even mark', () => {
    expect(budgetGeometry(day({ maintenance: 0 }), { widthPx: 360 }).even).toBeNull();
  });
});

describe('budgetGeometry — ticks', () => {
  it('every 250, numbered at 1,000s on a phone, none within 12px of a named mark', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    const values = g.ticks.map(t => t.value);
    expect(values).toContain(250);
    expect(values).toContain(1000);
    // 1,250 crowds the floor (1,200); 1,750 the top (1,791); 2,000 the ceiling (2,038); 2,500 break-even (2,538).
    expect(values).not.toContain(1250);
    expect(values).not.toContain(1750);
    expect(values).not.toContain(2000);
    expect(values).not.toContain(2500);
    expect(g.ticks.find(t => t.value === 1000).label).toBe('1,000');
    expect(g.ticks.find(t => t.value === 500).label).toBeNull();
  });

  it('numbered at 500s from 600px', () => {
    const g = budgetGeometry(day(), { widthPx: 640 });
    expect(g.ticks.find(t => t.value === 500).label).toBe('500');
  });

  it('never ticks 0 or anything below it', () => {
    expect(budgetGeometry(day(), { widthPx: 360 }).ticks.some(t => t.value <= 0)).toBe(false);
  });
});

describe('budgetGeometry — labels fit or drop', () => {
  it('food is labelled at ≥70px, the hatch at ≥36px', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    expect(g.food.labelled).toBe(true);
    expect(g.earned.labelled).toBe(false); // 247 kcal ≈ 31px
    expect(budgetGeometry(day({ exercise: 0, food: 400, net: 400, zone: 'incomplete', remaining: 800 }), { widthPx: 280 }).food.labelled).toBe(false);
  });
});

describe('budgetGeometry — the run is the headline number, drawn', () => {
  const run = (over) => budgetGeometry(day(over), { widthPx: 360 });

  it('in range: food → ceiling, as long as remaining', () => {
    const g = run({});
    close(g.run.fromPct, g.pct(1390));
    close(g.run.fromPct + g.run.widthPct, g.pct(2038));
    close(kcal(g, g.run), 648);
    expect(g.run.value).toBe(648);
  });

  it('incomplete: food → ceiling, like in range', () => {
    const g = run({ food: 700, net: 453, zone: 'incomplete', remaining: 1338 });
    close(g.run.fromPct + g.run.widthPct, g.pct(2038));
    close(kcal(g, g.run), 1338);
  });

  it('over: ceiling → food; past break-even: break-even → food', () => {
    const over = run({ food: 2147, net: 1900, zone: 'over', remaining: 109 });
    close(over.run.fromPct, over.pct(2038));
    close(kcal(over, over.run), 109);
    const past = run({ food: 2647, net: 2400, zone: 'past-even', remaining: 109 });
    close(past.run.fromPct, past.pct(2538));
    close(kcal(past, past.run), 109);
  });

  it('declared: no run', () => {
    expect(run({ food: 600, net: 353, zone: 'declared', declared: 'fasting' }).run).toBeNull();
  });

  it('the 2026-09-25 screenshot day: 558 eaten, 311 burned reads 1,544 left and a 2,602 break-even', () => {
    const g = budgetGeometry({ food: 558, exercise: 311, net: 247, maintenance: 2291, range: { floor: 1200, top: 1791 },
      zone: 'incomplete', remaining: 1544, declared: null }, { widthPx: 1888 });
    close(g.food.fromPct + g.food.widthPct, g.pct(558));
    close(g.band.fromPct, g.pct(1200));
    expect(g.ceiling).toBe(2102);
    close(kcal(g, g.run), 1544);
    expect(g.even.value).toBe(2602);
  });
});
