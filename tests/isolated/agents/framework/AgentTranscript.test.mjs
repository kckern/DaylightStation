// tests/isolated/agents/framework/AgentTranscript.test.mjs
import { describe, it, expect } from 'vitest';
import { AgentTranscript } from '../../../../backend/src/3_applications/agents/framework/AgentTranscript.mjs';

describe('AgentTranscript constructor', () => {
  it('captures identity + input + start time', () => {
    const t = new AgentTranscript({
      agentId: 'health-coach',
      userId: 'kc',
      turnId: 'fixed-turn-id',
      input: { text: 'hello', context: { foo: 'bar' } },
    });
    expect(t.agentId).toBe('health-coach');
    expect(t.userId).toBe('kc');
    expect(t.turnId).toBe('fixed-turn-id');
    expect(t.input.text).toBe('hello');
    expect(t.input.context.foo).toBe('bar');
    expect(t.startedAt).toBeInstanceOf(Date);
    expect(t.toolCalls).toEqual([]);
    expect(t.systemPrompt).toBe(null);
    expect(t.output).toBe(null);
    expect(t.error).toBe(null);
    expect(t.status).toBe(null);
  });

  it('defaults userId to null and turnId to a generated UUID when absent', () => {
    const t = new AgentTranscript({ agentId: 'x', input: { text: 'q', context: {} } });
    expect(t.userId).toBe(null);
    expect(t.turnId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('throws when agentId missing', () => {
    expect(() => new AgentTranscript({ input: { text: 'q', context: {} } })).toThrow(/agentId/);
  });

  it('throws when input missing', () => {
    expect(() => new AgentTranscript({ agentId: 'x' })).toThrow(/input/);
  });
});

describe('AgentTranscript mutators', () => {
  function makeT() {
    return new AgentTranscript({
      agentId: 'health-coach',
      userId: 'kc',
      turnId: 'tid',
      input: { text: 'q', context: {} },
    });
  }

  it('setSystemPrompt stores the string', () => {
    const t = makeT();
    t.setSystemPrompt('You are a coach.');
    expect(t.systemPrompt).toBe('You are a coach.');
  });

  it('setModel stores the model descriptor', () => {
    const t = makeT();
    t.setModel({ name: 'gpt-4o-mini', provider: 'openai' });
    expect(t.model).toEqual({ name: 'gpt-4o-mini', provider: 'openai' });
  });

  it('recordTool appends a deeply-cloned record with computed latency', () => {
    const t = makeT();
    const args = { metric: 'weight_lbs', period: { rolling: 'last_30d' } };
    const result = { value: 197, daysCovered: 28 };
    t.recordTool({ name: 'aggregate_metric', args, result, ok: true, latencyMs: 87 });
    expect(t.toolCalls).toHaveLength(1);
    const call = t.toolCalls[0];
    expect(call.ix).toBe(0);
    expect(call.name).toBe('aggregate_metric');
    expect(call.args).toEqual(args);
    expect(call.args).not.toBe(args);          // cloned
    expect(call.result).toEqual(result);
    expect(call.result).not.toBe(result);
    expect(call.ok).toBe(true);
    expect(call.latencyMs).toBe(87);
    expect(call.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(call.linkedAttachments).toEqual([]);  // wired in Task 3 — placeholder for now
  });

  it('recordTool increments ix on each call', () => {
    const t = makeT();
    t.recordTool({ name: 'a', args: {}, result: null, ok: true, latencyMs: 1 });
    t.recordTool({ name: 'b', args: {}, result: null, ok: false, latencyMs: 2 });
    expect(t.toolCalls.map(c => c.ix)).toEqual([0, 1]);
  });

  it('recordTool tolerates undefined result by storing null', () => {
    const t = makeT();
    t.recordTool({ name: 'x', args: {}, result: undefined, ok: true, latencyMs: 1 });
    expect(t.toolCalls[0].result).toBe(null);
  });

  it('setOutput stores text + finishReason + usage', () => {
    const t = makeT();
    t.setOutput({ text: 'done', finishReason: 'stop', usage: { totalTokens: 100 } });
    expect(t.output.text).toBe('done');
    expect(t.output.finishReason).toBe('stop');
    expect(t.output.usage).toEqual({ totalTokens: 100 });
  });

  it('setError captures message + stack + count', () => {
    const t = makeT();
    const err = new Error('boom');
    t.setError(err, { toolCallsBeforeError: 2 });
    expect(t.error.message).toBe('boom');
    expect(t.error.stack).toContain('Error');
    expect(t.error.toolCallsBeforeError).toBe(2);
  });

  it('setStatus + completion timing', () => {
    const t = makeT();
    t.setStatus('ok');
    expect(t.status).toBe('ok');
    expect(t.completedAt).toBeInstanceOf(Date);
    expect(t.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('setStatus is idempotent on completion timing', async () => {
    const t = makeT();
    t.setStatus('ok');
    const firstCompleted = t.completedAt;
    await new Promise(r => setTimeout(r, 5));
    t.setStatus('ok'); // should not change completedAt
    expect(t.completedAt).toBe(firstCompleted);
  });
});

describe('AgentTranscript.toJSON', () => {
  it('serializes to the spec schema with version=1', () => {
    const t = new AgentTranscript({
      agentId: 'health-coach',
      userId: 'kc',
      turnId: 'tid-1',
      input: { text: 'q', context: { attachments: [] } },
    });
    t.setSystemPrompt('SYS');
    t.setModel({ name: 'gpt-4o-mini', provider: 'openai' });
    t.recordTool({ name: 'ping', args: { x: 1 }, result: { y: 2 }, ok: true, latencyMs: 5 });
    t.setOutput({ text: 'ok', finishReason: 'stop', usage: null });
    t.setStatus('ok');

    const j = t.toJSON();
    expect(j.version).toBe(1);
    expect(j.turnId).toBe('tid-1');
    expect(j.agentId).toBe('health-coach');
    expect(j.userId).toBe('kc');
    expect(j.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(j.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(j.durationMs).toBeGreaterThanOrEqual(0);
    expect(j.status).toBe('ok');
    expect(j.input).toEqual({ text: 'q', context: { attachments: [] } });
    expect(j.systemPrompt).toBe('SYS');
    expect(j.model).toEqual({ name: 'gpt-4o-mini', provider: 'openai' });
    expect(j.toolCalls).toHaveLength(1);
    expect(j.toolCalls[0].name).toBe('ping');
    expect(j.output.text).toBe('ok');
    expect(j.error).toBe(null);
    expect(Array.isArray(j.tags)).toBe(true);
  });

  it('tags default to [agentId]', () => {
    const t = new AgentTranscript({ agentId: 'echo', input: { text: 'q', context: {} } });
    expect(t.toJSON().tags).toEqual(['echo']);
  });

  it('serializes error path correctly', () => {
    const t = new AgentTranscript({ agentId: 'x', input: { text: 'q', context: {} } });
    t.setError(new Error('nope'), { toolCallsBeforeError: 0 });
    t.setStatus('error');
    const j = t.toJSON();
    expect(j.status).toBe('error');
    expect(j.error.message).toBe('nope');
  });
});
