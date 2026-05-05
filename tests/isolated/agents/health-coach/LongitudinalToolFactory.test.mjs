import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { LongitudinalToolFactory } from '../../../../backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs';

// Build a fixture spanning ~4 months so weekly/monthly/quarterly aggregations
// have multiple buckets to validate grouping behavior.
//
// Shape matches the real datastore (see HealthToolFactory.mjs lines 26-46):
//   { lbs, lbs_adjusted_average, fat_percent, fat_percent_average, date }
function buildFixture() {
  const fixture = {};
  // Walk every day from 2025-11-01 through 2026-02-28 inclusive.
  const start = new Date(Date.UTC(2025, 10, 1)); // Nov 1, 2025
  const end = new Date(Date.UTC(2026, 1, 28));   // Feb 28, 2026

  let baseLbs = 180;
  let baseFat = 22;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().split('T')[0];
    fixture[date] = {
      date,
      lbs: baseLbs,
      lbs_adjusted_average: baseLbs - 0.5, // adjusted should win when present
      fat_percent: baseFat,
      fat_percent_average: baseFat - 0.2,
      source: 'consumer-bia',
    };
    // Slow drift so averages differ across periods.
    baseLbs -= 0.05;
    baseFat -= 0.01;
  }
  return fixture;
}

const FIXTURE = buildFixture();

function makeFactory(overrides = {}) {
  const healthStore = {
    loadWeightData: vi.fn(async () => FIXTURE),
    loadNutritionData: vi.fn(async () => ({})),
    ...overrides,
  };
  return { factory: new LongitudinalToolFactory({ healthStore }), healthStore };
}

function getQueryTool(factory) {
  return factory.createTools().find(t => t.name === 'query_historical_weight');
}

function getNutritionTool(factory) {
  return factory.createTools().find(t => t.name === 'query_historical_nutrition');
}

function getWorkoutsTool(factory) {
  return factory.createTools().find(t => t.name === 'query_historical_workouts');
}

// Build a 30-day fixture anchored on a known "today" so the 14-day redaction
// boundary is deterministic. Days 0-13 are "recent" (must be redacted); days
// 14-29 are "old" (must NOT be redacted).
function buildNutritionFixture(today) {
  const data = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    data[date] = {
      calories: 2000 + i,
      protein: 100 + i,           // increasing protein for filter tests
      carbs: 200,
      fat: 70,
      fiber: 25,
      sugar: 40,
      food_items: [
        { name: i % 2 === 0 ? 'Chicken Breast' : 'Salmon Fillet', calories: 300, protein: 40 },
        { name: 'Brown Rice', calories: 200, protein: 5 },
      ],
      tags: i < 5 ? ['cut'] : ['maintenance'],
      // Note: real data shape DOES NOT include these — we synthesize them
      // to verify redaction code is in place even though it's normally a
      // no-op against loadNutritionData output today.
      implied_intake: 2100 + i,
      tracking_accuracy: 0.85,
    };
  }
  return data;
}

describe('LongitudinalToolFactory.query_historical_weight', () => {
  it('tool definition has correct schema (name, params, description)', () => {
    const { factory } = makeFactory();
    const tool = getQueryTool(factory);

    expect(tool).toBeTruthy();
    expect(tool.name).toBe('query_historical_weight');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.parameters?.type).toBe('object');
    const props = tool.parameters?.properties || {};
    expect(props.userId).toBeTruthy();
    expect(props.from).toBeTruthy();
    expect(props.to).toBeTruthy();
    expect(props.aggregation).toBeTruthy();
    // aggregation should be a constrained enum
    expect(Array.isArray(props.aggregation.enum)).toBe(true);
    expect(props.aggregation.enum).toEqual(
      expect.arrayContaining(['daily', 'weekly_avg', 'monthly_avg', 'quarterly_avg'])
    );
    expect(tool.parameters?.required).toEqual(expect.arrayContaining(['userId', 'from', 'to']));
  });

  it('daily granularity returns one row per date with lbs/fatPercent/source', async () => {
    const { factory } = makeFactory();
    const tool = getQueryTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      from: '2025-11-01',
      to: '2025-11-07',
      aggregation: 'daily',
    });

    expect(result.aggregation).toBe('daily');
    expect(Array.isArray(result.rows)).toBe(true);
    expect(result.rows.length).toBe(7);

    const first = result.rows[0];
    expect(first.date).toBe('2025-11-01');
    expect(typeof first.lbs).toBe('number');
    // Should prefer adjusted over raw lbs
    expect(first.lbs).toBeCloseTo(FIXTURE['2025-11-01'].lbs_adjusted_average, 5);
    expect(first.fatPercent).toBeCloseTo(FIXTURE['2025-11-01'].fat_percent_average, 5);
    expect(first.count).toBe(1);
    expect(first.source).toBeTruthy();
  });

  it('weekly_avg returns ≤ 1 row per ISO week with avg weight', async () => {
    const { factory } = makeFactory();
    const tool = getQueryTool(factory);

    // 14 day span — should produce 2-3 ISO-week buckets.
    const result = await tool.execute({
      userId: 'test-user',
      from: '2025-11-03', // Monday
      to: '2025-11-16',   // Sunday two weeks later
      aggregation: 'weekly_avg',
    });

    expect(result.aggregation).toBe('weekly_avg');
    expect(Array.isArray(result.rows)).toBe(true);
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    expect(result.rows.length).toBeLessThanOrEqual(3);

    for (const row of result.rows) {
      expect(row.period).toMatch(/^\d{4}-W\d{2}$/);
      expect(typeof row.lbs).toBe('number');
      expect(typeof row.fatPercent).toBe('number');
      expect(row.count).toBeGreaterThan(0);
      expect(row.count).toBeLessThanOrEqual(7);
    }

    // No two rows share the same period
    const periods = result.rows.map(r => r.period);
    expect(new Set(periods).size).toBe(periods.length);
  });

  it('monthly_avg returns one row per YYYY-MM with avg weight + count', async () => {
    const { factory } = makeFactory();
    const tool = getQueryTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      from: '2025-11-01',
      to: '2026-01-31',
      aggregation: 'monthly_avg',
    });

    expect(result.aggregation).toBe('monthly_avg');
    const periods = result.rows.map(r => r.period);
    expect(periods).toEqual(['2025-11', '2025-12', '2026-01']);

    const nov = result.rows.find(r => r.period === '2025-11');
    expect(nov.count).toBe(30);
    expect(typeof nov.lbs).toBe('number');
    expect(typeof nov.fatPercent).toBe('number');

    const dec = result.rows.find(r => r.period === '2025-12');
    expect(dec.count).toBe(31);

    // Average for Nov should equal mean of all daily adjusted lbs in Nov
    const novDates = Object.keys(FIXTURE).filter(d => d.startsWith('2025-11'));
    const expectedAvg =
      novDates.reduce((s, d) => s + FIXTURE[d].lbs_adjusted_average, 0) / novDates.length;
    expect(nov.lbs).toBeCloseTo(expectedAvg, 4);
  });

  it('quarterly_avg returns one row per YYYY-Qn', async () => {
    const { factory } = makeFactory();
    const tool = getQueryTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      from: '2025-11-01',
      to: '2026-02-28',
      aggregation: 'quarterly_avg',
    });

    expect(result.aggregation).toBe('quarterly_avg');
    const periods = result.rows.map(r => r.period);
    // Nov-Dec 2025 = Q4; Jan-Feb 2026 = Q1
    expect(periods).toEqual(['2025-Q4', '2026-Q1']);

    const q4 = result.rows.find(r => r.period === '2025-Q4');
    expect(q4.count).toBe(30 + 31); // Nov + Dec
    expect(typeof q4.lbs).toBe('number');

    const q1 = result.rows.find(r => r.period === '2026-Q1');
    expect(q1.count).toBe(31 + 28); // Jan + Feb
  });

  it('respects from/to bounds (inclusive)', async () => {
    const { factory } = makeFactory();
    const tool = getQueryTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      from: '2025-11-05',
      to: '2025-11-09',
      aggregation: 'daily',
    });

    expect(result.rows.length).toBe(5);
    expect(result.rows[0].date).toBe('2025-11-05');
    expect(result.rows[result.rows.length - 1].date).toBe('2025-11-09');
  });

  it('returns empty array for empty range', async () => {
    const { factory } = makeFactory();
    const tool = getQueryTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      from: '2030-01-01',
      to: '2030-01-31',
      aggregation: 'daily',
    });

    expect(result.aggregation).toBe('daily');
    expect(Array.isArray(result.rows)).toBe(true);
    expect(result.rows.length).toBe(0);
  });
});

