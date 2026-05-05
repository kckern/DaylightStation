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

  it('exposes trajectory / detectRegimeChange / detectAnomalies / detectSustained via MetricTrendAnalyzer', async () => {
    const healthStore = {
      loadWeightData: vi.fn(async () => {
        const out = {};
        for (let i = 0; i < 30; i++) {
          const d = new Date(Date.UTC(2026, 3, 6 + i));
          out[d.toISOString().slice(0, 10)] = { lbs: 200 - i * 0.1, lbs_adjusted_average: 200 - i * 0.1 };
        }
        return out;
      }),
      loadNutritionData: vi.fn(async () => ({})),
    };
    const healthService = { getHealthForRange: vi.fn(async () => ({})) };
    const periodResolver = new PeriodResolver({ now: fixedNow });
    const service = new HealthAnalyticsService({ healthStore, healthService, periodResolver });

    expect(typeof service.trajectory).toBe('function');
    expect(typeof service.detectRegimeChange).toBe('function');
    expect(typeof service.detectAnomalies).toBe('function');
    expect(typeof service.detectSustained).toBe('function');

    const traj = await service.trajectory({
      userId: 'kc', metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
    });
    expect(traj.direction).toBe('down');
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

  it('exposes PeriodMemory + HistoryReflector when workingMemoryAdapter provided', async () => {
    const periodResolver = new PeriodResolver({ now: fixedNow });
    const fakeWMState = { get: () => undefined, set: () => {}, remove: () => {}, getAll: () => ({}) };
    const workingMemoryAdapter = { load: async () => fakeWMState, save: async () => {} };

    const service = new HealthAnalyticsService({
      healthStore: { loadWeightData: vi.fn(async () => ({})), loadNutritionData: vi.fn(async () => ({})) },
      healthService: { getHealthForRange: vi.fn(async () => ({})) },
      periodResolver,
      workingMemoryAdapter,
    });

    expect(typeof service.listPeriods).toBe('function');
    expect(typeof service.deducePeriod).toBe('function');
    expect(typeof service.rememberPeriod).toBe('function');
    expect(typeof service.forgetPeriod).toBe('function');
    expect(typeof service.analyzeHistory).toBe('function');

    const out = await service.listPeriods({ userId: 'kc' });
    expect(out.periods).toEqual([]);
  });

  it('PeriodMemory delegates throw when workingMemoryAdapter is absent', async () => {
    const periodResolver = new PeriodResolver({ now: fixedNow });
    const service = new HealthAnalyticsService({
      healthStore: { loadWeightData: vi.fn(async () => ({})), loadNutritionData: vi.fn(async () => ({})) },
      healthService: { getHealthForRange: vi.fn(async () => ({})) },
      periodResolver,
    });
    expect(() => service.listPeriods({ userId: 'kc' })).toThrow(/workingMemoryAdapter/);
  });
});
