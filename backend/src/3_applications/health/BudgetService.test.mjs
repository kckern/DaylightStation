import { describe, it, expect } from 'vitest';
import { BudgetService } from './BudgetService.mjs';

const GOALS = {
  targetWeightLbs: 180, weeklyRateLbs: 1, activityBaseline: 1.35,
  budgetFloor: 1200, heightIn: 70, birthYear: 1986, sex: 'male',
};

const makeService = (over = {}) => new BudgetService({
  goalsStore: { load: async () => GOALS, save: async () => {}, ...over.goalsStore },
  healthStore: {
    loadWeightData: async () => ({
      '2026-09-01': { lbs_adjusted_average: 200 },
      '2026-08-30': { lbs_adjusted_average: 201 },
    }),
    getWorkoutsForDate: async () => ([{ type: 'cycling', calories: 320, duration_min: 42 }]),
    ...over.healthStore,
  },
  nutriListStore: {
    findByDate: async () => ([
      { calories: 400, status: 'accepted' },
      { calories: 880 },
      { calories: 999, status: 'pending' }, // pending never counts
    ]),
    ...over.nutriListStore,
  },
  clock: { now: () => new Date('2026-09-02T12:00:00Z').getTime() },
  logger: { debug() {}, info() {}, warn() {}, error() {} },
});

describe('BudgetService.getBudget', () => {
  it('assembles the equation from goals, weight, food, exercise', async () => {
    const b = await makeService().getBudget('kckern', '2026-09-02');
    expect(b.budget).toBe(1962); // B1 fixture: 200lbs, 70in, age 40, male
    expect(b.food).toBe(1280);   // 400 + 880; pending excluded
    expect(b.exercise).toBe(320);
    expect(b.remaining).toBe(1962 - 1280 + 320);
    expect(b.status).toBe('under');
    expect(b.sessions).toHaveLength(1);
  });

  it('marks weight stale when the latest reading is >7 days old', async () => {
    const svc = makeService({
      healthStore: {
        loadWeightData: async () => ({ '2026-08-20': { lbs_adjusted_average: 200 } }),
        getWorkoutsForDate: async () => [],
      },
    });
    const b = await svc.getBudget('kckern', '2026-09-02');
    expect(b.stale).toBe(true);
    expect(b.budget).toBe(1962); // still computed from last known weight
  });

  it('throws a coded error when goals are not configured', async () => {
    const svc = makeService({ goalsStore: { load: async () => null } });
    await expect(svc.getBudget('kckern', '2026-09-02')).rejects.toThrow(/GOALS_NOT_CONFIGURED/);
  });

  it('over status when food exceeds budget+exercise', async () => {
    const svc = makeService({
      nutriListStore: { findByDate: async () => [{ calories: 3000 }] },
    });
    const b = await svc.getBudget('kckern', '2026-09-02');
    expect(b.status).toBe('over');
    expect(b.remaining).toBeLessThan(0);
  });

  it('flattens grouped-array workout sessions (real getWorkoutsForDate shape) before summing exercise', async () => {
    const svc = makeService({
      healthStore: {
        getWorkoutsForDate: async () => ([[{ calories: 320, minutes: 42 }], []]),
      },
    });
    const b = await svc.getBudget('kckern', '2026-09-02');
    expect(b.exercise).toBe(320);
    expect(b.sessions).toHaveLength(1);
    expect(b.sessions[0]).toMatchObject({ calories: 320, minutes: 42 });
  });

  it('rounds food once so remaining === budget - food + exercise exactly, even with fractional-calorie rows', async () => {
    const svc = makeService({
      nutriListStore: { findByDate: async () => ([
        { calories: 100.4, status: 'accepted' },
        { calories: 100.4, status: 'accepted' },
      ]) },
    });
    const b = await svc.getBudget('kckern', '2026-09-02');
    expect(b.food).toBe(201); // Math.round(100.4 + 100.4) = Math.round(200.8) = 201
    expect(b.remaining).toBe(b.budget - b.food + b.exercise);
    expect(b.net).toBe(b.food - b.exercise);
  });
});

describe('BudgetService.setGoals', () => {
  it('propagates a coded write failure from the goals store', async () => {
    const err = new Error('GOALS_WRITE_FAILED: could not write goals to apps/health/goals for user kckern');
    err.code = 'GOALS_WRITE_FAILED';
    const svc = makeService({
      goalsStore: { save: async () => { throw err; } },
    });
    await expect(svc.setGoals('kckern', GOALS)).rejects.toThrow(/GOALS_WRITE_FAILED/);
    await expect(svc.setGoals('kckern', GOALS)).rejects.toMatchObject({ code: 'GOALS_WRITE_FAILED' });
  });
});