describe('LongitudinalToolFactory.query_historical_nutrition', () => {
  // Anchor "today" so the 14-day redaction boundary is deterministic across
  // test runs. We freeze the system clock with vi.useFakeTimers / setSystemTime.
  const TODAY = new Date(Date.UTC(2026, 4, 1)); // 2026-05-01
  const todayStr = TODAY.toISOString().slice(0, 10);
  const NUTRITION_FIXTURE = buildNutritionFixture(TODAY);

  // helper: date string i days before TODAY
  const daysAgo = (i) => {
    const d = new Date(TODAY);
    d.setUTCDate(d.getUTCDate() - i);
    return d.toISOString().slice(0, 10);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeNutritionFactory(overrides = {}) {
    const healthStore = {
      loadWeightData: vi.fn(async () => FIXTURE),
      loadNutritionData: vi.fn(async () => NUTRITION_FIXTURE),
      ...overrides,
    };
    return { factory: new LongitudinalToolFactory({ healthStore }), healthStore };
  }

  it('tool definition has correct schema', () => {
    const { factory } = makeNutritionFactory();
    const tool = getNutritionTool(factory);

    expect(tool).toBeTruthy();
    expect(tool.name).toBe('query_historical_nutrition');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.parameters?.type).toBe('object');
    const props = tool.parameters?.properties || {};
    expect(props.userId).toBeTruthy();
    expect(props.from).toBeTruthy();
    expect(props.to).toBeTruthy();
    expect(props.fields).toBeTruthy();
    expect(props.filter).toBeTruthy();
    expect(tool.parameters?.required).toEqual(expect.arrayContaining(['userId', 'from', 'to']));
  });

  it('query_historical_nutrition returns per-day calories/protein/carbs/fat', async () => {
    const { factory } = makeNutritionFactory();
    const tool = getNutritionTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      from: daysAgo(20),
      to: daysAgo(15),
    });

    expect(Array.isArray(result.days)).toBe(true);
    expect(result.days.length).toBe(6); // inclusive: 20..15 = 6 days

    for (const day of result.days) {
      expect(typeof day.date).toBe('string');
      expect(typeof day.calories).toBe('number');
      expect(typeof day.protein).toBe('number');
      expect(typeof day.carbs).toBe('number');
      expect(typeof day.fat).toBe('number');
    }
  });

  it('respects from/to bounds inclusive', async () => {
    const { factory } = makeNutritionFactory();
    const tool = getNutritionTool(factory);

    const from = daysAgo(20);
    const to = daysAgo(18);
    const result = await tool.execute({
      userId: 'test-user',
      from,
      to,
    });

    const dates = result.days.map(d => d.date).sort();
    expect(dates.length).toBe(3);
    expect(dates[0]).toBe(from);
    expect(dates[dates.length - 1]).toBe(to);
    // Every returned date is within [from, to]
    for (const d of dates) {
      expect(d >= from).toBe(true);
      expect(d <= to).toBe(true);
    }
  });

  it('filter.protein_min returns only days where protein >= threshold', async () => {
    const { factory } = makeNutritionFactory();
    const tool = getNutritionTool(factory);

    // Across the whole 30-day window, protein values are 100..129.
    // Threshold of 120 should keep days where protein >= 120.
    const result = await tool.execute({
      userId: 'test-user',
      from: daysAgo(29),
      to: todayStr,
      filter: { protein_min: 120 },
    });

    expect(result.days.length).toBeGreaterThan(0);
    for (const day of result.days) {
      expect(day.protein).toBeGreaterThanOrEqual(120);
    }
  });

  it('filter.contains_food returns only days whose food_items[].name contains substring (case-insensitive)', async () => {
    const { factory } = makeNutritionFactory();
    const tool = getNutritionTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      from: daysAgo(29),
      to: todayStr,
      filter: { contains_food: 'salmon' }, // lowercase, fixture has 'Salmon Fillet'
    });

    expect(result.days.length).toBeGreaterThan(0);
    for (const day of result.days) {
      const names = (day.food_items || []).map(f => f.name.toLowerCase());
      expect(names.some(n => n.includes('salmon'))).toBe(true);
    }

    // And there should be days WITHOUT salmon in the original fixture
    // (every other day has Chicken Breast). Sanity-check we filtered something out.
    const allDays = await tool.execute({
      userId: 'test-user',
      from: daysAgo(29),
      to: todayStr,
    });
    expect(result.days.length).toBeLessThan(allDays.days.length);
  });

  it('redacts implied_intake and tracking_accuracy fields for days less than 14 days old', async () => {
    const { factory } = makeNutritionFactory();
    const tool = getNutritionTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      from: daysAgo(13),
      to: todayStr,
    });

    expect(result.days.length).toBe(14); // 0..13 inclusive
    for (const day of result.days) {
      expect(day).not.toHaveProperty('implied_intake');
      expect(day).not.toHaveProperty('tracking_accuracy');
    }
  });

  it('does NOT redact those fields for days 14+ days old', async () => {
    const { factory } = makeNutritionFactory();
    const tool = getNutritionTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      from: daysAgo(29),
      to: daysAgo(14),
    });

    expect(result.days.length).toBe(16); // 14..29 inclusive
    // Fixture synthesizes these fields; mature days should retain them.
    for (const day of result.days) {
      expect(day).toHaveProperty('implied_intake');
      expect(day).toHaveProperty('tracking_accuracy');
    }
  });
});

// -------------------------------------------------------------------
// query_historical_workouts (F-103.3)
// -------------------------------------------------------------------
//
// Reads workouts from healthService.getHealthForRange(userId, from, to),
// which returns a date-keyed object: { 'YYYY-MM-DD': { workouts: [...] } }.
// Mirrors HealthToolFactory.get_recent_workouts data shape but accepts
// explicit from/to bounds (rather than days-ago) and supports filters.

function buildWorkoutsFixture() {
  // Build a small, deliberate fixture so filter behavior is unambiguous.
  return {
    '2026-04-01': {
      workouts: [
        { title: 'Morning Run', type: 'run', duration: 1800, calories: 300, avgHr: 150 },
      ],
    },
    '2026-04-02': {
      workouts: [
        { title: 'Bench Press Session', type: 'strength', duration: 2400, calories: 250, avgHr: 110 },
        { title: 'Easy Recovery Run', type: 'run', duration: 1200, calories: 180, avgHr: 130 },
      ],
    },
    '2026-04-03': {
      workouts: [
        { title: 'Yoga Flow', type: 'yoga', duration: 3000, calories: 150, avgHr: 95 },
      ],
    },
    // Day with no workouts at all.
    '2026-04-04': { workouts: [] },
    '2026-04-05': {
      workouts: [
        { title: 'Hill Sprints', type: 'run', duration: 1500, calories: 280, avgHr: 165 },
      ],
    },
    '2026-04-06': {
      workouts: [
        // Use `name` instead of `title` to verify name_contains falls back.
        { name: 'Long bike ride along the coast', type: 'ride', duration: 5400, calories: 700, avgHr: 140 },
      ],
    },
  };
}

