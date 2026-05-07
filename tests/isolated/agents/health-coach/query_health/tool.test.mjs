// tests/isolated/agents/health-coach/query_health/tool.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { HealthQueryToolFactory } from '../../../../../backend/src/3_applications/agents/health-coach/tools/HealthQueryToolFactory.mjs';

function makeFactory() {
  const queryService = { query: vi.fn(async () => ({ value: 1462, count: 30, meta: { metric: 'calories' } })) };
  const sandbox      = { evaluate: vi.fn(() => ({ value: 1986, type: 'number', expression: '...', durationMs: 1 })) };
  const constantsService = { get: vi.fn(async () => ({ height_cm: 180, age: 40, sex: 'M' })) };
  return { factory: new HealthQueryToolFactory({ queryService, sandbox, constantsService }), queryService, sandbox, constantsService };
}

describe('HealthQueryToolFactory', () => {
  it('produces three tools', () => {
    const { factory } = makeFactory();
    const tools = factory.createTools();
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual(['compute', 'personal_constants', 'query_health']);
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
});
