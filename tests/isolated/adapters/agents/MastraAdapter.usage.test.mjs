// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { MastraAdapter } from '#adapters/agents/MastraAdapter.mjs';
import { AgentExecutionPolicy } from '#apps/agents/framework/AgentExecutionPolicy.mjs';

const logger = { info() {}, debug() {}, warn() {}, error() {} };
const adapter = deps => new MastraAdapter({ logger, executionPolicy: new AgentExecutionPolicy({ logger }), ...deps });

class FakeAgent {
  constructor(opts) { FakeAgent.last = opts; }
  async generate() { return { text: 'ok', finishReason: 'stop', totalUsage: { inputTokens: 1000, outputTokens: 20, cachedInputTokens: 100 } }; }
  stream() {
    const parts = [
      { type: 'text-delta', payload: { text: 'ok' } },
      { type: 'finish', payload: { stepResult: { reason: 'stop' }, output: { usage: { inputTokens: 500, outputTokens: 10 } } } },
    ];
    return { fullStream: (async function* () { yield* parts; })() };
  }
}

const drain = async iterable => { const chunks = []; for await (const chunk of iterable) chunks.push(chunk); return chunks; };

describe('MastraAdapter usage recording', () => {
  it('records usage for every execute and returns it with cost', async () => {
    const usageRecorder = vi.fn(() => ({ costUsd: 0.0025 }));
    const runtime = adapter({ agentClass: FakeAgent, usageRecorder, model: 'openai/gpt-4o' });
    const result = await runtime.execute({ agentId: 'nutrition-auditor', input: 'x', tools: [], context: { userId: 'u', runId: 'audit_1' } });
    expect(usageRecorder).toHaveBeenCalledOnce();
    expect(usageRecorder).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'nutrition-auditor', runId: 'audit_1',
      model: { provider: 'openai', name: 'gpt-4o' }, status: 'ok', usage: expect.objectContaining({ inputTokens: 1000 }) }));
    expect(result).toMatchObject({ costUsd: 0.0025, model: { provider: 'openai', name: 'gpt-4o' },
      usage: expect.objectContaining({ inputTokens: 1000 }) });
  });

  it('uses a per-call model override', async () => {
    const usageRecorder = vi.fn(() => null);
    const runtime = adapter({ agentClass: FakeAgent, usageRecorder, model: 'openai/gpt-4o' });
    const result = await runtime.execute({ agentId: 'a', input: 'x', tools: [], model: 'openai/gpt-4.1-mini' });
    expect(FakeAgent.last.model).toBe('openai/gpt-4.1-mini');
    expect(usageRecorder).toHaveBeenCalledWith(expect.objectContaining({ model: { provider: 'openai', name: 'gpt-4.1-mini' } }));
    expect(result).toMatchObject({ costUsd: null, model: { provider: 'openai', name: 'gpt-4.1-mini' } });
  });

  it('records a failed turn', async () => {
    class Boom { async generate() { throw new Error('boom'); } }
    const usageRecorder = vi.fn();
    await expect(adapter({ agentClass: Boom, usageRecorder }).execute({ agentId: 'a', input: 'x', tools: [] })).rejects.toThrow('boom');
    expect(usageRecorder).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', error: 'boom', usage: null }));
  });

  it('never lets a throwing recorder replace the result or the original error', async () => {
    const usageRecorder = vi.fn(() => { throw new Error('ledger down'); });
    const result = await adapter({ agentClass: FakeAgent, usageRecorder }).execute({ agentId: 'a', input: 'x', tools: [] });
    expect(result).toMatchObject({ output: 'ok', costUsd: null });
    class Boom { async generate() { throw new Error('boom'); } }
    await expect(adapter({ agentClass: Boom, usageRecorder }).execute({ agentId: 'a', input: 'x', tools: [] })).rejects.toThrow('boom');
  });

  it('works without a recorder', async () => {
    const result = await adapter({ agentClass: FakeAgent }).execute({ agentId: 'a', input: 'x', tools: [] });
    expect(result).toMatchObject({ output: 'ok', costUsd: null });
  });

  it('records a streamed turn once with the finish usage', async () => {
    const usageRecorder = vi.fn(() => ({ costUsd: 0.001 }));
    const runtime = adapter({ agentClass: FakeAgent, usageRecorder, model: 'openai/gpt-4o' });
    await drain(runtime.streamExecute({ agentId: 's', input: 'x', tools: [], model: 'openai/gpt-4.1-mini', context: { runId: 'run_s' } }));
    expect(FakeAgent.last.model).toBe('openai/gpt-4.1-mini');
    expect(usageRecorder).toHaveBeenCalledOnce();
    expect(usageRecorder).toHaveBeenCalledWith(expect.objectContaining({ agentId: 's', runId: 'run_s', status: 'ok',
      model: { provider: 'openai', name: 'gpt-4.1-mini' }, usage: { inputTokens: 500, outputTokens: 10 } }));
  });

  it('records a failed streamed turn', async () => {
    class BoomStream { stream() { throw new Error('stream boom'); } }
    const usageRecorder = vi.fn();
    await expect(drain(adapter({ agentClass: BoomStream, usageRecorder }).streamExecute({ agentId: 's', input: 'x', tools: [] })))
      .rejects.toThrow('stream boom');
    expect(usageRecorder).toHaveBeenCalledOnce();
    expect(usageRecorder).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', error: 'stream boom' }));
  });

  it('records a turn once when the scope times out during evaluate', async () => {
    const usageRecorder = vi.fn(() => ({ costUsd: 0.0025 }));
    const evaluate = () => new Promise(resolve => setTimeout(resolve, 200));
    const runtime = adapter({ agentClass: FakeAgent, usageRecorder, hooks: { evaluate } });
    await expect(runtime.execute({ agentId: 'a', input: 'x', tools: [], limits: { timeoutMs: 20 } }))
      .rejects.toMatchObject({ name: 'TimeoutError' });
    expect(usageRecorder).toHaveBeenCalledOnce();
  });

  it('records the spent usage when the output fails its schema', async () => {
    const usageRecorder = vi.fn();
    const runtime = adapter({ agentClass: FakeAgent, usageRecorder });
    await expect(runtime.execute({ agentId: 'a', input: 'x', tools: [], outputSchema: {
      type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } },
    } })).rejects.toThrow();
    expect(usageRecorder).toHaveBeenCalledOnce();
    expect(usageRecorder).toHaveBeenCalledWith(expect.objectContaining({ status: 'error',
      usage: expect.objectContaining({ inputTokens: 1000, outputTokens: 20 }) }));
  });

  it('records a stream the consumer closes early', async () => {
    const usageRecorder = vi.fn();
    const runtime = adapter({ agentClass: FakeAgent, usageRecorder });
    for await (const _chunk of runtime.streamExecute({ agentId: 's', input: 'x', tools: [] })) break;
    expect(usageRecorder).toHaveBeenCalledOnce();
    expect(usageRecorder).toHaveBeenCalledWith(expect.objectContaining({ status: 'aborted', error: 'stream closed early', usage: null }));
  });
});