describe('LongitudinalToolFactory.query_historical_workouts', () => {
  function makeWorkoutsFactory(workoutsFixture, overrides = {}) {
    const healthStore = {
      loadWeightData: vi.fn(async () => FIXTURE),
      loadNutritionData: vi.fn(async () => ({})),
    };
    const healthService = {
      getHealthForRange: vi.fn(async (userId, from, to) => {
        const out = {};
        for (const [date, value] of Object.entries(workoutsFixture)) {
          if (date >= from && date <= to) out[date] = value;
        }
        return out;
      }),
      ...overrides,
    };
    return {
      factory: new LongitudinalToolFactory({ healthStore, healthService }),
      healthStore,
      healthService,
    };
  }

  it('tool definition has correct schema', () => {
    const { factory } = makeWorkoutsFactory(buildWorkoutsFixture());
    const tool = getWorkoutsTool(factory);

    expect(tool).toBeTruthy();
    expect(tool.name).toBe('query_historical_workouts');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.parameters?.type).toBe('object');
    const props = tool.parameters?.properties || {};
    expect(props.userId).toBeTruthy();
    expect(props.from).toBeTruthy();
    expect(props.to).toBeTruthy();
    expect(props.type).toBeTruthy();
    expect(props.name_contains).toBeTruthy();
    expect(tool.parameters?.required).toEqual(expect.arrayContaining(['userId', 'from', 'to']));
  });

  it('query_historical_workouts returns workouts in the requested date range', async () => {
    const { factory, healthService } = makeWorkoutsFactory(buildWorkoutsFixture());
    const tool = getWorkoutsTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      from: '2026-04-01',
      to: '2026-04-06',
    });

    expect(healthService.getHealthForRange).toHaveBeenCalledWith('test-user', '2026-04-01', '2026-04-06');
    expect(Array.isArray(result.workouts)).toBe(true);
    // Fixture has 1+2+1+0+1+1 = 6 workouts.
    expect(result.workouts.length).toBe(6);

    // Each workout should expose date + canonical fields.
    for (const w of result.workouts) {
      expect(typeof w.date).toBe('string');
      expect(typeof w.type).toBe('string');
      // duration / calories / avgHr come straight from the source.
      expect(typeof w.duration).toBe('number');
    }

    // Sorted by date ascending.
    const dates = result.workouts.map(w => w.date);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });

  it('filter by type returns only matching workouts (e.g. type=run)', async () => {
    const { factory } = makeWorkoutsFactory(buildWorkoutsFixture());
    const tool = getWorkoutsTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      from: '2026-04-01',
      to: '2026-04-06',
      type: 'run',
    });

    // Three runs: Morning Run (4-01), Easy Recovery Run (4-02), Hill Sprints (4-05).
    expect(result.workouts.length).toBe(3);
    for (const w of result.workouts) {
      expect(w.type).toBe('run');
    }
  });

  it('filter by name_contains returns only workouts whose title/name contains substring (case-insensitive)', async () => {
    const { factory } = makeWorkoutsFactory(buildWorkoutsFixture());
    const tool = getWorkoutsTool(factory);

    // Search for 'run' (case-insensitive). Should match Morning Run, Easy Recovery Run, Hill Sprints? No — Hill Sprints has no 'run' substring. Match Morning Run, Easy Recovery Run only.
    const result = await tool.execute({
      userId: 'test-user',
      from: '2026-04-01',
      to: '2026-04-06',
      name_contains: 'RUN',
    });

    expect(result.workouts.length).toBe(2);
    for (const w of result.workouts) {
      const label = (w.title || w.name || '').toLowerCase();
      expect(label.includes('run')).toBe(true);
    }

    // Verify name fallback: query for 'bike' should match the 4-06 workout
    // which only has `name`, not `title`.
    const bikeResult = await tool.execute({
      userId: 'test-user',
      from: '2026-04-01',
      to: '2026-04-06',
      name_contains: 'bike',
    });
    expect(bikeResult.workouts.length).toBe(1);
    expect(bikeResult.workouts[0].date).toBe('2026-04-06');
  });

  it('respects from/to bounds', async () => {
    const { factory, healthService } = makeWorkoutsFactory(buildWorkoutsFixture());
    const tool = getWorkoutsTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      from: '2026-04-02',
      to: '2026-04-03',
    });

    expect(healthService.getHealthForRange).toHaveBeenCalledWith('test-user', '2026-04-02', '2026-04-03');
    // Apr 2 has 2 workouts, Apr 3 has 1 — total 3.
    expect(result.workouts.length).toBe(3);
    for (const w of result.workouts) {
      expect(w.date >= '2026-04-02').toBe(true);
      expect(w.date <= '2026-04-03').toBe(true);
    }
  });

  it('returns empty array for empty range', async () => {
    const { factory } = makeWorkoutsFactory(buildWorkoutsFixture());
    const tool = getWorkoutsTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      from: '2030-01-01',
      to: '2030-01-31',
    });

    expect(Array.isArray(result.workouts)).toBe(true);
    expect(result.workouts.length).toBe(0);
  });
});

// -------------------------------------------------------------------
// query_named_period (F-103.4)
// -------------------------------------------------------------------
//
// Convenience wrapper. Looks up a named period from the user's playbook
// (PersonalContextLoader.loadPlaybook) and runs the underlying weight,
// nutrition, and workout queries against the period's [from, to] range.

function getNamedPeriodTool(factory) {
  return factory.createTools().find(t => t.name === 'query_named_period');
}

function buildPlaybook(periods) {
  return {
    schema_version: 1,
    named_periods: periods,
  };
}

