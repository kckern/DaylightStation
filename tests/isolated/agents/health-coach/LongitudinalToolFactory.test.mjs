import { describe, it, expect, vi } from 'vitest';

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
    ...overrides,
  };
  return { factory: new LongitudinalToolFactory({ healthStore }), healthStore };
}

function getQueryTool(factory) {
  return factory.createTools().find(t => t.name === 'query_historical_weight');
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
