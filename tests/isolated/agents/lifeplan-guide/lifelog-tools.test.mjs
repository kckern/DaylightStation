import { describe, it, expect, beforeEach } from '@jest/globals';
import { LifelogToolFactory } from '#apps/agents/lifeplan-guide/tools/LifelogToolFactory.mjs';

describe('LifelogToolFactory', () => {
  let factory, tools;

  beforeEach(() => {
    factory = new LifelogToolFactory({
      aggregator: {
        aggregateRange: async () => ({
          days: { '2025-06-01': { sources: { strava: [] }, categories: {} } },
          _meta: { dayCount: 1, availableSources: ['strava', 'calendar'] },
        }),
        getAvailableSources: () => ['strava', 'calendar', 'todoist'],
      },
      metricsStore: {
        getLatest: () => ({ date: '2025-06-01', allocation: {} }),
      },
      driftService: {
        getLatestSnapshot: () => ({ correlation: 0.8, status: 'aligned' }),
      },
    });
    tools = factory.createTools();
  });

  it('creates 4 tools', () => {
    expect(tools).toHaveLength(4);
    const names = tools.map(t => t.name);
    expect(names).toContain('query_lifelog_range');
    expect(names).toContain('get_available_sources');
    expect(names).toContain('get_metrics_snapshot');
    expect(names).toContain('get_value_allocation');
  });

  it('query_lifelog_range returns structured data', async () => {
    const tool = tools.find(t => t.name === 'query_lifelog_range');
    const result = await tool.execute({ username: 'test', start: '2025-06-01', end: '2025-06-01' });
    expect(result.days).toBeDefined();
    expect(result._meta.dayCount).toBe(1);
  });

  it('get_available_sources returns source list', async () => {
    const tool = tools.find(t => t.name === 'get_available_sources');
    const result = await tool.execute({});
    expect(result.sources).toContain('strava');
  });

  it('get_value_allocation returns drift data', async () => {
    const tool = tools.find(t => t.name === 'get_value_allocation');
    const result = await tool.execute({ username: 'test' });
    expect(result.correlation).toBe(0.8);
  });
});
