// tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { HealthAnalyticsToolFactory } from '../../../../backend/src/3_applications/agents/health-coach/tools/HealthAnalyticsToolFactory.mjs';

function makeFactory(overrides = {}) {
  const healthAnalyticsService = {
    aggregate:        vi.fn(async (args) => ({ ...args, value: 100, unit: 'lbs', daysCovered: 5, daysInPeriod: 7 })),
    aggregateSeries:  vi.fn(async (args) => ({ ...args, buckets: [] })),
    distribution:     vi.fn(async (args) => ({ ...args, count: 0 })),
    percentile:       vi.fn(async (args) => ({ ...args, percentile: 50 })),
    snapshot:         vi.fn(async (args) => ({ ...args, metrics: [] })),
    compare:              vi.fn(async (args) => ({ ...args, delta: 0, percentChange: 0 })),
    summarizeChange:      vi.fn(async (args) => ({ ...args, changeShape: 'step' })),
    conditionalAggregate: vi.fn(async (args) => ({ ...args, matching: { value: 0, daysMatched: 0 }, notMatching: { value: 0, daysNotMatched: 0 }, delta: 0 })),
    correlateMetrics:     vi.fn(async (args) => ({ ...args, correlation: 0, pairs: 0, interpretation: 'none' })),
    ...overrides,
  };
  return { factory: new HealthAnalyticsToolFactory({ healthAnalyticsService }), healthAnalyticsService };
}

describe('HealthAnalyticsToolFactory', () => {
  it('createTools returns 9 tools (5 from Plan 1 + 4 from Plan 2)', () => {
    const { factory } = makeFactory();
    const tools = factory.createTools();
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual([
      'aggregate_metric', 'aggregate_series',
      'compare_metric', 'conditional_aggregate', 'correlate_metrics',
      'metric_distribution', 'metric_percentile', 'metric_snapshot',
      'summarize_change',
    ]);
  });

  it('compare_metric calls service.compare', async () => {
    const compareMock = vi.fn(async (args) => ({ ...args, delta: 1, percentChange: 0.005 }));
    const { factory } = makeFactory({ compare: compareMock });
    const tool = factory.createTools().find(t => t.name === 'compare_metric');
    await tool.execute({
      userId: 'kc', metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' }, period_b: { rolling: 'prev_30d' },
    });
    expect(compareMock).toHaveBeenCalled();
  });

  it('summarize_change calls service.summarizeChange', async () => {
    const summMock = vi.fn(async () => ({ changeShape: 'monotonic' }));
    const { factory } = makeFactory({ summarizeChange: summMock });
    const tool = factory.createTools().find(t => t.name === 'summarize_change');
    await tool.execute({
      userId: 'kc', metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' }, period_b: { rolling: 'prev_30d' },
    });
    expect(summMock).toHaveBeenCalled();
  });

  it('conditional_aggregate calls service.conditionalAggregate', async () => {
    const condMock = vi.fn(async () => ({ matching: { value: 1, daysMatched: 5 }, notMatching: { value: 2, daysNotMatched: 5 }, delta: -1 }));
    const { factory } = makeFactory({ conditionalAggregate: condMock });
    const tool = factory.createTools().find(t => t.name === 'conditional_aggregate');
    await tool.execute({
      userId: 'kc', metric: 'weight_lbs',
      period: { rolling: 'last_30d' },
      condition: { tracked: true },
    });
    expect(condMock).toHaveBeenCalled();
  });

  it('correlate_metrics calls service.correlateMetrics', async () => {
    const corrMock = vi.fn(async () => ({ correlation: 0.85, interpretation: 'strong-positive' }));
    const { factory } = makeFactory({ correlateMetrics: corrMock });
    const tool = factory.createTools().find(t => t.name === 'correlate_metrics');
    await tool.execute({
      userId: 'kc', metric_a: 'weight_lbs', metric_b: 'calories',
      period: { rolling: 'last_30d' },
    });
    expect(corrMock).toHaveBeenCalled();
  });

  it('aggregate_metric calls service.aggregate with mapped args', async () => {
    const { factory, healthAnalyticsService } = makeFactory();
    const tool = factory.createTools().find(t => t.name === 'aggregate_metric');
    const out = await tool.execute({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { rolling: 'last_30d' },
      statistic: 'mean',
    });
    expect(healthAnalyticsService.aggregate).toHaveBeenCalledWith({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { rolling: 'last_30d' },
      statistic: 'mean',
    });
    expect(out.value).toBe(100);
  });

  it('returns { error } envelope when the service throws', async () => {
    const { factory } = makeFactory({
      aggregate: async () => { throw new Error('unknown metric'); },
    });
    const tool = factory.createTools().find(t => t.name === 'aggregate_metric');
    const out = await tool.execute({ userId: 'kc', metric: 'nope', period: { rolling: 'last_7d' } });
    expect(out.error).toMatch(/unknown metric/);
  });

  it('aggregate_series passes granularity', async () => {
    const { factory, healthAnalyticsService } = makeFactory();
    const tool = factory.createTools().find(t => t.name === 'aggregate_series');
    await tool.execute({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_30d' }, granularity: 'weekly' });
    expect(healthAnalyticsService.aggregateSeries).toHaveBeenCalledWith({
      userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_30d' }, granularity: 'weekly',
    });
  });

  it('metric_snapshot accepts optional metrics list', async () => {
    const { factory, healthAnalyticsService } = makeFactory();
    const tool = factory.createTools().find(t => t.name === 'metric_snapshot');
    await tool.execute({ userId: 'kc', period: { rolling: 'last_30d' }, metrics: ['weight_lbs'] });
    expect(healthAnalyticsService.snapshot).toHaveBeenCalledWith({
      userId: 'kc', period: { rolling: 'last_30d' }, metrics: ['weight_lbs'],
    });
  });
});