describe('LongitudinalToolFactory.query_named_period', () => {
  // Use a deterministic weight + nutrition + workouts fixture spanning the
  // playbook's fixture-cut-2024 period (2024-02-01 → 2024-04-30).
  function buildPeriodWeightFixture() {
    const out = {};
    let lbs = 200;
    const start = new Date(Date.UTC(2024, 1, 1)); // Feb 1, 2024
    const end = new Date(Date.UTC(2024, 3, 30));  // Apr 30, 2024
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      out[date] = {
        date,
        lbs,
        lbs_adjusted_average: lbs - 0.5,
        fat_percent: 22,
        fat_percent_average: 21.5,
        source: 'consumer-bia',
      };
      lbs -= 0.05;
    }
    return out;
  }

  function buildPeriodNutritionFixture() {
    const out = {};
    const start = new Date(Date.UTC(2024, 1, 1));
    const end = new Date(Date.UTC(2024, 3, 30));
    let i = 0;
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      out[date] = {
        calories: 1800 + (i % 5),
        protein: 145,
        carbs: 180,
        fat: 60,
      };
      i++;
    }
    return out;
  }

  function buildPeriodWorkoutsFixture() {
    return {
      '2024-02-15': { workouts: [{ title: 'Tempo Run', type: 'run', duration: 1800, calories: 350, avgHr: 155 }] },
      '2024-03-10': { workouts: [{ title: 'Long Run', type: 'run', duration: 5400, calories: 800, avgHr: 145 }] },
      '2024-04-20': { workouts: [{ title: 'Strength A', type: 'strength', duration: 2400, calories: 220, avgHr: 110 }] },
      // Outside the period — must NOT be returned.
      '2024-05-15': { workouts: [{ title: 'Outside Period Run', type: 'run', duration: 1800, calories: 300, avgHr: 150 }] },
    };
  }

  function makeNamedPeriodFactory(playbookByUser, overrides = {}) {
    const weightFixture = overrides.weightFixture ?? buildPeriodWeightFixture();
    const nutritionFixture = overrides.nutritionFixture ?? buildPeriodNutritionFixture();
    const workoutsFixture = overrides.workoutsFixture ?? buildPeriodWorkoutsFixture();

    const healthStore = {
      loadWeightData: vi.fn(async () => weightFixture),
      loadNutritionData: vi.fn(async () => nutritionFixture),
    };
    const healthService = {
      getHealthForRange: vi.fn(async (userId, from, to) => {
        const out = {};
        for (const [date, value] of Object.entries(workoutsFixture)) {
          if (date >= from && date <= to) out[date] = value;
        }
        return out;
      }),
    };
    const personalContextLoader = {
      loadPlaybook: vi.fn(async (userId) => playbookByUser[userId] ?? null),
    };
    return {
      factory: new LongitudinalToolFactory({ healthStore, healthService, personalContextLoader }),
      healthStore,
      healthService,
      personalContextLoader,
    };
  }

  it('tool definition has correct schema', () => {
    const { factory } = makeNamedPeriodFactory({
      'test-user': buildPlaybook({
        'fixture-cut-2024': {
          from: '2024-02-01',
          to: '2024-04-30',
          description: 'Sample cut period.',
        },
      }),
    });
    const tool = getNamedPeriodTool(factory);

    expect(tool).toBeTruthy();
    expect(tool.name).toBe('query_named_period');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.parameters?.type).toBe('object');
    const props = tool.parameters?.properties || {};
    expect(props.userId).toBeTruthy();
    expect(props.name).toBeTruthy();
    expect(tool.parameters?.required).toEqual(expect.arrayContaining(['userId', 'name']));
  });

  it('query_named_period returns aggregated stats for the named period range', async () => {
    const playbook = buildPlaybook({
      'fixture-cut-2024': {
        from: '2024-02-01',
        to: '2024-04-30',
        description: 'Sample cut period for similar-period tests.',
      },
    });
    const { factory, healthService } = makeNamedPeriodFactory({ 'test-user': playbook });
    const tool = getNamedPeriodTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      name: 'fixture-cut-2024',
    });

    // Period metadata
    expect(result.name).toBe('fixture-cut-2024');
    expect(result.from).toBe('2024-02-01');
    expect(result.to).toBe('2024-04-30');
    expect(typeof result.description).toBe('string');
    expect(result.description.length).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();

    // Weight: weekly_avg aggregation
    expect(result.weight).toBeTruthy();
    expect(result.weight.aggregation).toBe('weekly_avg');
    expect(Array.isArray(result.weight.rows)).toBe(true);
    expect(result.weight.rows.length).toBeGreaterThan(0);
    for (const row of result.weight.rows) {
      expect(row.period).toMatch(/^\d{4}-W\d{2}$/);
      expect(typeof row.lbs).toBe('number');
    }

    // Nutrition: all days inside the period
    expect(result.nutrition).toBeTruthy();
    expect(Array.isArray(result.nutrition.days)).toBe(true);
    // Feb 1 → Apr 30 = 29 + 31 + 30 = 90 days
    expect(result.nutrition.days.length).toBe(90);
    for (const day of result.nutrition.days) {
      expect(day.date >= '2024-02-01').toBe(true);
      expect(day.date <= '2024-04-30').toBe(true);
    }

    // Workouts: all 3 inside the period (the May 15 one is filtered out)
    expect(Array.isArray(result.workouts)).toBe(true);
    expect(result.workouts.length).toBe(3);
    for (const w of result.workouts) {
      expect(w.date >= '2024-02-01').toBe(true);
      expect(w.date <= '2024-04-30').toBe(true);
    }

    // Verify the underlying healthService was called with the period bounds
    expect(healthService.getHealthForRange).toHaveBeenCalledWith(
      'test-user', '2024-02-01', '2024-04-30',
    );
  });

  it('unknown period name returns { error, name } without throwing', async () => {
    const playbook = buildPlaybook({
      'fixture-cut-2024': { from: '2024-02-01', to: '2024-04-30', description: 'cut' },
    });
    const { factory, healthStore, healthService } = makeNamedPeriodFactory({
      'test-user': playbook,
    });
    const tool = getNamedPeriodTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      name: 'does-not-exist',
    });

    expect(result.name).toBe('does-not-exist');
    expect(typeof result.error).toBe('string');
    expect(result.error).toMatch(/not found/i);

    // Should NOT have invoked the underlying queries.
    expect(healthStore.loadWeightData).not.toHaveBeenCalled();
    expect(healthStore.loadNutritionData).not.toHaveBeenCalled();
    expect(healthService.getHealthForRange).not.toHaveBeenCalled();
  });

  it('respects user-namespaced playbook (different userId, different periods)', async () => {
    // user-A has 'cut-A', user-B has 'cut-B'. Each lookup must isolate.
    const playbookByUser = {
      'user-A': buildPlaybook({
        'cut-A': { from: '2024-02-01', to: '2024-02-29', description: 'A cut' },
      }),
      'user-B': buildPlaybook({
        'cut-B': { from: '2024-03-01', to: '2024-03-31', description: 'B cut' },
      }),
    };
    const { factory, personalContextLoader } = makeNamedPeriodFactory(playbookByUser);
    const tool = getNamedPeriodTool(factory);

    const aResult = await tool.execute({ userId: 'user-A', name: 'cut-A' });
    expect(aResult.error).toBeUndefined();
    expect(aResult.from).toBe('2024-02-01');
    expect(aResult.to).toBe('2024-02-29');

    // user-A doesn't have 'cut-B' — even though user-B does.
    const aMiss = await tool.execute({ userId: 'user-A', name: 'cut-B' });
    expect(aMiss.error).toMatch(/not found/i);

    const bResult = await tool.execute({ userId: 'user-B', name: 'cut-B' });
    expect(bResult.error).toBeUndefined();
    expect(bResult.from).toBe('2024-03-01');
    expect(bResult.to).toBe('2024-03-31');

    expect(personalContextLoader.loadPlaybook).toHaveBeenCalledWith('user-A');
    expect(personalContextLoader.loadPlaybook).toHaveBeenCalledWith('user-B');
  });
});

// -------------------------------------------------------------------
// read_notes_file (F-102)
// -------------------------------------------------------------------
//
// Reads markdown from data/users/{userId}/lifelog/archives/notes/*.md
// and YAML from data/users/{userId}/lifelog/archives/scans/*.yml.
// Section extraction by markdown anchor. Per-execution cache.

function getReadNotesTool(factory) {
  return factory.createTools().find(t => t.name === 'read_notes_file');
}

