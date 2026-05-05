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

describe('MetricComparator.summarizeChange', () => {
  it('returns delta + changeShape for two adjacent periods', async () => {
    const { comparator } = makeComparator(buildLongWeightFixture());
    const out = await comparator.summarizeChange({
      userId: 'kc',
      metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' },
      period_b: { rolling: 'prev_30d' },
    });
    expect(out.metric).toBe('weight_lbs');
    expect(typeof out.delta).toBe('number');
    expect(['monotonic', 'volatile', 'step', 'reversal']).toContain(out.changeShape);
    expect(out.varianceA).toBeGreaterThanOrEqual(0);
    expect(out.varianceB).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(out.drivers)).toBe(true);
  });

  it('identifies monotonic shape when fixture drifts steadily', async () => {
    // The buildLongWeightFixture is strictly monotonic decreasing
    const { comparator } = makeComparator(buildLongWeightFixture());
    const out = await comparator.summarizeChange({
      userId: 'kc',
      metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' },
      period_b: { rolling: 'prev_30d' },
    });
    expect(out.changeShape).toBe('monotonic');
  });

  it('returns null delta when one period has no value', async () => {
    const sparse = {};
    sparse['2026-05-05'] = { lbs: 200, lbs_adjusted_average: 200 };
    const { comparator } = makeComparator(sparse);
    const out = await comparator.summarizeChange({
      userId: 'kc',
      metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' },
      period_b: { rolling: 'prev_30d' },
    });
    expect(out.delta).toBe(null);
    expect(out.changeShape).toBe('step');
  });
});

describe('MetricComparator.conditionalAggregate', () => {
  // Build a fixture where: 30 days of weight + nutrition. Days where i%2===0
  // have nutrition logged (calories>0); odd days do not.
  function buildPairedFixture() {
    const weight = {};
    const nutrition = {};
    let lbs = 200;
    const start = new Date(Date.UTC(2026, 3, 6)); // Mon 2026-04-06
    for (let i = 0; i < 30; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      weight[key] = { lbs, lbs_adjusted_average: lbs };
      if (i % 2 === 0) {
        nutrition[key] = { calories: 2000, protein: 150 };
      }
      lbs -= 0.1;
    }
    return { weight, nutrition };
  }

  it('splits a metric by tracked vs untracked condition', async () => {
    const { weight, nutrition } = buildPairedFixture();
    const { comparator } = makeComparator(weight, nutrition);
    const out = await comparator.conditionalAggregate({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
      condition: { tracked: true },
    });
    expect(out.metric).toBe('weight_lbs');
    expect(out.matching.daysMatched).toBe(15);  // even-indexed days
    expect(out.notMatching.daysNotMatched).toBe(15);
    expect(typeof out.matching.value).toBe('number');
    expect(typeof out.notMatching.value).toBe('number');
    expect(typeof out.delta).toBe('number');
  });

  it('weekday condition splits by ISO day-of-week', async () => {
    const { weight, nutrition } = buildPairedFixture();
    const { comparator } = makeComparator(weight, nutrition);
    const out = await comparator.conditionalAggregate({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
      condition: { weekday: 'Mon' },
    });
    // 30 days from Mon 2026-04-06 → 5 Mondays
    expect(out.matching.daysMatched).toBe(5);
  });

  it('weekend condition matches Sat+Sun', async () => {
    const { weight, nutrition } = buildPairedFixture();
    const { comparator } = makeComparator(weight, nutrition);
    const out = await comparator.conditionalAggregate({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
      condition: { weekend: true },
    });
    // 30-day window = 4 weeks + 2 days; 4*2 = 8 weekend days
    expect(out.matching.daysMatched).toBe(8);
  });

  it('since condition keeps only days >= cutoff', async () => {
    const { weight, nutrition } = buildPairedFixture();
    const { comparator } = makeComparator(weight, nutrition);
    const out = await comparator.conditionalAggregate({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
      condition: { since: '2026-04-20' },
    });
    expect(out.matching.daysMatched).toBe(16);
  });

  it('throws on unknown condition shape', async () => {
    const { weight, nutrition } = buildPairedFixture();
    const { comparator } = makeComparator(weight, nutrition);
    await expect(comparator.conditionalAggregate({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
      condition: { magic: 'unicorn' },
    })).rejects.toThrow(/unknown condition/);
  });
});

describe('MetricComparator.correlateMetrics', () => {
  // Fixture: 30 days. Weight drifts down, calories drift up — should produce
  // strong negative correlation.
  function buildCorrelatedFixture() {
    const weight = {};
    const nutrition = {};
    let lbs = 200;
    let cal = 1800;
    const start = new Date(Date.UTC(2026, 3, 6));
    for (let i = 0; i < 30; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      weight[key] = { lbs, lbs_adjusted_average: lbs };
      nutrition[key] = { calories: cal, protein: 150 };
      lbs -= 0.5;
      cal += 10;
    }
    return { weight, nutrition };
  }

  it('returns Spearman + Pearson correlations across daily series', async () => {
    const { weight, nutrition } = buildCorrelatedFixture();
    const { comparator } = makeComparator(weight, nutrition);
    const out = await comparator.correlateMetrics({
      userId: 'kc',
      metric_a: 'weight_lbs',
      metric_b: 'calories',
      period: { from: '2026-04-06', to: '2026-05-05' },
      granularity: 'daily',
    });
    expect(out.metric_a).toBe('weight_lbs');
    expect(out.metric_b).toBe('calories');
    // Both go monotonically (weight down, calories up) → strong negative
    expect(out.correlation).toBeLessThan(-0.9);
    expect(out.pearson).toBeLessThan(-0.9);
    expect(out.pairs).toBe(30);
    expect(out.interpretation).toBe('strong-negative');
  });

  it('skips days where either metric is null', async () => {
    const weight = {};
    const nutrition = {};
    weight['2026-05-01'] = { lbs: 200, lbs_adjusted_average: 200 };
    weight['2026-05-02'] = { lbs: 199, lbs_adjusted_average: 199 };
    weight['2026-05-03'] = { lbs: 198, lbs_adjusted_average: 198 };
    nutrition['2026-05-02'] = { calories: 2000, protein: 150 };
    const { comparator } = makeComparator(weight, nutrition);
    const out = await comparator.correlateMetrics({
      userId: 'kc',
      metric_a: 'weight_lbs',
      metric_b: 'calories',
      period: { from: '2026-05-01', to: '2026-05-03' },
      granularity: 'daily',
    });
    // Only 2026-05-02 has both → 1 pair → correlation = NaN/undefined → 0
    expect(out.pairs).toBe(1);
    expect(out.interpretation).toBe('none');
  });

  it('classifies interpretation', async () => {
    const { weight, nutrition } = buildCorrelatedFixture();
    const { comparator } = makeComparator(weight, nutrition);
    const out = await comparator.correlateMetrics({
      userId: 'kc',
      metric_a: 'weight_lbs',
      metric_b: 'calories',
      period: { from: '2026-04-06', to: '2026-05-05' },
      granularity: 'daily',
    });
    expect(['strong-positive', 'weak-positive', 'none', 'weak-negative', 'strong-negative']).toContain(out.interpretation);
  });
});
