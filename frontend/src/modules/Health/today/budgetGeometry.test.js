import { describe, it, expect } from 'vitest';
import { budgetGeometry } from './budgetGeometry.js';

// The 2026-09-25 day: ceiling 1791 + 311 = 2102, break even 2291 + 311 = 2602.
const day = (over = {}) => ({
  food: 1470, exercise: 311, net: 1159, maintenance: 2291, range: { floor: 1200, top: 1791 },
  zone: 'in-range', remaining: 632, declared: null, ...over,
});
const close = (a, b) => expect(a).toBeCloseTo(b, 1);
const tier = (g, key) => g.tiers.find(t => t.key === key);

describe('budgetGeometry — the ruler is food, from 0', () => {
  it('12% headroom past the furthest line', () => {
    close(budgetGeometry(day(), { widthPx: 360 }).right, 2602 * 1.12);
  });

  it('food runs 0 → food eaten', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    close(g.food.fromPct, 0);
    close(g.food.fromPct + g.food.widthPct, g.pct(1470));
  });

  it('the goal\'s upper end grows by the workout', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    close(g.goal.pct, g.pct(2102));
    expect(g.goal.label).toBe('Goal 1,200–2,102');
    const rest = budgetGeometry(day({ exercise: 0 }), { widthPx: 360 });
    close(rest.goal.pct, rest.pct(1791));
    expect(rest.goal.label).toBe('Goal 1,200–1,791');
  });

  it('the goal range runs floor → top + workout, and only when the floor sits under the top', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    close(g.range.fromPct, g.pct(1200));
    close(g.range.fromPct + g.range.widthPct, g.pct(2102));
    close(g.range.floorPct, g.pct(1200));
    // Solid to the plan's top, hatched across the workout bonus.
    close(g.range.solid.fromPct + g.range.solid.widthPct, g.pct(1791));
    close(g.range.bonus.fromPct, g.pct(1791));
    close(g.range.bonus.fromPct + g.range.bonus.widthPct, g.pct(2102));
    expect(budgetGeometry(day({ exercise: 0 }), { widthPx: 360 }).range.bonus).toBeNull();
  });

  it('the bonus carries the workout room as a number once the food has covered it', () => {
    // 2026-09-30: top 1600, 384 burned, 2,160 eaten — past the whole goal.
    const over = budgetGeometry(day({ food: 2160, exercise: 384, maintenance: 2000, range: { floor: 1200, top: 1600 }, zone: 'over' }), { widthPx: 700 });
    expect(over.range.bonus).toMatchObject({ value: 384, shown: '384' });
    // Not yet covered: the workout tier prices it, so the bonus stays quiet.
    expect(budgetGeometry(day(), { widthPx: 700 }).range.bonus.shown).toBeNull();
    expect(budgetGeometry(day({ range: { floor: 0, top: 1791 } }), { widthPx: 360 }).range).toBeNull();
    expect(budgetGeometry(day({ range: { floor: 0, top: 1791 } }), { widthPx: 360 }).goal.label).toBe('Goal 2,102');
    expect(budgetGeometry(day({ exercise: 0, range: { floor: 1200, top: 1200 } }), { widthPx: 360 }).range).toBeNull();
    // A workout widens a closed range: 1,200–1,200 + 311.
    expect(budgetGeometry(day({ range: { floor: 1200, top: 1200 } }), { widthPx: 360 }).goal.label).toBe('Goal 1,200–1,511');
  });

  it('the plan\'s pre-workout top is a base mark on exercise days, even once the workout tier is spent', () => {
    const g = budgetGeometry(day({ food: 2300, zone: 'over' }), { widthPx: 360 });
    expect(g.base.value).toBe(1791);
    close(g.base.pct, g.pct(1791));
    expect(budgetGeometry(day({ exercise: 0 }), { widthPx: 360 }).base).toBeNull();
  });

  it('a ceiling capped at break even grows the goal by the workout room, not the raw exercise', () => {
    // top 1200, exercise 300, maintenance 1100 → break even 1400, workout room 200.
    const g = budgetGeometry(day({ exercise: 300, maintenance: 1100, range: { floor: 1200, top: 1200 }, food: 900 }), { widthPx: 360 });
    expect(g.goal.label).toBe('Goal 1,200–1,400');
  });

  it('a plan capped at break even says so on the goal mark', () => {
    const g = budgetGeometry(day({ exercise: 0, maintenance: 1100, range: { floor: 1200, top: 1200 }, food: 900 }), { widthPx: 360 });
    expect(g.goal.label).toBe('Goal · break even 1,100');
  });

  it('break even at maintenance + exercise; none without maintenance', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    expect(g.even.value).toBe(2602);
    close(g.even.pct, g.pct(2602));
    expect(budgetGeometry(day({ maintenance: 0 }), { widthPx: 360 }).even).toBeNull();
  });
});

