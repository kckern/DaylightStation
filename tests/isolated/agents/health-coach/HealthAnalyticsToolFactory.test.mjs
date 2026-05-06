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
    trajectory:           vi.fn(async (args) => ({ ...args, slope: 0, direction: 'flat' })),
    detectRegimeChange:   vi.fn(async (args) => ({ ...args, changes: [] })),
    detectAnomalies:      vi.fn(async (args) => ({ ...args, anomalies: [], count: 0 })),
    detectSustained:      vi.fn(async (args) => ({ ...args, runs: [] })),
    listPeriods:     vi.fn(async () => ({ periods: [] })),
    deducePeriod:    vi.fn(async () => ({ candidates: [] })),
    rememberPeriod:  vi.fn(async () => ({ slug: 'x' })),
    forgetPeriod:    vi.fn(async () => ({ slug: 'x', removed: true })),
    analyzeHistory:  vi.fn(async () => ({ summary: { metrics: [] }, candidates: [], observations: [] })),
    ...overrides,
  };
  return { factory: new HealthAnalyticsToolFactory({ healthAnalyticsService }), healthAnalyticsService };
}

describe('HealthAnalyticsToolFactory', () => {
  it('createTools returns 13 tools after Plan 3', () => {
    const { factory } = makeFactory();
    const names = factory.createTools().map(t => t.name).sort();
    expect(names).toEqual([
      'aggregate_metric', 'aggregate_series',
      'analyze_history',
      'compare_metric', 'conditional_aggregate', 'correlate_metrics',
      'deduce_period',
      'detect_anomalies', 'detect_regime_change', 'detect_sustained',
      'forget_period',
      'list_periods',
      'metric_distribution', 'metric_percentile', 'metric_snapshot',
      'metric_trajectory',
      'remember_period',
      'summarize_change',
    ]);
  });

  it('createTools returns 18 tools after Plan 4', () => {
    const { factory } = makeFactory();
    const names = factory.createTools().map(t => t.name).sort();
    expect(names).toContain('list_periods');
    expect(names).toContain('deduce_period');
    expect(names).toContain('remember_period');
    expect(names).toContain('forget_period');
    expect(names).toContain('analyze_history');
    expect(names.length).toBe(18);
  });

  it('metric_trajectory calls service.trajectory', async () => {
    const trajMock = vi.fn(async () => ({ slope: -0.1, direction: 'down' }));
    const { factory } = makeFactory({ trajectory: trajMock });
    const tool = factory.createTools().find(t => t.name === 'metric_trajectory');
    await tool.execute({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_30d' } });
    expect(trajMock).toHaveBeenCalled();
  });

  it('detect_regime_change calls service.detectRegimeChange', async () => {
    const rcMock = vi.fn(async () => ({ changes: [] }));
    const { factory } = makeFactory({ detectRegimeChange: rcMock });
    const tool = factory.createTools().find(t => t.name === 'detect_regime_change');
    await tool.execute({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_2y' } });
    expect(rcMock).toHaveBeenCalled();
  });

  it('detect_anomalies calls service.detectAnomalies', async () => {
    const anMock = vi.fn(async () => ({ anomalies: [], count: 0 }));
    const { factory } = makeFactory({ detectAnomalies: anMock });
    const tool = factory.createTools().find(t => t.name === 'detect_anomalies');
    await tool.execute({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_90d' } });
    expect(anMock).toHaveBeenCalled();
  });

  it('detect_sustained calls service.detectSustained', async () => {
    const susMock = vi.fn(async () => ({ runs: [] }));
    const { factory } = makeFactory({ detectSustained: susMock });
    const tool = factory.createTools().find(t => t.name === 'detect_sustained');
    await tool.execute({
      userId: 'kc', metric: 'weight_lbs',
      period: { rolling: 'last_year' },
      condition: { value_range: [193, 197] },
      min_duration_days: 30,
    });
    expect(susMock).toHaveBeenCalled();
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

  it('list_periods calls service.listPeriods', async () => {
    const m = vi.fn(async () => ({ periods: [] }));
    const { factory } = makeFactory({ listPeriods: m });
    const tool = factory.createTools().find(t => t.name === 'list_periods');
    await tool.execute({ userId: 'kc' });
    expect(m).toHaveBeenCalled();
  });

  it('deduce_period calls service.deducePeriod', async () => {
    const m = vi.fn(async () => ({ candidates: [] }));
    const { factory } = makeFactory({ deducePeriod: m });
    const tool = factory.createTools().find(t => t.name === 'deduce_period');
    await tool.execute({
      userId: 'kc',
      criteria: { metric: 'weight_lbs', value_range: [193, 197], min_duration_days: 30 },
    });
    expect(m).toHaveBeenCalled();
  });

  it('remember_period calls service.rememberPeriod', async () => {
    const m = vi.fn(async () => ({ slug: 'x' }));
    const { factory } = makeFactory({ rememberPeriod: m });
    const tool = factory.createTools().find(t => t.name === 'remember_period');
    await tool.execute({
      userId: 'kc', slug: 'stable-195',
      from: '2024-08-01', to: '2024-11-15', label: 'Stable 195',
    });
    expect(m).toHaveBeenCalled();
  });

  it('forget_period calls service.forgetPeriod', async () => {
    const m = vi.fn(async () => ({ slug: 'x', removed: true }));
    const { factory } = makeFactory({ forgetPeriod: m });
    const tool = factory.createTools().find(t => t.name === 'forget_period');
    await tool.execute({ userId: 'kc', slug: 'stable-195' });
    expect(m).toHaveBeenCalled();
  });

  it('analyze_history calls service.analyzeHistory', async () => {
    const m = vi.fn(async () => ({ summary: { metrics: [] }, candidates: [], observations: [] }));
    const { factory } = makeFactory({ analyzeHistory: m });
    const tool = factory.createTools().find(t => t.name === 'analyze_history');
    await tool.execute({ userId: 'kc' });
    expect(m).toHaveBeenCalled();
  });
});
