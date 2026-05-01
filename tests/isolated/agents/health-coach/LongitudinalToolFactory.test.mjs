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
