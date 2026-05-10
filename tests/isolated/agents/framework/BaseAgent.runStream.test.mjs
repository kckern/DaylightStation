// tests/isolated/agents/framework/BaseAgent.runStream.test.mjs
//
// runStream no longer touches the per-agent YAML working-memory store —
// free-form user context is owned by Mastra Memory, persisted by the runtime.
// These tests cover the streaming contract (chunks, context, error paths).
import { describe, it, expect, vi } from 'vitest';
import { BaseAgent } from '../../../../backend/src/3_applications/agents/framework/BaseAgent.mjs';

class FakeAgent extends BaseAgent {
  static id = 'fake';
  getSystemPrompt() { return 'SYS'; }
}

describe('BaseAgent.runStream', () => {
  it('yields chunks from agentRuntime.streamExecute', async () => {
    async function* fakeStream() {
      yield { type: 'text-delta', text: 'Hi ' };
      yield { type: 'text-delta', text: 'there' };
      yield { type: 'finish', reason: 'stop', usage: { totalTokens: 10 } };
    }
    const agentRuntime = { streamExecute: vi.fn(() => fakeStream()) };
    const agent = new FakeAgent({ agentRuntime });

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
    const agent = new FakeAgent({ agentRuntime });
    for await (const _ of agent.runStream('hi', { context: { userId: 'kc' } })) { /* drain */ }
    expect(capturedContext.mode).toBe('chat');
  });

  it('does not require workingMemory in chat path', async () => {
    async function* fakeStream() { yield { type: 'finish' }; }
    const agent = new FakeAgent({
      agentRuntime: { streamExecute: () => fakeStream() },
      // no workingMemory — chat path must work without it
    });
    const collected = [];
    for await (const chunk of agent.runStream('hi', { context: { userId: 'kc' } })) {
      collected.push(chunk);
    }
    expect(collected).toHaveLength(1);
  });

  it('propagates errors from the runtime stream to the consumer', async () => {
    async function* fakeStream() {
      yield { type: 'text-delta', text: 'partial' };
      throw new Error('boom');
    }
    const agent = new FakeAgent({
      agentRuntime: { streamExecute: () => fakeStream() },
    });
    await expect((async () => {
      for await (const _ of agent.runStream('hi', { context: { userId: 'kc' } })) { /* drain */ }
    })()).rejects.toThrow('boom');
  });
});
