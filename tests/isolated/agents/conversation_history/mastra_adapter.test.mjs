// tests/isolated/agents/conversation_history/mastra_adapter.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { MastraAdapter } from '../../../../backend/src/1_adapters/agents/MastraAdapter.mjs';

const silentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeFakeAgentClass() {
  const recorded = [];
  class FakeAgent {
    constructor(opts) { this.opts = opts; }
    async generate(arg) {
      recorded.push({ method: 'generate', arg });
      return { text: 'ok', toolCalls: [], finishReason: 'stop', usage: null };
    }
    async stream(arg) {
      recorded.push({ method: 'stream', arg });
      return { fullStream: (async function* () { yield { type: 'finish', payload: { finishReason: 'stop' } }; })() };
    }
  }
  return { FakeAgent, recorded };
}

describe('MastraAdapter — messages threading', () => {
  it('execute() calls mastraAgent.generate(messages) when non-empty', async () => {
    const { FakeAgent, recorded } = makeFakeAgentClass();
    const adapter = new MastraAdapter({ logger: silentLogger, agentClass: FakeAgent });
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ];
    await adapter.execute({
      agent: { constructor: { id: 'stub' } },
      agentId: 'stub',
      input: 'second',
      messages,
      tools: [],
      systemPrompt: 'sys',
      context: { userId: 'kc' },
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].method).toBe('generate');
    expect(recorded[0].arg).toEqual(messages);
  });

  it('execute() falls back to generate(input) when messages is empty', async () => {
    const { FakeAgent, recorded } = makeFakeAgentClass();
    const adapter = new MastraAdapter({ logger: silentLogger, agentClass: FakeAgent });
    await adapter.execute({
      agent: { constructor: { id: 'stub' } },
      agentId: 'stub',
      input: 'hi',
      messages: [],
      tools: [],
      systemPrompt: 'sys',
      context: {},
    });
    expect(recorded[0].arg).toBe('hi');
  });

  it('execute() falls back to generate(input) when messages is undefined', async () => {
    const { FakeAgent, recorded } = makeFakeAgentClass();
    const adapter = new MastraAdapter({ logger: silentLogger, agentClass: FakeAgent });
    await adapter.execute({
      agent: { constructor: { id: 'stub' } },
      agentId: 'stub',
      input: 'hi',
      tools: [],
      systemPrompt: 'sys',
      context: {},
    });
    expect(recorded[0].arg).toBe('hi');
  });

  it('streamExecute() calls mastraAgent.stream(messages) when non-empty', async () => {
    const { FakeAgent, recorded } = makeFakeAgentClass();
    const adapter = new MastraAdapter({ logger: silentLogger, agentClass: FakeAgent });
    const messages = [{ role: 'user', content: 'hi' }];
    const iter = adapter.streamExecute({
      agent: { constructor: { id: 'stub' } },
      agentId: 'stub',
      input: 'hi',
      messages,
      tools: [],
      systemPrompt: 'sys',
      context: {},
    });
    for await (const _ of iter) break;
    expect(recorded[0].method).toBe('stream');
    expect(recorded[0].arg).toEqual(messages);
  });

  it('streamExecute() falls back to stream(input) when messages is empty', async () => {
    const { FakeAgent, recorded } = makeFakeAgentClass();
    const adapter = new MastraAdapter({ logger: silentLogger, agentClass: FakeAgent });
    const iter = adapter.streamExecute({
      agent: { constructor: { id: 'stub' } },
      agentId: 'stub',
      input: 'hello',
      messages: [],
      tools: [],
      systemPrompt: 'sys',
      context: {},
    });
    for await (const _ of iter) break;
    expect(recorded[0].arg).toBe('hello');
  });
});
