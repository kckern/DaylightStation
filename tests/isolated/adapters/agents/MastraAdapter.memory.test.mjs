// tests/isolated/adapters/agents/MastraAdapter.memory.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { MastraAdapter } from "../../../../__capabilities/agent-runtime/server/adapters/MastraAdapter.mjs";
import { AgentExecutionPolicy } from "../../../../__capabilities/agent-runtime/server/application/framework/AgentExecutionPolicy.mjs";

const silentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
const createAdapter = (deps = {}) => new MastraAdapter({
  ...deps,
  executionPolicy: new AgentExecutionPolicy({ logger: deps.logger || silentLogger }),
});

function makeFakeAgentClass() {
  const recorded = [];
  class FakeAgent {
    constructor(opts) { this.opts = opts; }
    async generate(arg, memOpts) {
      recorded.push({ method: 'generate', arg, memOpts, ctorOpts: this.opts });
      return { text: 'ok', toolCalls: [], finishReason: 'stop', usage: null };
    }
    async stream(arg, memOpts) {
      recorded.push({ method: 'stream', arg, memOpts, ctorOpts: this.opts });
      return {
        fullStream: (async function* () {
          yield { type: 'finish', payload: { stepResult: { reason: 'stop' }, output: { usage: null } } };
        })(),
      };
    }
  }
  return { FakeAgent, recorded };
}

describe('MastraAdapter — memory wiring', () => {
  it('passes memory to Agent constructor when memory is configured', async () => {
    const fakeMemory = { __isFakeMemory: true };
    const { FakeAgent, recorded } = makeFakeAgentClass();
    const adapter = createAdapter({ logger: silentLogger, agentClass: FakeAgent, memory: fakeMemory });
    await adapter.execute({
      agent: { constructor: { id: 'stub' } },
      agentId: 'stub',
      input: 'hi',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      systemPrompt: 'sys',
      context: { userId: 'kc', threadId: 'T-1' },
    });
    expect(recorded[0].ctorOpts.memory).toBe(fakeMemory);
  });

  it('passes { memory: { resource, thread } } to generate when threadId + userId both present', async () => {
    const fakeMemory = { __isFakeMemory: true };
    const { FakeAgent, recorded } = makeFakeAgentClass();
    const adapter = createAdapter({ logger: silentLogger, agentClass: FakeAgent, memory: fakeMemory });
    await adapter.execute({
      agent: { constructor: { id: 'stub' } },
      agentId: 'stub',
      input: 'hi',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      systemPrompt: 'sys',
      context: { userId: 'kc', threadId: 'T-1' },
    });
    expect(recorded[0].memOpts).toMatchObject({ memory: { resource: 'kc', thread: 'T-1' } });
  });

  it('does NOT pass memory opts when threadId is missing', async () => {
    const fakeMemory = { __isFakeMemory: true };
    const { FakeAgent, recorded } = makeFakeAgentClass();
    const adapter = createAdapter({ logger: silentLogger, agentClass: FakeAgent, memory: fakeMemory });
    await adapter.execute({
      agent: { constructor: { id: 'stub' } },
      agentId: 'stub',
      input: 'hi',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      systemPrompt: 'sys',
      context: { userId: 'kc' },  // no threadId
    });
    expect(recorded[0].memOpts.memory).toBeUndefined();
  });

  it('does NOT pass memory at all when adapter has no memory configured', async () => {
    const { FakeAgent, recorded } = makeFakeAgentClass();
    const adapter = createAdapter({ logger: silentLogger, agentClass: FakeAgent });  // no memory
    await adapter.execute({
      agent: { constructor: { id: 'stub' } },
      agentId: 'stub',
      input: 'hi',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      systemPrompt: 'sys',
      context: { userId: 'kc', threadId: 'T-1' },
    });
    expect(recorded[0].ctorOpts.memory).toBeUndefined();
    expect(recorded[0].memOpts.memory).toBeUndefined();
  });

  it('streamExecute passes same memory opts', async () => {
    const fakeMemory = { __isFakeMemory: true };
    const { FakeAgent, recorded } = makeFakeAgentClass();
    const adapter = createAdapter({ logger: silentLogger, agentClass: FakeAgent, memory: fakeMemory });
    const iter = adapter.streamExecute({
      agent: { constructor: { id: 'stub' } },
      agentId: 'stub',
      input: 'hi',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      systemPrompt: 'sys',
      context: { userId: 'kc', threadId: 'T-2' },
    });
    // drain
    for await (const _ of iter) { /* consume */ }
    expect(recorded[0].method).toBe('stream');
    expect(recorded[0].memOpts).toMatchObject({ memory: { resource: 'kc', thread: 'T-2' } });
  });
});

// Clearing supplied tools alone cannot suppress SDK-added working-memory tools.
// An explicit per-request opt-out must omit both SDK memory attachment and scope.
it.each(['execute', 'streamExecute'])('%s memory:false disables configured memory for only that request', async method => {
  const { MASTRA_RESOURCE_ID_KEY, MASTRA_THREAD_ID_KEY } = await import('@mastra/core/request-context');
  const fakeMemory = { __isFakeMemory: true };
  const { FakeAgent, recorded } = makeFakeAgentClass();
  const adapter = createAdapter({ logger: silentLogger, agentClass: FakeAgent, memory: fakeMemory });
  const request = { agentId: 'stub', input: 'automated task', tools: [], systemPrompt: 'sys',
    context: { userId: 'kc', threadId: 'T-1' } };
  if (method === 'streamExecute') {
    for await (const _ of adapter.streamExecute({ ...request, memory: false })) { /* consume */ }
  } else {
    await adapter.execute({ ...request, memory: false });
  }
  expect(recorded[0].ctorOpts).not.toHaveProperty('memory');
  expect(recorded[0].memOpts).not.toHaveProperty('memory');
  expect(recorded[0].memOpts.requestContext.get(MASTRA_RESOURCE_ID_KEY)).toBeUndefined();
  expect(recorded[0].memOpts.requestContext.get(MASTRA_THREAD_ID_KEY)).toBeUndefined();
  // Context remains available for identity and tracing; memory is an independent capability.
  expect(recorded[0].memOpts.requestContext.get('threadId')).toBe('T-1');

  await adapter.execute(request);
  expect(recorded[1].ctorOpts.memory).toBe(fakeMemory);
  expect(recorded[1].memOpts.memory).toEqual({ resource: 'kc', thread: 'T-1' });
});

it('threaded automated assignment opts out at the real runtime adapter boundary', async () => {
  const { EndOfDayReport } = await import('../../../../__app_modules/wellness/health/server/application/agents/health-coach/assignments/EndOfDayReport.mjs');
  const { FakeAgent, recorded } = makeFakeAgentClass();
  const adapter = createAdapter({ logger: silentLogger, agentClass: FakeAgent, memory: { __isFakeMemory: true } });
  const result = await new EndOfDayReport().execute({ agentRuntime: adapter, tools: [], userId: 'kc', agentId: 'health-coach',
    context: { threadId: 'assignment-thread' }, logger: silentLogger,
    workingMemory: { load: async () => ({ pruneExpired() {}, serialize: () => '', set() {} }), save: async () => {} },
  });
  expect(recorded[0].ctorOpts).not.toHaveProperty('memory');
  expect(recorded[0].ctorOpts.tools).toEqual({});
  expect(recorded[0].memOpts).not.toHaveProperty('memory');
  expect(result.text).toContain('Calorie-budget evidence is unavailable');
});
