// tests/isolated/domain/health/services/HealthAnalyticsService.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { HealthAnalyticsService } from '../../../../../backend/src/2_domains/health/services/HealthAnalyticsService.mjs';
import { PeriodResolver } from '../../../../../backend/src/2_domains/health/services/PeriodResolver.mjs';

const NOW = new Date('2026-05-05T12:00:00Z');
const fixedNow = () => NOW;

describe('HealthAnalyticsService', () => {
  it('exposes aggregate / aggregateSeries / distribution / percentile / snapshot via MetricAggregator', async () => {
    const healthStore = {
      loadWeightData: vi.fn(async () => ({
        '2026-05-04': { lbs: 200, lbs_adjusted_average: 199 },
        '2026-05-05': { lbs: 199, lbs_adjusted_average: 198 },
      })),
      loadNutritionData: vi.fn(async () => ({})),
    };
    const healthService = { getHealthForRange: vi.fn(async () => ({})) };
    const periodResolver = new PeriodResolver({ now: fixedNow });

    const service = new HealthAnalyticsService({ healthStore, healthService, periodResolver });

    const agg = await service.aggregate({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_2d' } });
    expect(agg.value).toBe(198.5);

    const series = await service.aggregateSeries({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_2d' }, granularity: 'daily' });
    expect(series.buckets).toHaveLength(2);

    const dist = await service.distribution({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_2d' } });
    expect(dist.count).toBe(2);

    const pct = await service.percentile({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_2d' }, value: 199 });
    expect(pct.total).toBe(2);

    const snap = await service.snapshot({ userId: 'kc', period: { rolling: 'last_2d' }, metrics: ['weight_lbs'] });
    expect(snap.metrics[0].metric).toBe('weight_lbs');
  });

  it('throws when constructed without required deps', () => {
    expect(() => new HealthAnalyticsService({})).toThrow();
  });

  it('exposes compare / summarizeChange / conditionalAggregate / correlateMetrics via MetricComparator', async () => {
    const healthStore = {
      loadWeightData: vi.fn(async () => ({
        '2026-05-04': { lbs: 200, lbs_adjusted_average: 199 },
        '2026-05-05': { lbs: 199, lbs_adjusted_average: 198 },
      })),
      loadNutritionData: vi.fn(async () => ({})),
    };
    const healthService = { getHealthForRange: vi.fn(async () => ({})) };
    const periodResolver = new PeriodResolver({ now: fixedNow });
    const service = new HealthAnalyticsService({ healthStore, healthService, periodResolver });

    expect(typeof service.compare).toBe('function');
    expect(typeof service.summarizeChange).toBe('function');
    expect(typeof service.conditionalAggregate).toBe('function');
    expect(typeof service.correlateMetrics).toBe('function');

    const cmp = await service.compare({
      userId: 'kc', metric: 'weight_lbs',
      period_a: { rolling: 'last_2d' }, period_b: { rolling: 'prev_2d' },
    });
    expect(cmp.metric).toBe('weight_lbs');
  });
});
