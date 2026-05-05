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
    ...overrides,
  };
  return { factory: new HealthAnalyticsToolFactory({ healthAnalyticsService }), healthAnalyticsService };
}

describe('HealthAnalyticsToolFactory', () => {
  it('createTools returns 5 tools with the expected names', () => {
    const { factory } = makeFactory();
    const tools = factory.createTools();
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual([
      'aggregate_metric',
      'aggregate_series',
      'metric_distribution',
      'metric_percentile',
      'metric_snapshot',
    ]);
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
