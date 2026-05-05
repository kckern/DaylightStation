// tests/isolated/domain/health/services/MetricAggregator.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { MetricAggregator } from '../../../../../backend/src/2_domains/health/services/MetricAggregator.mjs';
import { PeriodResolver } from '../../../../../backend/src/2_domains/health/services/PeriodResolver.mjs';

const NOW = new Date('2026-05-05T12:00:00Z');
const fixedNow = () => NOW;

// Fixture: 7 consecutive days of weight, with a small drift.
const WEIGHT_FIXTURE = {
  '2026-04-29': { date: '2026-04-29', lbs: 200, lbs_adjusted_average: 199.5, fat_percent: 20, fat_percent_average: 19.8 },
  '2026-04-30': { date: '2026-04-30', lbs: 199.5, lbs_adjusted_average: 199.0, fat_percent: 20, fat_percent_average: 19.7 },
  '2026-05-01': { date: '2026-05-01', lbs: 199, lbs_adjusted_average: 198.5, fat_percent: 19.5, fat_percent_average: 19.6 },
  '2026-05-02': { date: '2026-05-02', lbs: 198.5, lbs_adjusted_average: 198.0, fat_percent: 19.5, fat_percent_average: 19.5 },
  '2026-05-03': { date: '2026-05-03', lbs: 198, lbs_adjusted_average: 197.5, fat_percent: 19.0, fat_percent_average: 19.4 },
  '2026-05-04': { date: '2026-05-04', lbs: 197.5, lbs_adjusted_average: 197.0, fat_percent: 19.0, fat_percent_average: 19.3 },
  '2026-05-05': { date: '2026-05-05', lbs: 197, lbs_adjusted_average: 196.5, fat_percent: 18.5, fat_percent_average: 19.2 },
};

const NUTRITION_FIXTURE = {
  '2026-04-29': { calories: 2100, protein: 150 },
  '2026-04-30': { calories: 2200, protein: 145 },
  '2026-05-01': { calories: 2050, protein: 160 },
  // 2026-05-02 missing — untracked
  '2026-05-03': { calories: 2150, protein: 155 },
  '2026-05-04': { calories: 2000, protein: 140 },
  '2026-05-05': { calories: 2080, protein: 152 },
};

function makeAggregator(overrides = {}) {
  const healthStore = {
    loadWeightData: vi.fn(async () => WEIGHT_FIXTURE),
    loadNutritionData: vi.fn(async () => NUTRITION_FIXTURE),
    ...overrides,
  };
  const healthService = {
    getHealthForRange: vi.fn(async () => ({})), // empty workouts unless overridden
    ...overrides,
  };
  const resolver = new PeriodResolver({ now: fixedNow });
  return { aggregator: new MetricAggregator({ healthStore, healthService, periodResolver: resolver }), healthStore, healthService };
}

