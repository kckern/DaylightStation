import { describe, expect, it } from 'vitest';
import { budgetGeometry } from './budgetGeometry.js';

const day = (food, exercise = 941, overrides = {}) => ({
  food, exercise, maintenance: 2000, range: { floor: 1200, top: 1600 },
  zone: food > 2941 ? 'past-even' : food > 2541 ? 'over' : 'in-range',
  ...overrides,
});

describe('the single budget bar', () => {
  it('describes the goal range and separates spent from available workout room', () => {
    const g = budgetGeometry(day(1800, 400), { widthPx: 900 });
    expect(g.goalRange).toMatchObject({ from: 1200, to: 2000 });
    expect(g.goalRange.bonus).toMatchObject({ from: 1600, to: 2000, spentTo: 1800 });
    expect(g.goalRange.fromPct).toBe(40);
    expect(g.goalRange.widthPct).toBeCloseTo(26.67, 2);
    expect(g.goalRange.bonus.fromPct).toBeCloseTo(53.33, 2);
    expect(g.goalRange.bonus.spentWidthPct).toBeCloseTo(6.67, 2);
    expect(g.goalRange.bonus.availableWidthPct).toBeCloseTo(6.67, 2);
  });

  it('keeps earlier intake stable when food crosses the plan', () => {
    const before = budgetGeometry(day(2464), { widthPx: 900 });
    const after = budgetGeometry(day(2624), { widthPx: 900 });
    expect(before.consumed.map(({ key, from, to }) => [key, from, to])).toEqual([
      ['base', 0, 1600], ['workout', 1600, 2464],
    ]);
    expect(after.consumed.map(({ key, from, to }) => [key, from, to])).toEqual([
      ['base', 0, 1600], ['workout', 1600, 2541], ['over', 2541, 2624],
    ]);
    expect(before.available.map(({ key, from, to }) => [key, from, to])).toEqual([
      ['workout', 2464, 2541],
    ]);
    expect(before.right).toBe(after.right);
    expect(after.cursor.value).toBe(2624);
  });

  it('places a surplus only beyond break even, with no exercise when none was logged', () => {
    const g = budgetGeometry(day(2200, 0, { zone: 'past-even' }));
    expect(g.consumed.map(({ key, from, to }) => [key, from, to])).toEqual([
      ['base', 0, 1600], ['over', 1600, 2000], ['surplus', 2000, 2200],
    ]);
    expect(g.posts.some(p => p.key === 'base')).toBe(false);
  });

  it('distinguishes configured target from a fully capped usable limit', () => {
    const g = budgetGeometry(day(1000, 300, {
      maintenance: 1100, range: { floor: 1500, top: 1500 }, zone: 'incomplete',
    }));
    expect(g.boundaries).toMatchObject({ floor: 1500, configuredBase: 1500, base: 1400, plan: 1400, even: 1400 });
    expect(g.posts.find(p => p.key === 'plan').value).toBe(1400);
    expect(g.capNote).toContain('1,500');
    expect(g.floorIssue).toBe(true);
    expect(g.right).toBeGreaterThan(1500);
  });

  it('detects a partially capped workout even when the base is not capped', () => {
    const g = budgetGeometry(day(1300, 300, {
      maintenance: 1100, range: { floor: 1200, top: 1200 },
    }));
    expect(g.boundaries).toMatchObject({ base: 1200, plan: 1400, even: 1400 });
    expect(g.capNote).toContain('200 of 300');
    expect(g.consumed.at(-1)).toMatchObject({ key: 'workout', from: 1200, to: 1300 });
  });

  it('groups visually inseparable posts while retaining their exact values', () => {
    const g = budgetGeometry(day(1800, 0, { maintenance: 1601 }), { widthPx: 320 });
    expect(g.postGroups.some(group => group.posts.map(p => p.key).includes('plan')
      && group.posts.map(p => p.key).includes('even'))).toBe(true);
    expect(g.posts.find(p => p.key === 'even').value).toBe(1601);
  });

  it('freezes a preview domain and reports overflow without falsifying the value', () => {
    const baseline = budgetGeometry(day(2464));
    const preview = budgetGeometry(day(4800), { rightOverride: baseline.right, baselineFood: 2464 });
    expect(preview.right).toBe(baseline.right);
    expect(preview.cursor).toMatchObject({ value: 4800, overflow: true, pct: 100 });
    expect(preview.baselineCursor.value).toBe(2464);
  });

  it('removes available-looking fills on a finished day', () => {
    const g = budgetGeometry(day(2464), { finished: true });
    expect(g.available).toEqual([]);
    expect(g.consumed.map(p => p.key)).toEqual(['base', 'workout']);
  });
});