describe('budgetGeometry — tiers are what is left, from the frontier on', () => {
  it('the 2026-09-25 day: free 1470→1791, workout 1791→2102, deficit 2102→2602', () => {
    const g = budgetGeometry(day(), { widthPx: 1700 });
    expect(g.tiers.map(t => t.key)).toEqual(['free', 'workout', 'deficit']);
    close(tier(g, 'free').fromPct, g.pct(1470));
    close(tier(g, 'free').fromPct + tier(g, 'free').widthPct, g.pct(1791));
    close(tier(g, 'workout').fromPct + tier(g, 'workout').widthPct, g.pct(2102));
    close(tier(g, 'deficit').fromPct + tier(g, 'deficit').widthPct, g.pct(2602));
    expect(g.tiers.map(t => t.label)).toEqual(['321 free', '311 workout', '500 deficit']);
    expect(g.tiers.map(t => t.shown)).toEqual(['321 free', '311 workout', '500 deficit']);
  });

  it('a spent tier is not drawn; a part-spent one starts at the frontier', () => {
    const g = budgetGeometry(day({ food: 1900 }), { widthPx: 1700 });
    expect(g.tiers.map(t => t.key)).toEqual(['workout', 'deficit']);
    close(tier(g, 'workout').fromPct, g.pct(1900));
    expect(tier(g, 'workout').label).toBe('202 workout');
  });

  it('a finished day names tiers as outcomes', () => {
    const g = budgetGeometry(day(), { widthPx: 1700, finished: true });
    expect(g.tiers.map(t => t.label)).toEqual(['321 unused', '311 banked', '500 deficit']);
  });

  it('past break even: no tiers', () => {
    expect(budgetGeometry(day({ food: 2800, zone: 'past-even' }), { widthPx: 360 }).tiers).toEqual([]);
  });

  it('on a phone, a tier too narrow for its words shows its number', () => {
    // 360px: free 321 kcal ≈ 39.7px, workout ≈ 38.4px, deficit ≈ 61.8px — all under 64, all over 30.
    const g = budgetGeometry(day(), { widthPx: 360 });
    expect(g.tiers.map(t => t.shown)).toEqual(['321', '311', '500']);
  });

  it('a tier too narrow even for its number shows nothing', () => {
    const g = budgetGeometry(day({ food: 1770 }), { widthPx: 360 }); // 21 kcal of free ≈ 2.6px
    expect(tier(g, 'free').shown).toBeNull();
  });
});

describe('budgetGeometry — ticks', () => {
  it('every 250, numbered at 1,000s on a phone, none within 12px of a named line', () => {
    // 360px, right = 2914.24: 1,750 is 5.1px from the top (dropped); 2,000 and 2,500
    // are 12.6px from the ceiling and break even (kept).
    const values = budgetGeometry(day(), { widthPx: 360 }).ticks.map(t => t.value);
    expect(values).toContain(1000);
    expect(values).not.toContain(1750);
    expect(values).toContain(2000);
    expect(values).toContain(2500);
  });

  it('never ticks 0', () => {
    expect(budgetGeometry(day(), { widthPx: 360 }).ticks.some(t => t.value <= 0)).toBe(false);
  });
});

describe('budgetGeometry — the eaten label fits or moves out', () => {
  it('inside at ≥70px', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    expect(g.food).toMatchObject({ labelled: true, outside: false, value: 1470 });
  });

  it('a short block carries it just past the frontier', () => {
    const g = budgetGeometry(day({ exercise: 0, food: 400, zone: 'incomplete' }), { widthPx: 280 });
    expect(g.food.outside).toBe(true);
  });

  it('nothing eaten, no label', () => {
    expect(budgetGeometry(day({ food: 0, zone: 'incomplete' }), { widthPx: 360 }).food.labelled).toBe(false);
  });
});
