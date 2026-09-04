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

  it('counts an overlapping workout ONCE — activity and fitness are two views of the same session, not two sessions (real getWorkoutsForDate shape)', async () => {
    const svc = makeService({
      healthStore: {
        // Same run, seen from two sources: activity (rich, Strava-style) and
        // fitness (plain Garmin daily rollup) — this is the real shape that
        // double-counted in production before the fix.
        getWorkoutsForDate: async () => ({
          activity: [{ id: 1, title: 'Lunch Run', calories: 517, minutes: 42.47 }],
          fitness: [{ title: 'Running', calories: 518, minutes: 87.18 }],
        }),
      },
    });
    const b = await svc.getBudget('kckern', '2026-09-02');
    expect(b.exercise).toBe(517); // activity wins; fitness's 518 is NOT added on top
    expect(b.sessions).toHaveLength(1);
    expect(b.sessions[0]).toMatchObject({ id: 1, calories: 517, minutes: 42.47 });
  });

  it('falls back to the fitness group when activity is empty for the date (watchless / home-workout days)', async () => {
    const svc = makeService({
      healthStore: {
        getWorkoutsForDate: async () => ({
          activity: [],
          fitness: [{ title: 'Cycling', calories: 320, minutes: 42 }],
        }),
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

// ============================================================================
// Task 6.1 — day macros + micro coverage + goal-shape validation
// ============================================================================

describe('BudgetService.getBudget — macros (Task 6.1)', () => {
  it('sums protein/carbs/fat and the four micros over the SAME COUNTED fold as food', async () => {
    const svc = makeService({
      nutriListStore: {
        findByDate: async () => ([
          { calories: 400, protein: 30, carbs: 40, fat: 10, fiber: 5, sugar: 8, sodium: 300, cholesterol: 40, microsSource: 'ai' },
          { calories: 880, protein: 20, carbs: 100, fat: 30, fiber: 3, sugar: 12, sodium: 700, cholesterol: 60, microsSource: 'ai' },
          // pending/rejected/deleted must be excluded from macros exactly as
          // they are from `food` — a second, subtly different fold is the bug
          // this test exists to prevent.
          { calories: 999, protein: 99, carbs: 99, fat: 99, fiber: 99, sugar: 99, sodium: 9999, cholesterol: 999, status: 'pending', microsSource: 'ai' },
          { calories: 999, protein: 99, carbs: 99, fat: 99, status: 'rejected' },
          { calories: 999, protein: 99, carbs: 99, fat: 99, status: 'deleted' },
        ]),
      },
    });
    const b = await svc.getBudget('kckern', '2026-09-02');
    expect(b.food).toBe(1280);
    expect(b.macros).toEqual({
      protein: 50, carbs: 140, fat: 40,
      fiber: 8, sugar: 20, sodium: 1000, cholesterol: 100,
    });
  });

  it('counts a group and its children ONCE — a group row carries zero nutrition by design', async () => {
    const svc = makeService({
      nutriListStore: {
        findByDate: async () => ([
          // The dish header: zero nutrition (groupParsedItems.mjs writes it this way).
          { uuid: 'g1', kind: 'group', calories: 0, protein: 0, carbs: 0, fat: 0 },
          { uuid: 'c1', kind: 'item', parentId: 'g1', calories: 200, protein: 12, carbs: 20, fat: 5 },
          { uuid: 'c2', kind: 'item', parentId: 'g1', calories: 300, protein: 18, carbs: 30, fat: 9 },
        ]),
      },
    });
    const b = await svc.getBudget('kckern', '2026-09-02');
    expect(b.food).toBe(500);
    expect(b.macros.protein).toBe(30);
    expect(b.macros.carbs).toBe(50);
    expect(b.macros.fat).toBe(14);
  });

  it('tolerates missing/garbage macro fields without producing NaN', async () => {
    const svc = makeService({
      nutriListStore: {
        findByDate: async () => ([
          { calories: 100 },                                  // no macros at all
          { calories: 100, protein: 'lots', carbs: null, fat: undefined },
          { calories: 100, protein: 10, carbs: 10, fat: 10 },
        ]),
      },
    });
    const b = await svc.getBudget('kckern', '2026-09-02');
    expect(b.macros.protein).toBe(10);
    expect(b.macros.carbs).toBe(10);
    expect(b.macros.fat).toBe(10);
    expect(Number.isNaN(b.macros.sodium)).toBe(false);
  });
});

describe('BudgetService.getBudget — microCoverage (Task 6.1)', () => {
  it('keys coverage off microsSource, NEVER off the values — a stored 0 means "not measured"', async () => {
    const svc = makeService({
      nutriListStore: {
        findByDate: async () => ([
          // Real measured zero-ish micros, provenance present -> covered.
          { calories: 100, sodium: 0, fiber: 0, sugar: 0, cholesterol: 0, microsSource: 'ai' },
          // Structural zeros with NO provenance -> NOT covered, even though
          // every micro field is present and numeric.
          { calories: 100, sodium: 0, fiber: 0, sugar: 0, cholesterol: 0, microsSource: null },
          { calories: 100, sodium: 0, fiber: 0, sugar: 0, cholesterol: 0 },
        ]),
      },
    });
    const b = await svc.getBudget('kckern', '2026-09-02');
    for (const key of ['fiber', 'sugar', 'sodium', 'cholesterol']) {
      expect(b.microCoverage[key]).toEqual({ covered: 1, total: 3 });
    }
  });

  it('counts a catalog-sourced row as covered too', async () => {
    const svc = makeService({
      nutriListStore: {
        findByDate: async () => ([
          { calories: 100, microsSource: 'catalog' },
          { calories: 100, microsSource: 'ai' },
        ]),
      },
    });
    const b = await svc.getBudget('kckern', '2026-09-02');
    expect(b.microCoverage.sodium).toEqual({ covered: 2, total: 2 });
  });

  it('excludes pending/rejected/deleted rows from the coverage denominator', async () => {
    const svc = makeService({
      nutriListStore: {
        findByDate: async () => ([
          { calories: 100, microsSource: 'ai' },
          { calories: 100, status: 'pending' },
          { calories: 100, status: 'deleted' },
        ]),
      },
    });
    const b = await svc.getBudget('kckern', '2026-09-02');
    expect(b.microCoverage.fiber).toEqual({ covered: 1, total: 1 });
  });

  it('excludes group rows from BOTH sides — a dish header is not a food that could carry micros', async () => {
    const svc = makeService({
      nutriListStore: {
        findByDate: async () => ([
          { uuid: 'g1', kind: 'group', calories: 0 },
          { uuid: 'c1', kind: 'item', parentId: 'g1', calories: 200, microsSource: 'ai' },
          { uuid: 'c2', kind: 'item', parentId: 'g1', calories: 300, microsSource: 'ai' },
        ]),
      },
    });
    const b = await svc.getBudget('kckern', '2026-09-02');
    // 2 of 2, not 2 of 3 — the header would otherwise report missing data
    // that does not exist.
    expect(b.microCoverage.sugar).toEqual({ covered: 2, total: 2 });
  });
});

describe('BudgetService.setGoals — macro/watch-micro shape (Task 6.1)', () => {
  const saveSpy = () => {
    const calls = [];
    return { calls, save: async (goals) => { calls.push(goals); } };
  };

  it('accepts and round-trips macroGoals + watchMicros verbatim', async () => {
    const spy = saveSpy();
    const svc = makeService({ goalsStore: { save: spy.save } });
    const goals = {
      ...GOALS,
      macroGoals: { proteinG: 150, carbsG: 200, fatG: 60 },
      watchMicros: [
        { key: 'sodium', limit: 2300, direction: 'ceiling' },
        { key: 'fiber', limit: 30, direction: 'floor' },
      ],
    };
    await svc.setGoals('kckern', goals);
    expect(spy.calls[0].macroGoals).toEqual({ proteinG: 150, carbsG: 200, fatG: 60 });
    expect(spy.calls[0].watchMicros).toEqual(goals.watchMicros);
  });

  it('accepts null macro targets (a cleared goal is not a zero goal)', async () => {
    const spy = saveSpy();
    const svc = makeService({ goalsStore: { save: spy.save } });
    await svc.setGoals('kckern', { ...GOALS, macroGoals: { proteinG: 150, carbsG: null, fatG: null } });
    expect(spy.calls[0].macroGoals).toEqual({ proteinG: 150, carbsG: null, fatG: null });
  });

  it('leaves an absent macroGoals/watchMicros ABSENT — never backfilled to null or {}', async () => {
    const spy = saveSpy();
    const svc = makeService({ goalsStore: { save: spy.save } });
    // GOALS deliberately OMITS both keys — the pre-existing on-disk shape.
    await svc.setGoals('kckern', { ...GOALS });
    expect(Object.prototype.hasOwnProperty.call(spy.calls[0], 'macroGoals')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(spy.calls[0], 'watchMicros')).toBe(false);
  });

  it.each([
    ['macroGoals is an array', { macroGoals: [] }],
    ['macroGoals is a string', { macroGoals: 'lots' }],
    ['macroGoals has an unknown key', { macroGoals: { proteinGrams: 150 } }],
    ['a macro target is a string', { macroGoals: { proteinG: '150' } }],
    ['a macro target is negative', { macroGoals: { proteinG: -1 } }],
    ['a macro target is NaN', { macroGoals: { proteinG: Number.NaN } }],
    ['watchMicros is not an array', { watchMicros: { sodium: 2300 } }],
    ['a watch entry is not an object', { watchMicros: ['sodium'] }],
    ['a watch key is not a known micro', { watchMicros: [{ key: 'potassium', limit: 1, direction: 'ceiling' }] }],
    ['a watch key is a macro', { watchMicros: [{ key: 'protein', limit: 1, direction: 'floor' }] }],
    ['a watch limit is missing', { watchMicros: [{ key: 'sodium', direction: 'ceiling' }] }],
    ['a watch limit is zero', { watchMicros: [{ key: 'sodium', limit: 0, direction: 'ceiling' }] }],
    ['a watch limit is a string', { watchMicros: [{ key: 'sodium', limit: '2300', direction: 'ceiling' }] }],
    ['a watch direction is missing', { watchMicros: [{ key: 'sodium', limit: 2300 }] }],
    ['a watch direction is nonsense', { watchMicros: [{ key: 'sodium', limit: 2300, direction: 'up' }] }],
    ['a watch key is duplicated', { watchMicros: [
      { key: 'sodium', limit: 2300, direction: 'ceiling' },
      { key: 'sodium', limit: 1800, direction: 'ceiling' },
    ] }],
  ])('rejects with GOALS_INVALID when %s', async (_label, bad) => {
    const spy = saveSpy();
    const svc = makeService({ goalsStore: { save: spy.save } });
    await expect(svc.setGoals('kckern', { ...GOALS, ...bad })).rejects.toMatchObject({ code: 'GOALS_INVALID' });
    // A refusal must not have written anything.
    expect(spy.calls).toHaveLength(0);
  });

  it('rejects a non-object goals payload', async () => {
    const svc = makeService();
    await expect(svc.setGoals('kckern', null)).rejects.toMatchObject({ code: 'GOALS_INVALID' });
    await expect(svc.setGoals('kckern', [GOALS])).rejects.toMatchObject({ code: 'GOALS_INVALID' });
  });
});

// ---------------------------------------------------------------------------
// getBudgetRange (Task 8.1) — the batched cousin of getBudget.
//
// Two properties matter beyond "the numbers are right":
//   1. A day with no usable weight is a GAP INSIDE the array, never a thrown
//      range. A short weight history must not make the week strip unusable.
//   2. Storage is touched a FIXED number of times regardless of range length.
//      The whole point of this endpoint is to stop the 7-parallel-request
//      fan-out; a per-day loop inside the service would just move it.
// ---------------------------------------------------------------------------

const rangeGoals = { ...GOALS };

// Weight starts 2026-08-31 — anything before that is a NO_WEIGHT_DATA gap.
const RANGE_WEIGHT = {
  '2026-08-31': { lbs_adjusted_average: 200 },
  '2026-09-01': { lbs_adjusted_average: 200 },
};

function makeRangeService(over = {}) {
  const calls = { goals: 0, weight: 0, byRange: 0, workoutsRange: 0, workoutsDate: 0 };
  const rows = over.rows ?? [
    { date: '2026-08-31', calories: 500, protein: 30 },
    { date: '2026-09-01', calories: 400, protein: 20, status: 'accepted' },
    { date: '2026-09-01', calories: 900, protein: 10 },
    { date: '2026-09-01', calories: 777, status: 'pending' },   // never counts
    { date: '2026-09-01', calories: 666, status: 'rejected' },  // never counts
    { date: '2026-09-01', calories: 555, status: 'deleted' },   // never counts
  ];
  const svc = new BudgetService({
    goalsStore: { load: async () => { calls.goals += 1; return over.goals === undefined ? rangeGoals : over.goals; }, save: async () => {} },
    healthStore: {
      loadWeightData: async () => { calls.weight += 1; return over.weight ?? RANGE_WEIGHT; },
      getWorkoutsForDate: async () => { calls.workoutsDate += 1; return { activity: [], fitness: [] }; },
      getWorkoutsForRange: async () => {
        calls.workoutsRange += 1;
        return over.workouts ?? { '2026-09-01': { activity: [{ calories: 300 }], fitness: [] } };
      },
    },
    nutriListStore: {
      findByDate: async () => [],
      findByDateRange: async () => { calls.byRange += 1; return rows; },
    },
    clock: { now: () => new Date('2026-09-02T12:00:00Z').getTime() },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  return { svc, calls };
}

describe('BudgetService.getBudgetRange', () => {
  it('returns one entry per day, with a no-weight day as a gap object rather than failing the range', async () => {
    const { svc } = makeRangeService();
    const days = await svc.getBudgetRange('kckern', '2026-08-30', '2026-09-01');

    expect(days.map((d) => d.date)).toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
    // 08-30 predates every weight reading.
    expect(days[0]).toEqual({ date: '2026-08-30', error: 'NO_WEIGHT_DATA' });
    expect(days[0].budget).toBeUndefined();
    // The days around it are unaffected.
    expect(days[1].food).toBe(500);
    expect(days[2].food).toBe(1300);        // 400 + 900; pending/rejected/deleted excluded
    expect(days[2].exercise).toBe(300);
    expect(days[2].budget).toBe(1962);
    expect(days[2].remaining).toBe(1962 - 1300 + 300);
    expect(days[2].status).toBe('under');
    expect(days[2].macros.protein).toBe(30);
  });

  it('touches storage a FIXED number of times — not once per day', async () => {
    const { svc, calls } = makeRangeService();
    await svc.getBudgetRange('kckern', '2026-07-15', '2026-09-01'); // 49 days
    expect(calls.goals).toBe(1);
    expect(calls.weight).toBe(1);
    expect(calls.byRange).toBe(1);
    expect(calls.workoutsRange).toBe(1);
    // The per-DATE workout call re-reads both whole lifelog files; a range must
    // never reach for it.
    expect(calls.workoutsDate).toBe(0);
  });

  it('folds exactly the rows getBudget folds — the shared COUNTED contract, not a range-local copy', async () => {
    const { svc } = makeRangeService();
    const [day] = await svc.getBudgetRange('kckern', '2026-09-01', '2026-09-01');
    // Same day through the single-day path, fed the same rows.
    const single = await new BudgetService({
      goalsStore: { load: async () => rangeGoals, save: async () => {} },
      healthStore: {
        loadWeightData: async () => RANGE_WEIGHT,
        getWorkoutsForDate: async () => ({ activity: [{ calories: 300 }], fitness: [] }),
      },
      nutriListStore: {
        findByDate: async () => ([
          { date: '2026-09-01', calories: 400, protein: 20, status: 'accepted' },
          { date: '2026-09-01', calories: 900, protein: 10 },
          { date: '2026-09-01', calories: 777, status: 'pending' },
          { date: '2026-09-01', calories: 666, status: 'rejected' },
          { date: '2026-09-01', calories: 555, status: 'deleted' },
        ]),
      },
      clock: { now: () => new Date('2026-09-02T12:00:00Z').getTime() },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    }).getBudget('kckern', '2026-09-01');

    expect(day.food).toBe(single.food);
    expect(day.budget).toBe(single.budget);
    expect(day.exercise).toBe(single.exercise);
    expect(day.remaining).toBe(single.remaining);
    expect(day.macros).toEqual(single.macros);
  });

  it('buckets rows by their own date — a neighbouring day never leaks into a total', async () => {
    const { svc } = makeRangeService({
      rows: [
        { date: '2026-08-31', calories: 1000 },
        { date: '2026-09-01', calories: 25 },
        // No `date`, dated by createdAt exactly as findByDateRange's filter does.
        { createdAt: '2026-09-01T18:00:00Z', calories: 75 },
        { calories: 9999 }, // undatable — belongs to no day
      ],
    });
    const days = await svc.getBudgetRange('kckern', '2026-08-31', '2026-09-01');
    expect(days[0].food).toBe(1000);
    expect(days[1].food).toBe(100);
  });

  it('a day with rows but no exercise still reports exercise 0, not a gap', async () => {
    const { svc } = makeRangeService({ workouts: {} });
    const days = await svc.getBudgetRange('kckern', '2026-09-01', '2026-09-01');
    expect(days[0].exercise).toBe(0);
    expect(days[0].error).toBeUndefined();
  });

  it.each([
    ['from is not a date', '2026-9-1', '2026-09-01'],
    ['to is not a date', '2026-09-01', 'yesterday'],
    ['from is a calendar impossibility that Date silently normalizes', '2026-02-31', '2026-03-01'],
    ['from is a calendar impossibility that Date rejects outright', '2026-08-32', '2026-09-01'],
    ['to is out of range', '2026-09-01', '2026-13-01'],
    ['from is after to', '2026-09-02', '2026-09-01'],
    ['the range exceeds 62 days', '2026-01-01', '2026-06-01'],
  ])('refuses with RANGE_INVALID when %s', async (_label, from, to) => {
    const { svc, calls } = makeRangeService();
    await expect(svc.getBudgetRange('kckern', from, to)).rejects.toMatchObject({ code: 'RANGE_INVALID' });
    // A refusal must not have gone near storage.
    expect(calls.byRange).toBe(0);
  });

  it('accepts exactly 62 days and refuses 63', async () => {
    const { svc } = makeRangeService();
    await expect(svc.getBudgetRange('kckern', '2026-07-02', '2026-09-01')).resolves.toHaveLength(62);
    await expect(svc.getBudgetRange('kckern', '2026-07-01', '2026-09-01')).rejects.toMatchObject({ code: 'RANGE_INVALID' });
  });

  it('missing goals fails the whole range — it is a property of the account, not of a day', async () => {
    const { svc } = makeRangeService({ goals: null });
    await expect(svc.getBudgetRange('kckern', '2026-09-01', '2026-09-01'))
      .rejects.toMatchObject({ code: 'GOALS_NOT_CONFIGURED' });
  });
});