describe('LongitudinalToolFactory.read_notes_file', () => {
  // Build a stub archiveScope whose `assertReadable` is a no-op for valid
  // inputs (anything starting with /fake/data/users/{userId}/lifelog/archives/)
  // and throws for inputs that don't match. This isolates the tool's CALL
  // pattern from the scope's whitelist internals (covered by Task 11 tests).
  function makeReadNotesFactory({
    fileContents = {},
    dataRoot = '/fake/data',
    archiveScopeOverride = null,
  } = {}) {
    const fs = {
      readFile: vi.fn(async (absPath /*, encoding */) => {
        if (absPath in fileContents) return fileContents[absPath];
        const err = new Error(`ENOENT: no such file: ${absPath}`);
        err.code = 'ENOENT';
        throw err;
      }),
    };
    const archiveScope = archiveScopeOverride ?? {
      assertReadable: vi.fn((absPath, userId) => {
        const expectedPrefix = `${dataRoot}/users/${userId}/lifelog/archives/`;
        if (typeof absPath !== 'string' || !absPath.startsWith(expectedPrefix)) {
          throw new Error(`HealthArchiveScope: path not readable for user ${userId}: ${absPath}`);
        }
      }),
    };
    const healthStore = {
      loadWeightData: vi.fn(async () => ({})),
      loadNutritionData: vi.fn(async () => ({})),
    };
    return {
      factory: new LongitudinalToolFactory({
        healthStore,
        archiveScope,
        fs,
        dataRoot,
      }),
      fs,
      archiveScope,
    };
  }

  const SAMPLE_MD = [
    '# Title',
    '',
    '## Section A',
    'content A',
    '',
    '## Section B',
    'content B',
    '',
    '### Subsection B1',
    'sub content',
    '',
    '## Section C',
    'content C',
    '',
  ].join('\n');

  const SAMPLE_YAML = [
    'date: 2024-01-15',
    'source: bodyspec_dexa',
    'weight_lbs: 175.0',
    'body_fat_percent: 22.0',
  ].join('\n');

  it('tool definition has correct schema', () => {
    const { factory } = makeReadNotesFactory();
    const tool = getReadNotesTool(factory);

    expect(tool).toBeTruthy();
    expect(tool.name).toBe('read_notes_file');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.parameters?.type).toBe('object');
    const props = tool.parameters?.properties || {};
    expect(props.userId).toBeTruthy();
    expect(props.filename).toBeTruthy();
    expect(props.section).toBeTruthy();
    expect(tool.parameters?.required).toEqual(expect.arrayContaining(['userId', 'filename']));
  });

  it('reads full markdown file from notes/', async () => {
    const absPath = '/fake/data/users/test-user/lifelog/archives/notes/strength-plateau.md';
    const { factory, fs, archiveScope } = makeReadNotesFactory({
      fileContents: { [absPath]: SAMPLE_MD },
    });
    const tool = getReadNotesTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      filename: 'notes/strength-plateau.md',
    });

    expect(result.error).toBeUndefined();
    expect(result.filename).toBe('notes/strength-plateau.md');
    expect(result.content).toBe(SAMPLE_MD);
    expect(archiveScope.assertReadable).toHaveBeenCalledWith(absPath, 'test-user');
    expect(fs.readFile).toHaveBeenCalledWith(absPath, 'utf8');
  });

  it('reads YAML file from scans/', async () => {
    const absPath = '/fake/data/users/test-user/lifelog/archives/scans/2024-01-15-dexa.yml';
    const { factory, fs, archiveScope } = makeReadNotesFactory({
      fileContents: { [absPath]: SAMPLE_YAML },
    });
    const tool = getReadNotesTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      filename: 'scans/2024-01-15-dexa.yml',
    });

    expect(result.error).toBeUndefined();
    expect(result.filename).toBe('scans/2024-01-15-dexa.yml');
    expect(result.content).toBe(SAMPLE_YAML);
    expect(archiveScope.assertReadable).toHaveBeenCalledWith(absPath, 'test-user');
    expect(fs.readFile).toHaveBeenCalledWith(absPath, 'utf8');
  });

  it('reads by markdown section anchor — returns content under heading until next heading at same or higher level', async () => {
    const absPath = '/fake/data/users/test-user/lifelog/archives/notes/strength-plateau.md';
    const { factory } = makeReadNotesFactory({
      fileContents: { [absPath]: SAMPLE_MD },
    });
    const tool = getReadNotesTool(factory);

    // Section A: terminated by ## Section B (same level h2).
    const a = await tool.execute({
      userId: 'test-user',
      filename: 'notes/strength-plateau.md',
      section: 'Section A',
    });
    expect(a.error).toBeUndefined();
    expect(a.section).toBe('Section A');
    expect(a.content.trim()).toBe('content A');

    // Section B: includes its h3 subsection but stops at ## Section C.
    const b = await tool.execute({
      userId: 'test-user',
      filename: 'notes/strength-plateau.md',
      section: 'Section B',
    });
    expect(b.error).toBeUndefined();
    expect(b.section).toBe('Section B');
    expect(b.content).toContain('content B');
    expect(b.content).toContain('### Subsection B1');
    expect(b.content).toContain('sub content');
    expect(b.content).not.toContain('Section C');
    expect(b.content).not.toContain('content C');

    // Missing section returns structured error, not throw.
    const missing = await tool.execute({
      userId: 'test-user',
      filename: 'notes/strength-plateau.md',
      section: 'Nonexistent',
    });
    expect(missing.error).toMatch(/section not found/i);
    expect(missing.section).toBe('Nonexistent');
  });

  it('rejects paths outside notes/ and scans/ subtrees', async () => {
    const { factory } = makeReadNotesFactory();
    const tool = getReadNotesTool(factory);

    // playbook is whitelisted for the SCOPE but not by THIS tool's contract.
    const result = await tool.execute({
      userId: 'test-user',
      filename: 'playbook/named_periods.yml',
    });
    expect(typeof result.error).toBe('string');
    expect(result.error).toMatch(/notes\/|scans\//);
  });

  it('rejects path traversal in filename param', async () => {
    const { factory, archiveScope } = makeReadNotesFactory();
    const tool = getReadNotesTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      filename: '../../../etc/passwd',
    });
    expect(typeof result.error).toBe('string');
    // Traversal must be caught before any read-scope or fs touch.
    expect(archiveScope.assertReadable).not.toHaveBeenCalled();
  });

  it('uses archiveScopeFactory.forUser(userId) when provided (F4-A)', async () => {
    const absPath = '/fake/data/users/test-user/lifelog/archives/notes/file.md';
    const SAMPLE = '# hello\nbody';
    const fs = {
      readFile: vi.fn(async (p) => {
        if (p === absPath) return SAMPLE;
        const err = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      }),
    };
    const perUserScope = {
      assertReadable: vi.fn(() => {}),
    };
    const archiveScopeFactory = {
      forUser: vi.fn(async () => perUserScope),
    };
    const healthStore = {
      loadWeightData: vi.fn(async () => ({})),
      loadNutritionData: vi.fn(async () => ({})),
    };
    const factory = new LongitudinalToolFactory({
      healthStore,
      archiveScopeFactory,
      fs,
      dataRoot: '/fake/data',
    });
    const tool = factory.createTools().find(t => t.name === 'read_notes_file');

    const result = await tool.execute({
      userId: 'test-user',
      filename: 'notes/file.md',
    });

    expect(result.error).toBeUndefined();
    expect(result.content).toBe(SAMPLE);
    expect(archiveScopeFactory.forUser).toHaveBeenCalledWith('test-user');
    expect(perUserScope.assertReadable).toHaveBeenCalledWith(absPath, 'test-user');
  });

  it('caches the same filename across calls within a single createTools() call', async () => {
    const absPath = '/fake/data/users/test-user/lifelog/archives/notes/strength-plateau.md';
    const fileContents = { [absPath]: SAMPLE_MD };
    const fs = {
      readFile: vi.fn(async (p) => fileContents[p]),
    };
    const archiveScope = {
      assertReadable: vi.fn(() => {}),
    };
    const healthStore = {
      loadWeightData: vi.fn(async () => ({})),
      loadNutritionData: vi.fn(async () => ({})),
    };
    const factory = new LongitudinalToolFactory({
      healthStore, archiveScope, fs, dataRoot: '/fake/data',
    });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'read_notes_file');

    // First call — reads from disk.
    const r1 = await tool.execute({ userId: 'test-user', filename: 'notes/strength-plateau.md' });
    expect(r1.content).toBe(SAMPLE_MD);
    expect(fs.readFile).toHaveBeenCalledTimes(1);

    // Second call — same filename, no section: cache hit.
    const r2 = await tool.execute({ userId: 'test-user', filename: 'notes/strength-plateau.md' });
    expect(r2.content).toBe(SAMPLE_MD);
    expect(fs.readFile).toHaveBeenCalledTimes(1);

    // Different section — different cache key, but section extraction does NOT
    // need a new disk read if implementation caches the raw file too. The
    // contract here is that fs.readFile should not be called again — section
    // extraction is in-memory.
    const r3 = await tool.execute({
      userId: 'test-user', filename: 'notes/strength-plateau.md', section: 'Section A',
    });
    expect(r3.content.trim()).toBe('content A');
    expect(fs.readFile).toHaveBeenCalledTimes(1);

    // A FRESH createTools() call gets a fresh cache.
    const tools2 = factory.createTools();
    const tool2 = tools2.find(t => t.name === 'read_notes_file');
    await tool2.execute({ userId: 'test-user', filename: 'notes/strength-plateau.md' });
    expect(fs.readFile).toHaveBeenCalledTimes(2);
  });
});

