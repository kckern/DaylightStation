// tests/isolated/adapters/agents/MastraAdapter.memory.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { MastraAdapter } from '../../../../backend/src/1_adapters/agents/MastraAdapter.mjs';

const silentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

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
    const adapter = new MastraAdapter({ logger: silentLogger, agentClass: FakeAgent, memory: fakeMemory });
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
    const adapter = new MastraAdapter({ logger: silentLogger, agentClass: FakeAgent, memory: fakeMemory });
    await adapter.execute({
      agent: { constructor: { id: 'stub' } },
      agentId: 'stub',
      input: 'hi',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      systemPrompt: 'sys',
      context: { userId: 'kc', threadId: 'T-1' },
    });
    expect(recorded[0].memOpts).toEqual({ memory: { resource: 'kc', thread: 'T-1' } });
  });

  it('does NOT pass memory opts when threadId is missing', async () => {
    const fakeMemory = { __isFakeMemory: true };
    const { FakeAgent, recorded } = makeFakeAgentClass();
    const adapter = new MastraAdapter({ logger: silentLogger, agentClass: FakeAgent, memory: fakeMemory });
    await adapter.execute({
      agent: { constructor: { id: 'stub' } },
      agentId: 'stub',
      input: 'hi',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      systemPrompt: 'sys',
      context: { userId: 'kc' },  // no threadId
    });
    expect(recorded[0].memOpts).toBeUndefined();
  });

  it('does NOT pass memory at all when adapter has no memory configured', async () => {
    const { FakeAgent, recorded } = makeFakeAgentClass();
    const adapter = new MastraAdapter({ logger: silentLogger, agentClass: FakeAgent });  // no memory
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
    expect(recorded[0].memOpts).toBeUndefined();
  });

  it('streamExecute passes same memory opts', async () => {
    const fakeMemory = { __isFakeMemory: true };
    const { FakeAgent, recorded } = makeFakeAgentClass();
    const adapter = new MastraAdapter({ logger: silentLogger, agentClass: FakeAgent, memory: fakeMemory });
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
    expect(recorded[0].memOpts).toEqual({ memory: { resource: 'kc', thread: 'T-2' } });
  });
});
