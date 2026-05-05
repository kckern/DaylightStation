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