// -------------------------------------------------------------------
// find_similar_period (F-104)
// -------------------------------------------------------------------
//
// Loads the user's playbook via PersonalContextLoader, aggregates stats
// for each named period from weight + nutrition + workout data sources,
// then delegates ranking to the injected SimilarPeriodFinder.

function getFindSimilarTool(factory) {
  return factory.createTools().find(t => t.name === 'find_similar_period');
}

describe('LongitudinalToolFactory.find_similar_period', () => {
  // Fixture period 1: fixture-cut-2024 (Feb 1 → Apr 30, 2024)
  // Fixture period 2: rebound-2024 (May 1 → May 31, 2024)
  function buildSimilarWeightFixture() {
    const out = {};
    // Cut period: 200 lbs → drops slowly to ~195
    let lbs = 200;
    let start = new Date(Date.UTC(2024, 1, 1));
    let end = new Date(Date.UTC(2024, 3, 30));
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      out[date] = {
        date,
        lbs,
        lbs_adjusted_average: lbs,
        fat_percent: 22,
        fat_percent_average: 22,
        source: 'consumer-bia',
      };
      lbs -= 0.05;
    }
    // Rebound: 195 → 198
    lbs = 195;
    start = new Date(Date.UTC(2024, 4, 1));
    end = new Date(Date.UTC(2024, 4, 31));
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      out[date] = {
        date,
        lbs,
        lbs_adjusted_average: lbs,
        fat_percent: 23,
        fat_percent_average: 23,
        source: 'consumer-bia',
      };
      lbs += 0.1;
    }
    return out;
  }

  function buildSimilarNutritionFixture() {
    const out = {};
    // Cut period — 90 days, all logged, protein 145, calories 1800
    let start = new Date(Date.UTC(2024, 1, 1));
    let end = new Date(Date.UTC(2024, 3, 30));
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      out[date] = {
        calories: 1800,
        protein: 145,
        carbs: 180,
        fat: 60,
      };
    }
    // Rebound period — only 16/31 days logged (tracking_rate ~ 0.516)
    start = new Date(Date.UTC(2024, 4, 1));
    end = new Date(Date.UTC(2024, 4, 16));
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      out[date] = {
        calories: 2400,
        protein: 110,
        carbs: 280,
        fat: 90,
      };
    }
    return out;
  }

  function buildSimilarPlaybook() {
    return {
      schema_version: 1,
      named_periods: {
        'fixture-cut-2024': {
          from: '2024-02-01',
          to: '2024-04-30',
          description: 'Sample 90-day cut.',
        },
        'rebound-2024': {
          from: '2024-05-01',
          to: '2024-05-31',
          description: 'Maintenance bounce after the cut.',
        },
      },
    };
  }

  function makeSimilarFactory({
    playbookByUser = null,
    weightFixture = null,
    nutritionFixture = null,
    workoutsFixture = {},
    similarPeriodFinder = null,
  } = {}) {
    const wFix = weightFixture ?? buildSimilarWeightFixture();
    const nFix = nutritionFixture ?? buildSimilarNutritionFixture();
    const playbooks = playbookByUser ?? { 'test-user': buildSimilarPlaybook() };

    const healthStore = {
      loadWeightData: vi.fn(async () => wFix),
      loadNutritionData: vi.fn(async () => nFix),
    };
    const healthService = {
      getHealthForRange: vi.fn(async (userId, from, to) => {
        const out = {};
        for (const [date, value] of Object.entries(workoutsFixture)) {
          if (date >= from && date <= to) out[date] = value;
        }
        return out;
      }),
    };
    const personalContextLoader = {
      loadPlaybook: vi.fn(async (userId) => playbooks[userId] ?? null),
    };
    const finder = similarPeriodFinder ?? {
      findSimilar: vi.fn(({ signature, periods, maxResults }) => {
        // Default: return periods in input order, fixed score.
        return (periods || []).slice(0, maxResults || 3).map((p, idx) => ({
          name: p.name,
          score: 0.9 - (idx * 0.1),
          dimensionScores: { weight_avg_lbs: 0.9, protein_avg_g: 0.85 },
          period: p,
        }));
      }),
    };
    return {
      factory: new LongitudinalToolFactory({
        healthStore,
        healthService,
        personalContextLoader,
        similarPeriodFinder: finder,
      }),
      healthStore,
      healthService,
      personalContextLoader,
      similarPeriodFinder: finder,
    };
  }

  it('tool definition has correct schema', () => {
    const { factory } = makeSimilarFactory();
    const tool = getFindSimilarTool(factory);

    expect(tool).toBeTruthy();
    expect(tool.name).toBe('find_similar_period');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.parameters?.type).toBe('object');
    const props = tool.parameters?.properties || {};
    expect(props.userId).toBeTruthy();
    expect(props.pattern_signature).toBeTruthy();
    expect(props.max_results).toBeTruthy();
    expect(tool.parameters?.required).toEqual(
      expect.arrayContaining(['userId', 'pattern_signature']),
    );
  });

  it('delegates to SimilarPeriodFinder with playbook periods + injected signature', async () => {
    const { factory, similarPeriodFinder } = makeSimilarFactory();
    const tool = getFindSimilarTool(factory);

    const signature = {
      weight_avg_lbs: 197,
      weight_delta_lbs: -1.5,
      protein_avg_g: 140,
      calorie_avg: 1850,
      tracking_rate: 0.95,
    };

    const result = await tool.execute({
      userId: 'test-user',
      pattern_signature: signature,
    });

    expect(result.error).toBeUndefined();
    expect(similarPeriodFinder.findSimilar).toHaveBeenCalledTimes(1);
    const call = similarPeriodFinder.findSimilar.mock.calls[0][0];
    expect(call.signature).toEqual(signature);
    expect(Array.isArray(call.periods)).toBe(true);
    // Both playbook periods should have been forwarded with computed stats.
    expect(call.periods.length).toBe(2);
    const names = call.periods.map(p => p.name).sort();
    expect(names).toEqual(['fixture-cut-2024', 'rebound-2024']);

    // Each period must have the required shape.
    for (const period of call.periods) {
      expect(typeof period.name).toBe('string');
      expect(typeof period.from).toBe('string');
      expect(typeof period.to).toBe('string');
      expect(period.stats).toBeTruthy();
      expect(typeof period.stats).toBe('object');
    }
  });

  it('loads periods from playbook via personalContextLoader.loadPlaybook(userId)', async () => {
    const { factory, personalContextLoader } = makeSimilarFactory();
    const tool = getFindSimilarTool(factory);

    await tool.execute({
      userId: 'test-user',
      pattern_signature: { weight_avg_lbs: 197 },
    });

    expect(personalContextLoader.loadPlaybook).toHaveBeenCalledWith('test-user');
  });

  it('aggregates each period stats by querying weight + nutrition for the period date range', async () => {
    const { factory, similarPeriodFinder } = makeSimilarFactory();
    const tool = getFindSimilarTool(factory);

    await tool.execute({
      userId: 'test-user',
      pattern_signature: { weight_avg_lbs: 197 },
    });

    const periods = similarPeriodFinder.findSimilar.mock.calls[0][0].periods;
    const cut = periods.find(p => p.name === 'fixture-cut-2024');
    const rebound = periods.find(p => p.name === 'rebound-2024');

    // Cut: 90-day fixture, weight starts at 200 and drops by 0.05/day, so:
    //   first weight = 200, last weight = 200 - 0.05 * 89 = 195.55
    //   weight_delta_lbs = 195.55 - 200 = -4.45
    expect(cut.stats.weight_avg_lbs).toBeCloseTo((200 + 195.55) / 2, 1);
    expect(cut.stats.weight_delta_lbs).toBeCloseTo(-4.45, 2);
    expect(cut.stats.protein_avg_g).toBe(145);
    expect(cut.stats.calorie_avg).toBe(1800);
    // 90 days, all logged → tracking_rate = 1.0
    expect(cut.stats.tracking_rate).toBe(1);

    // Rebound: only 16/31 days logged.
    expect(rebound.stats.tracking_rate).toBeCloseTo(16 / 31, 3);
    // Protein avg over the 16 logged days = 110.
    expect(rebound.stats.protein_avg_g).toBe(110);
    expect(rebound.stats.calorie_avg).toBe(2400);
  });

  it('respects max_results param (default 3)', async () => {
    const { factory, similarPeriodFinder } = makeSimilarFactory();
    const tool = getFindSimilarTool(factory);

    // Default max_results
    await tool.execute({
      userId: 'test-user',
      pattern_signature: { weight_avg_lbs: 197 },
    });
    expect(similarPeriodFinder.findSimilar.mock.calls[0][0].maxResults).toBe(3);

    // Explicit override
    await tool.execute({
      userId: 'test-user',
      pattern_signature: { weight_avg_lbs: 197 },
      max_results: 1,
    });
    expect(similarPeriodFinder.findSimilar.mock.calls[1][0].maxResults).toBe(1);
  });

  it('returns matches with name + score + dimensionScores + period metadata', async () => {
    const { factory } = makeSimilarFactory();
    const tool = getFindSimilarTool(factory);

    const signature = {
      weight_avg_lbs: 197,
      protein_avg_g: 140,
    };

    const result = await tool.execute({
      userId: 'test-user',
      pattern_signature: signature,
    });

    expect(result.signature).toEqual(signature);
    expect(Array.isArray(result.matches)).toBe(true);
    expect(result.matches.length).toBeGreaterThan(0);
    for (const m of result.matches) {
      expect(typeof m.name).toBe('string');
      expect(typeof m.score).toBe('number');
      expect(m.dimensionScores).toBeTruthy();
      expect(typeof m.dimensionScores).toBe('object');
      expect(m.period).toBeTruthy();
      expect(typeof m.period.from).toBe('string');
      expect(typeof m.period.to).toBe('string');
      expect(typeof m.period.description).toBe('string');
      expect(m.period.stats).toBeTruthy();
    }
  });

  it('gracefully degrades when playbook missing — returns { matches: [], reason: "no playbook" }', async () => {
    // playbook returns null for this user
    const { factory, similarPeriodFinder } = makeSimilarFactory({
      playbookByUser: { 'test-user': null },
    });
    const tool = getFindSimilarTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      pattern_signature: { weight_avg_lbs: 197 },
    });

    expect(result.matches).toEqual([]);
    expect(result.reason).toBe('no playbook');
    // Finder should NOT have been invoked.
    expect(similarPeriodFinder.findSimilar).not.toHaveBeenCalled();
  });

  it('gracefully degrades when personalContextLoader dependency is missing', async () => {
    const healthStore = {
      loadWeightData: vi.fn(async () => ({})),
      loadNutritionData: vi.fn(async () => ({})),
    };
    const factory = new LongitudinalToolFactory({
      healthStore,
      similarPeriodFinder: { findSimilar: vi.fn() },
      // personalContextLoader intentionally absent
    });
    const tool = getFindSimilarTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      pattern_signature: { weight_avg_lbs: 197 },
    });

    expect(result.matches).toEqual([]);
    expect(result.reason).toBe('no playbook');
  });
});

