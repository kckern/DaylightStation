// tests/isolated/agents/health-coach/query_health/tool.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { HealthQueryToolFactory } from '../../../../../backend/src/3_applications/agents/health-coach/tools/HealthQueryToolFactory.mjs';

function makeFactory() {
  const queryService = { query: vi.fn(async () => ({ value: 1462, count: 30, meta: { metric: 'calories' } })) };
  const sandbox      = { evaluate: vi.fn(() => ({ value: 1986, type: 'number', expression: '...', durationMs: 1 })) };
  const constantsService = { get: vi.fn(async () => ({ height_cm: 180, age: 40, sex: 'M' })) };
  const eventQueryService = {
    queryEvents: vi.fn(async () => ({ events: [{ session_id: '1', strava_id: 12345, type: 'Run' }], meta: { kind: 'workout', n: 1 } })),
    getEventDetail: vi.fn(async () => ({ session_id: '1', strava_id: 12345, timeline: { series: { kc: [120, 130] }, events: [] } })),
  };
  return {
    factory: new HealthQueryToolFactory({ queryService, sandbox, constantsService, eventQueryService }),
    queryService,
    sandbox,
    constantsService,
    eventQueryService,
  };
}

describe('HealthQueryToolFactory', () => {
  it('produces five tools', () => {
    const { factory } = makeFactory();
    const names = factory.createTools().map(t => t.name).sort();
    expect(names).toEqual(['compute', 'get_event_detail', 'personal_constants', 'query_events', 'query_health']);
  });

  it('query_health forwards to service with userId injected', async () => {
    const { factory, queryService } = makeFactory();
    const tool = factory.createTools().find(t => t.name === 'query_health');
    const r = await tool.execute({ metric: 'calories', period: { rolling: 'last_30d' }, aggregate: 'mean', userId: 'kc' });
    expect(queryService.query).toHaveBeenCalledWith(expect.objectContaining({
      metric: 'calories', userId: 'kc', aggregate: 'mean',
    }));
    expect(r.value).toBe(1462);
  });

  it('compute forwards to sandbox', async () => {
    const { factory, sandbox } = makeFactory();
    const tool = factory.createTools().find(t => t.name === 'compute');
    const r = await tool.execute({ expression: 'a + b', inputs: { a: 1, b: 2 } });
    expect(sandbox.evaluate).toHaveBeenCalledWith('a + b', { a: 1, b: 2 });
    expect(r.value).toBe(1986);
  });

  it('personal_constants forwards to service', async () => {
    const { factory, constantsService } = makeFactory();
    const tool = factory.createTools().find(t => t.name === 'personal_constants');
    const r = await tool.execute({ userId: 'kc' });
    expect(constantsService.get).toHaveBeenCalledWith('kc');
    expect(r.height_cm).toBe(180);
  });

  it('query_health declares the parameter shape (metric, period, aggregate, etc.)', () => {
    const { factory } = makeFactory();
    const tool = factory.createTools().find(t => t.name === 'query_health');
    const props = tool.parameters.properties;
    expect(props).toHaveProperty('metric');
    expect(props).toHaveProperty('period');
    expect(props).toHaveProperty('granularity');
    expect(props).toHaveProperty('aggregate');
    expect(props).toHaveProperty('group_by');
    expect(props).toHaveProperty('filter');
    expect(props).toHaveProperty('join');
    expect(props).toHaveProperty('correlate');
    expect(props).toHaveProperty('rolling');
    expect(tool.parameters.required).toContain('metric');
    expect(tool.parameters.required).toContain('period');
  });

  it('query_events forwards to eventQueryService', async () => {
    const { factory, eventQueryService } = makeFactory();
    const tool = factory.createTools().find(t => t.name === 'query_events');
    const r = await tool.execute({ kind: 'workout', period: { rolling: 'last_7d' } });
    expect(eventQueryService.queryEvents).toHaveBeenCalled();
    expect(r.events).toHaveLength(1);
    expect(r.events[0].strava_id).toBe(12345);
  });

  it('get_event_detail forwards to eventQueryService', async () => {
    const { factory, eventQueryService } = makeFactory();
    const tool = factory.createTools().find(t => t.name === 'get_event_detail');
    const r = await tool.execute({ id: '20260507060000' });
    expect(eventQueryService.getEventDetail).toHaveBeenCalledWith({ id: '20260507060000' });
    expect(r.timeline.series.kc).toEqual([120, 130]);
  });
});
