import { describe, it, expect, vi } from 'vitest';
import { MetricComparator } from '../../../../../backend/src/2_domains/health/services/MetricComparator.mjs';
import { MetricAggregator } from '../../../../../backend/src/2_domains/health/services/MetricAggregator.mjs';
import { PeriodResolver } from '../../../../../backend/src/2_domains/health/services/PeriodResolver.mjs';

const NOW = new Date('2026-05-05T12:00:00Z');
const fixedNow = () => NOW;

// 30-day weight fixture: 2026-04-06..2026-05-05, slow downward drift
function buildWeightFixture() {
  const out = {};
  let lbs = 200;
  const start = new Date(Date.UTC(2026, 3, 6));
  for (let i = 0; i < 30; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    out[key] = { lbs, lbs_adjusted_average: lbs };
    lbs -= 0.1;
  }
  return out;
}

// 60-day weight fixture: 2026-03-07..2026-05-05, slow downward drift
function buildLongWeightFixture() {
  const out = {};
  let lbs = 205;
  const start = new Date(Date.UTC(2026, 2, 7));
  for (let i = 0; i < 60; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    out[key] = { lbs, lbs_adjusted_average: lbs };
    lbs -= 0.1;
  }
  return out;
}

function makeComparator(weightFixture = buildWeightFixture(), nutritionFixture = {}) {
  const healthStore = {
    loadWeightData: vi.fn(async () => weightFixture),
    loadNutritionData: vi.fn(async () => nutritionFixture),
  };
  const healthService = { getHealthForRange: vi.fn(async () => ({})) };
  const periodResolver = new PeriodResolver({ now: fixedNow });
  const aggregator = new MetricAggregator({ healthStore, healthService, periodResolver });
  return {
    comparator: new MetricComparator({ aggregator, periodResolver, healthStore, healthService }),
    healthStore, healthService, periodResolver, aggregator,
  };
}

describe('MetricComparator.compare', () => {
  it('returns delta and percentChange across two rolling periods', async () => {
    const { comparator } = makeComparator(buildLongWeightFixture());
    const out = await comparator.compare({
      userId: 'kc',
      metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' },
      period_b: { rolling: 'prev_30d' },
    });
    expect(out.metric).toBe('weight_lbs');
    expect(out.statistic).toBe('mean');
    expect(out.a.value).not.toBeNull();
    expect(out.b.value).not.toBeNull();
    expect(out.delta).toBeCloseTo(out.a.value - out.b.value, 6);
    expect(out.percentChange).toBeCloseTo((out.a.value - out.b.value) / out.b.value, 6);
    expect(['high', 'medium', 'low']).toContain(out.reliability);
  });

  it('passes statistic through to both aggregations', async () => {
    const { comparator } = makeComparator(buildLongWeightFixture());
    const out = await comparator.compare({
      userId: 'kc',
      metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' },
      period_b: { rolling: 'prev_30d' },
      statistic: 'min',
    });
    expect(out.statistic).toBe('min');
    expect(typeof out.a.value).toBe('number');
  });

  it('marks reliability=high when both periods have full coverage', async () => {
    const { comparator } = makeComparator(buildLongWeightFixture());
    const out = await comparator.compare({
      userId: 'kc',
      metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' },
      period_b: { rolling: 'prev_30d' },
    });
    expect(out.reliability).toBe('high');
  });

  it('marks reliability=low when one period has no data', async () => {
    const sparse = {};
    sparse['2026-05-05'] = { lbs: 200, lbs_adjusted_average: 200 };
    const { comparator } = makeComparator(sparse);
    const out = await comparator.compare({
      userId: 'kc',
      metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' },
      period_b: { rolling: 'prev_30d' },
    });
    expect(out.reliability).toBe('low');
  });

  it('returns null delta when one period has no value', async () => {
    const onlyA = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(Date.UTC(2026, 3, 6));
      d.setUTCDate(d.getUTCDate() + i);
      onlyA[d.toISOString().slice(0, 10)] = { lbs: 200, lbs_adjusted_average: 200 };
    }
    const { comparator } = makeComparator(onlyA);
    const out = await comparator.compare({
      userId: 'kc',
      metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' },
      period_b: { rolling: 'prev_30d' },
    });
    expect(out.b.value).toBe(null);
    expect(out.delta).toBe(null);
    expect(out.percentChange).toBe(null);
  });
});
