// tests/isolated/agents/framework/BaseAgent.runStream.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { BaseAgent } from '../../../../backend/src/3_applications/agents/framework/BaseAgent.mjs';

class FakeAgent extends BaseAgent {
  static id = 'fake';
  getSystemPrompt() { return 'SYS'; }
}

async function* finishStream() {
  yield { type: 'text-delta', text: 'Hi ' };
  yield { type: 'finish', reason: 'stop', usage: { totalTokens: 5 } };
}

const baseDeps = {
  agentRuntime: { streamExecute: vi.fn(() => finishStream()) },
  workingMemory: { load: vi.fn(async () => null), save: vi.fn(async () => {}) },
};

describe('BaseAgent.runStream', () => {
  it('yields chunks from agentRuntime.streamExecute', async () => {
    async function* fakeStream() {
      yield { type: 'text-delta', text: 'Hi ' };
      yield { type: 'text-delta', text: 'there' };
      yield { type: 'finish', reason: 'stop', usage: { totalTokens: 10 } };
    }
    const agentRuntime = { streamExecute: vi.fn(() => fakeStream()) };
    const agent = new FakeAgent({
      agentRuntime,
      workingMemory: { load: async () => null, save: async () => {} },
    });

    const collected = [];
    for await (const chunk of agent.runStream('hi', { context: { userId: 'kc' } })) {
      collected.push(chunk);
    }
    expect(collected).toHaveLength(3);
    expect(collected[0].type).toBe('text-delta');
    expect(collected[2].type).toBe('finish');
    expect(agentRuntime.streamExecute).toHaveBeenCalled();
  });

  it('passes mode default chat in context', async () => {
    let capturedContext;
    async function* fakeStream() { yield { type: 'finish' }; }
    const agentRuntime = { streamExecute: vi.fn((args) => {
      capturedContext = args.context;
      return fakeStream();
    }) };
    const agent = new FakeAgent({
      agentRuntime,
      workingMemory: { load: async () => null, save: async () => {} },
    });
    for await (const _ of agent.runStream('hi', { context: { userId: 'kc' } })) { /* drain */ }
    expect(capturedContext.mode).toBe('chat');
  });

  it('saves memory when userId is present', async () => {
    const save = vi.fn(async () => {});
    const load = vi.fn(async () => ({ scratch: 'm', serialize: () => 'scratch: m' }));
    async function* fakeStream() { yield { type: 'finish' }; }
    const agent = new FakeAgent({
      agentRuntime: { streamExecute: () => fakeStream() },
      workingMemory: { load, save },
    });
    for await (const _ of agent.runStream('hi', { context: { userId: 'kc' } })) { /* drain */ }
    expect(save).toHaveBeenCalledWith('fake', 'kc', expect.objectContaining({ scratch: 'm' }));
  });

  it('does not load or save memory when userId is absent', async () => {
    const load = vi.fn();
    const save = vi.fn();
    async function* fakeStream() { yield { type: 'finish' }; }
    const agent = new FakeAgent({
      agentRuntime: { streamExecute: () => fakeStream() },
      workingMemory: { load, save },
    });
    for await (const _ of agent.runStream('hi', { context: {} })) { /* drain */ }
    expect(load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('propagates errors from the runtime stream to the consumer', async () => {
    async function* fakeStream() {
      yield { type: 'text-delta', text: 'partial' };
      throw new Error('boom');
    }
    const agent = new FakeAgent({
      agentRuntime: { streamExecute: () => fakeStream() },
      workingMemory: { load: async () => null, save: async () => {} },
    });
    await expect((async () => {
      for await (const _ of agent.runStream('hi', { context: { userId: 'kc' } })) { /* drain */ }
    })()).rejects.toThrow('boom');
  });
});
