import { describe, it, expect, vi } from 'vitest';
import { BaseAgent } from '../../../../backend/src/3_applications/agents/framework/BaseAgent.mjs';

class StubAgent extends BaseAgent {
  static id = 'stub';
  static description = 'Stub agent for testing';
  async getSystemPrompt() { return 'system'; }
  registerTools() { /* none */ }
}

function makeStub({ executeMock, streamExecuteMock } = {}) {
  const agent = new StubAgent({
    workingMemory: { load: vi.fn(async () => null), save: vi.fn() },
    agentRuntime: {
      execute: executeMock || vi.fn(async () => ({ output: 'ok', toolCalls: [], turnId: 't' })),
      streamExecute: streamExecuteMock || vi.fn(async function* () { yield { type: 'finish' }; }),
    },
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  return agent;
}

describe('BaseAgent — messages threading', () => {
  it('extracts context.messages and passes to agentRuntime.execute as separate field', async () => {
    const executeMock = vi.fn(async () => ({ output: 'ok', toolCalls: [], turnId: 't' }));
    const agent = makeStub({ executeMock });
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ];
    await agent.run('second', { context: { userId: 'kckern', messages } });
    expect(executeMock).toHaveBeenCalledOnce();
    const call = executeMock.mock.calls[0][0];
    expect(call.messages).toEqual(messages);
    expect(call.input).toBe('second');
    // messages should not also appear inside context (cleaner separation)
    expect(call.context.messages).toBeUndefined();
  });

  it('passes empty array when context.messages is missing', async () => {
    const executeMock = vi.fn(async () => ({ output: 'ok', toolCalls: [], turnId: 't' }));
    const agent = makeStub({ executeMock });
    await agent.run('hi', { context: { userId: 'kckern' } });
    const call = executeMock.mock.calls[0][0];
    expect(call.messages).toEqual([]);
  });

  it('threads messages through runStream as well', async () => {
    const streamExecuteMock = vi.fn(async function* () { yield { type: 'finish' }; });
    const agent = makeStub({ streamExecuteMock });
    const messages = [{ role: 'user', content: 'hi' }];
    const iter = agent.runStream('hi', { context: { userId: 'kc', messages } });
    for await (const _ of iter) break;
    const call = streamExecuteMock.mock.calls[0][0];
    expect(call.messages).toEqual(messages);
    expect(call.context.messages).toBeUndefined();
  });

  it('rejects non-array context.messages by passing empty array', async () => {
    const executeMock = vi.fn(async () => ({ output: 'ok', toolCalls: [], turnId: 't' }));
    const agent = makeStub({ executeMock });
    await agent.run('hi', { context: { userId: 'kckern', messages: 'oops' } });
    const call = executeMock.mock.calls[0][0];
    expect(call.messages).toEqual([]);
  });
});