describe('MetricAggregator.aggregate', () => {
  it('mean weight_lbs over last_7d', async () => {
    const { aggregator } = makeAggregator();
    const out = await aggregator.aggregate({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { rolling: 'last_7d' },
    });
    expect(out.metric).toBe('weight_lbs');
    expect(out.unit).toBe('lbs');
    expect(out.statistic).toBe('mean');
    expect(out.daysCovered).toBe(7);
    expect(out.daysInPeriod).toBe(7);
    expect(out.value).toBeCloseTo((199.5 + 199 + 198.5 + 198 + 197.5 + 197 + 196.5) / 7, 6);
  });

  it('median weight_lbs over last_7d', async () => {
    const { aggregator } = makeAggregator();
    const out = await aggregator.aggregate({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { rolling: 'last_7d' },
      statistic: 'median',
    });
    expect(out.value).toBe(198);
  });

  it('min and max', async () => {
    const { aggregator } = makeAggregator();
    const min = await aggregator.aggregate({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_7d' }, statistic: 'min' });
    const max = await aggregator.aggregate({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_7d' }, statistic: 'max' });
    expect(min.value).toBe(196.5);
    expect(max.value).toBe(199.5);
  });

  it('count of nutrition logged days (via tracking_density kind=ratio)', async () => {
    const { aggregator } = makeAggregator();
    const out = await aggregator.aggregate({
      userId: 'kc',
      metric: 'tracking_density',
      period: { rolling: 'last_7d' },
    });
    // 6 of 7 days logged
    expect(out.daysCovered).toBe(6);
    expect(out.daysInPeriod).toBe(7);
    expect(out.value).toBeCloseTo(6 / 7, 6);
    expect(out.unit).toBe('ratio');
  });

  it('returns null value when no covered days', async () => {
    const { aggregator } = makeAggregator({ loadWeightData: async () => ({}) });
    const out = await aggregator.aggregate({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { rolling: 'last_7d' },
    });
    expect(out.value).toBe(null);
    expect(out.daysCovered).toBe(0);
    expect(out.daysInPeriod).toBe(7);
  });

  it('throws on unknown metric', async () => {
    const { aggregator } = makeAggregator();
    await expect(aggregator.aggregate({ userId: 'kc', metric: 'nope', period: { rolling: 'last_7d' } }))
      .rejects.toThrow(/unknown metric/);
  });

  it('throws on unknown statistic', async () => {
    const { aggregator } = makeAggregator();
    await expect(aggregator.aggregate({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_7d' }, statistic: 'mode' }))
      .rejects.toThrow(/unknown statistic/);
  });

  it('count statistic returns covered-day count even for value-kind metric', async () => {
    const { aggregator } = makeAggregator();
    const out = await aggregator.aggregate({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { rolling: 'last_7d' },
      statistic: 'count',
    });
    expect(out.value).toBe(7);
  });

  it('sum statistic for value-kind metric (calories) totals across logged days', async () => {
    const { aggregator } = makeAggregator();
    const out = await aggregator.aggregate({
      userId: 'kc',
      metric: 'calories',
      period: { rolling: 'last_7d' },
      statistic: 'sum',
    });
    expect(out.value).toBe(2100 + 2200 + 2050 + 2150 + 2000 + 2080); // 12580
    expect(out.daysCovered).toBe(6);
  });
});

describe('MetricAggregator.aggregateSeries', () => {
  it('weekly buckets for weight_lbs over a 4-week period', async () => {
    // 28-day fixture, 4 ISO weeks. Use the same weight fixture pattern.
    const data = {};
    let lbs = 200;
    const start = new Date(Date.UTC(2026, 3, 6)); // Mon 2026-04-06
    for (let i = 0; i < 28; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      data[date] = { date, lbs, lbs_adjusted_average: lbs };
      lbs -= 0.1;
    }
    const { aggregator } = (() => {
      const healthStore = { loadWeightData: vi.fn(async () => data), loadNutritionData: vi.fn(async () => ({})) };
      const healthService = { getHealthForRange: vi.fn(async () => ({})) };
      const resolver = new PeriodResolver({ now: fixedNow });
      return { aggregator: new MetricAggregator({ healthStore, healthService, periodResolver: resolver }) };
    })();

    const out = await aggregator.aggregateSeries({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-03' },
      granularity: 'weekly',
    });
    expect(out.granularity).toBe('weekly');
    expect(out.buckets).toHaveLength(4);
    // Each bucket has 7 days, mean is the midpoint of its 7-value run
    expect(out.buckets[0].count).toBe(7);
    expect(out.buckets[0].value).toBeCloseTo(200 - 0.3, 5); // mean of lbs..lbs-0.6
  });

  it('monthly buckets for weight_lbs over Q1-2024', async () => {
    const data = {};
    // Synthesize one entry on the 15th of Jan, Feb, Mar 2024.
    data['2024-01-15'] = { lbs: 200, lbs_adjusted_average: 200 };
    data['2024-02-15'] = { lbs: 201, lbs_adjusted_average: 201 };
    data['2024-03-15'] = { lbs: 202, lbs_adjusted_average: 202 };
    const healthStore = { loadWeightData: vi.fn(async () => data), loadNutritionData: vi.fn(async () => ({})) };
    const healthService = { getHealthForRange: vi.fn(async () => ({})) };
    const resolver = new PeriodResolver({ now: fixedNow });
    const aggregator = new MetricAggregator({ healthStore, healthService, periodResolver: resolver });

    const out = await aggregator.aggregateSeries({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { calendar: '2024-Q1' },
      granularity: 'monthly',
    });
    expect(out.buckets).toHaveLength(3);
    expect(out.buckets[0]).toMatchObject({ period: '2024-01', value: 200, count: 1 });
    expect(out.buckets[1]).toMatchObject({ period: '2024-02', value: 201, count: 1 });
    expect(out.buckets[2]).toMatchObject({ period: '2024-03', value: 202, count: 1 });
  });

  it('throws on unknown granularity', async () => {
    const { aggregator } = makeAggregator();
    await expect(aggregator.aggregateSeries({
      userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_7d' }, granularity: 'fortnightly',
    })).rejects.toThrow(/unknown granularity/);
  });
});

describe('MetricAggregator.distribution', () => {
  it('returns count, min/max, mean, median, stdev, and quartiles', async () => {
    const { aggregator } = makeAggregator();
    const out = await aggregator.distribution({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { rolling: 'last_7d' },
    });
    expect(out.count).toBe(7);
    expect(out.min).toBe(196.5);
    expect(out.max).toBe(199.5);
    expect(out.median).toBe(198);
    expect(out.quartiles.p25).toBeCloseTo(197.25, 5);
    expect(out.quartiles.p75).toBeCloseTo(198.75, 5);
    expect(out.mean).toBeCloseTo(198, 5);
    expect(typeof out.stdev).toBe('number');
  });

  it('returns histogram when bins provided', async () => {
    const { aggregator } = makeAggregator();
    const out = await aggregator.distribution({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { rolling: 'last_7d' },
      bins: 3,
    });
    expect(out.histogram).toHaveLength(3);
    const totalCount = out.histogram.reduce((s, b) => s + b.count, 0);
    expect(totalCount).toBe(7);
  });

  it('returns null stats when no data', async () => {
    const { aggregator } = makeAggregator({ loadWeightData: async () => ({}) });
    const out = await aggregator.distribution({
      userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_7d' },
    });
    expect(out.count).toBe(0);
    expect(out.min).toBe(null);
    expect(out.max).toBe(null);
    expect(out.median).toBe(null);
  });
});

describe('MetricAggregator.percentile', () => {
  it('finds the percentile rank of a value within a period', async () => {
    const { aggregator } = makeAggregator();
    // The 7-day weight values are 199.5, 199, 198.5, 198, 197.5, 197, 196.5
    const out = await aggregator.percentile({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { rolling: 'last_7d' },
      value: 198,
    });
    expect(out.metric).toBe('weight_lbs');
    expect(out.value).toBe(198);
    expect(out.rank).toBe(4); // 4th smallest in ascending sort
    expect(out.total).toBe(7);
    expect(out.percentile).toBeCloseTo(50, 5); // (4-1)/(7-1) * 100 = 50
  });

  it('classifies extreme values', async () => {
    const { aggregator } = makeAggregator();
    const lowest = await aggregator.percentile({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_7d' }, value: 196.5 });
    expect(lowest.percentile).toBe(0);
    expect(lowest.interpretation).toBe('below typical');
    const highest = await aggregator.percentile({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_7d' }, value: 199.5 });
    expect(highest.percentile).toBe(100);
    expect(highest.interpretation).toBe('above typical');
  });

  it('returns null percentile when no data', async () => {
    const { aggregator } = makeAggregator({ loadWeightData: async () => ({}) });
    const out = await aggregator.percentile({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_7d' }, value: 198 });
    expect(out.percentile).toBe(null);
    expect(out.total).toBe(0);
  });
});