describe('query_historical_weight — yearly_avg (Plan 5)', () => {
  it('aggregates 2 years of data into 2 yearly buckets', async () => {
    const fixture = {};
    let lbs = 200;
    const start = new Date(Date.UTC(2024, 0, 1));
    for (let i = 0; i < 730; i++) {  // 2 years
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      fixture[d.toISOString().slice(0, 10)] = {
        date: d.toISOString().slice(0, 10),
        lbs, lbs_adjusted_average: lbs - 0.5, source: 'consumer-bia',
      };
      lbs -= 0.01;
    }
    const { factory } = makeFactory({ loadWeightData: vi.fn(async () => fixture) });
    const tool = getQueryTool(factory);
    const out = await tool.execute({
      userId: 'kc',
      from: '2024-01-01', to: '2025-12-31',
      aggregation: 'yearly_avg',
    });
    expect(out.aggregation).toBe('yearly_avg');
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0].period).toBe('2024');
    expect(out.rows[1].period).toBe('2025');
    expect(typeof out.rows[0].lbs).toBe('number');
  });

  it('rejects unknown aggregation with structured error', async () => {
    const { factory } = makeFactory();
    const tool = getQueryTool(factory);
    const out = await tool.execute({
      userId: 'kc', from: '2024-01-01', to: '2024-12-31',
      aggregation: 'centurial_avg',
    });
    expect(out.error).toMatch(/Unknown aggregation/);
  });
});

describe('query_historical_reconciliation (Plan 5)', () => {
  function buildReconciliationFixture(today) {
    const data = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const date = d.toISOString().slice(0, 10);
      data[date] = {
        tracked_calories: 2100 - i,
        exercise_calories: 300 + i,
        tracking_accuracy: 0.85,
        implied_intake: 2000 + i,
        calorie_adjustment: -100,
      };
    }
    return data;
  }

  it('returns days in window with matured/redacted fields per row', async () => {
    const today = new Date();  // anchor; tests ARE time-sensitive
    const fixture = buildReconciliationFixture(today);
    const healthStore = {
      loadWeightData: vi.fn(async () => ({})),
      loadNutritionData: vi.fn(async () => ({})),
      loadReconciliationData: vi.fn(async () => fixture),
    };
    const factory = new LongitudinalToolFactory({ healthStore });
    const tool = factory.createTools().find(t => t.name === 'query_historical_reconciliation');
    expect(tool).toBeDefined();

    const todayStr = today.toISOString().slice(0, 10);
    const fromDate = new Date(today);
    fromDate.setUTCDate(fromDate.getUTCDate() - 29);
    const fromStr = fromDate.toISOString().slice(0, 10);

    const out = await tool.execute({ userId: 'kc', from: fromStr, to: todayStr });
    expect(out.days.length).toBe(30);
    // Last 14 days redacted: only tracked_calories and exercise_calories present
    const recent = out.days.find(d => d.date === todayStr);
    expect(recent.tracked_calories).toBeDefined();
    expect(recent.exercise_calories).toBeDefined();
    expect(recent.tracking_accuracy).toBeUndefined();
    expect(recent.implied_intake).toBeUndefined();
    expect(recent.calorie_adjustment).toBeUndefined();
    // Old days (> 14 days back) keep all fields
    const oldDate = new Date(today);
    oldDate.setUTCDate(oldDate.getUTCDate() - 20);
    const oldStr = oldDate.toISOString().slice(0, 10);
    const old = out.days.find(d => d.date === oldStr);
    expect(old.tracking_accuracy).toBeDefined();
    expect(old.implied_intake).toBeDefined();
  });

  it('returns empty days for an out-of-range window', async () => {
    const healthStore = {
      loadWeightData: vi.fn(async () => ({})),
      loadNutritionData: vi.fn(async () => ({})),
      loadReconciliationData: vi.fn(async () => ({ '2024-01-15': { tracked_calories: 2000 } })),
    };
    const factory = new LongitudinalToolFactory({ healthStore });
    const tool = factory.createTools().find(t => t.name === 'query_historical_reconciliation');
    const out = await tool.execute({ userId: 'kc', from: '2025-01-01', to: '2025-12-31' });
    expect(out.days).toEqual([]);
  });
});

describe('query_historical_coaching (Plan 5)', () => {
  it('returns entries grouped by date in the window', async () => {
    const fixture = {
      '2024-06-15': [{ type: 'morning_brief', text: 'Hello', timestamp: '2024-06-15T08:00:00Z' }],
      '2024-07-01': [{ type: 'feedback', text: 'Good week', timestamp: '2024-07-01T19:00:00Z' }],
      '2024-08-15': [{ type: 'morning_brief', text: 'Pulling cut tight' }],
    };
    const healthStore = {
      loadWeightData: vi.fn(async () => ({})),
      loadNutritionData: vi.fn(async () => ({})),
      loadCoachingData: vi.fn(async () => fixture),
    };
    const factory = new LongitudinalToolFactory({ healthStore });
    const tool = factory.createTools().find(t => t.name === 'query_historical_coaching');
    expect(tool).toBeDefined();

    const out = await tool.execute({ userId: 'kc', from: '2024-07-01', to: '2024-12-31' });
    expect(out.entries).toHaveLength(2);
    const dates = out.entries.map(e => e.date);
    expect(dates).toEqual(['2024-07-01', '2024-08-15']);
    expect(out.entries[0].messages[0].text).toBe('Good week');
  });

  it('returns empty when no entries in range', async () => {
    const healthStore = {
      loadWeightData: vi.fn(async () => ({})),
      loadNutritionData: vi.fn(async () => ({})),
      loadCoachingData: vi.fn(async () => ({ '2024-01-01': [{ text: 'Older entry' }] })),
    };
    const factory = new LongitudinalToolFactory({ healthStore });
    const tool = factory.createTools().find(t => t.name === 'query_historical_coaching');
    const out = await tool.execute({ userId: 'kc', from: '2025-01-01', to: '2025-12-31' });
    expect(out.entries).toEqual([]);
  });
});

describe('query_historical_workouts — count aggregations (Plan 5)', () => {
  it('returns weekly_count buckets with workouts per week + total duration', async () => {
    const healthService = {
      getHealthForRange: vi.fn(async () => ({
        '2024-08-05': { workouts: [{ type: 'run', title: 'Mon run', duration: 30 }] },     // Mon W32
        '2024-08-07': { workouts: [{ type: 'run', title: 'Wed run', duration: 35 }] },     // Wed W32
        '2024-08-12': { workouts: [{ type: 'ride', title: 'Mon ride', duration: 60 }] },   // Mon W33
      })),
    };
    const factory = new LongitudinalToolFactory({
      healthStore: { loadWeightData: vi.fn(async () => ({})), loadNutritionData: vi.fn(async () => ({})) },
      healthService,
    });
    const tool = factory.createTools().find(t => t.name === 'query_historical_workouts');
    const out = await tool.execute({
      userId: 'kc',
      from: '2024-08-01', to: '2024-08-15',
      aggregation: 'weekly_count',
    });
    expect(out.aggregation).toBe('weekly_count');
    expect(out.rows.length).toBe(2);
    // W32 has 2 workouts totaling 65 min, W33 has 1 totaling 60 min
    const w32 = out.rows.find(r => r.period.endsWith('W32'));
    const w33 = out.rows.find(r => r.period.endsWith('W33'));
    expect(w32.count).toBe(2);
    expect(w32.totalDurationMin).toBe(65);
    expect(w33.count).toBe(1);
    expect(w33.totalDurationMin).toBe(60);
  });

  it('returns monthly_count buckets', async () => {
    const healthService = {
      getHealthForRange: vi.fn(async () => ({
        '2024-08-05': { workouts: [{ type: 'run', duration: 30 }] },
        '2024-08-15': { workouts: [{ type: 'run', duration: 35 }] },
        '2024-09-10': { workouts: [{ type: 'ride', duration: 60 }] },
      })),
    };
    const factory = new LongitudinalToolFactory({
      healthStore: { loadWeightData: vi.fn(async () => ({})), loadNutritionData: vi.fn(async () => ({})) },
      healthService,
    });
    const tool = factory.createTools().find(t => t.name === 'query_historical_workouts');
    const out = await tool.execute({
      userId: 'kc',
      from: '2024-08-01', to: '2024-09-30',
      aggregation: 'monthly_count',
    });
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0].period).toBe('2024-08');
    expect(out.rows[0].count).toBe(2);
    expect(out.rows[1].period).toBe('2024-09');
    expect(out.rows[1].count).toBe(1);
  });

  it('returns yearly_count buckets', async () => {
    const healthService = {
      getHealthForRange: vi.fn(async () => ({
        '2024-03-15': { workouts: [{ duration: 30 }, { duration: 30 }] },
        '2024-12-25': { workouts: [{ duration: 45 }] },
        '2025-01-10': { workouts: [{ duration: 30 }] },
      })),
    };
    const factory = new LongitudinalToolFactory({
      healthStore: { loadWeightData: vi.fn(async () => ({})), loadNutritionData: vi.fn(async () => ({})) },
      healthService,
    });
    const tool = factory.createTools().find(t => t.name === 'query_historical_workouts');
    const out = await tool.execute({
      userId: 'kc',
      from: '2024-01-01', to: '2025-12-31',
      aggregation: 'yearly_count',
    });
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toMatchObject({ period: '2024', count: 3, totalDurationMin: 105 });
    expect(out.rows[1]).toMatchObject({ period: '2025', count: 1, totalDurationMin: 30 });
  });

  it('returns the existing flat list when aggregation not provided (no regression)', async () => {
    const healthService = {
      getHealthForRange: vi.fn(async () => ({
        '2024-08-05': { workouts: [{ type: 'run', title: 'Run', duration: 30 }] },
      })),
    };
    const factory = new LongitudinalToolFactory({
      healthStore: { loadWeightData: vi.fn(async () => ({})), loadNutritionData: vi.fn(async () => ({})) },
      healthService,
    });
    const tool = factory.createTools().find(t => t.name === 'query_historical_workouts');
    const out = await tool.execute({ userId: 'kc', from: '2024-08-01', to: '2024-08-31' });
    expect(out.workouts).toBeDefined();
    expect(out.workouts).toHaveLength(1);
  });
});
