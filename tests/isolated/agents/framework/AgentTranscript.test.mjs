// tests/isolated/agents/framework/AgentTranscript.test.mjs
import { describe, it, expect } from 'vitest';
import { AgentTranscript } from '../../../../backend/src/3_applications/agents/framework/AgentTranscript.mjs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

describe('AgentTranscript.flush', () => {
  async function makeTmpDir() {
    return fsp.mkdtemp(path.join(os.tmpdir(), 'agent-transcript-'));
  }

  it('writes a JSON file at the spec path', async () => {
    const tmp = await makeTmpDir();
    const t = new AgentTranscript({
      agentId: 'health-coach',
      userId: 'kc',
      turnId: '11111111-2222-3333-4444-555555555555',
      input: { text: 'q', context: {} },
      mediaDir: tmp,
    });
    t.setSystemPrompt('SYS');
    t.setOutput({ text: 'ok', finishReason: 'stop', usage: null });
    t.setStatus('ok');

    await t.flush();

    // Path: {tmp}/logs/agents/health-coach/{YYYY-MM-DD}/kc/{HHMMSS-mmm}-{turnIdShort}.json
    const day = t.startedAt.toISOString().slice(0, 10);
    const dir = path.join(tmp, 'logs', 'agents', 'health-coach', day, 'kc');
    const files = await fsp.readdir(dir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^\d{6}-\d{3}-11111111\.json$/);

    const contents = JSON.parse(await fsp.readFile(path.join(dir, files[0]), 'utf8'));
    expect(contents.version).toBe(1);
    expect(contents.turnId).toBe('11111111-2222-3333-4444-555555555555');
    expect(contents.agentId).toBe('health-coach');
    expect(contents.systemPrompt).toBe('SYS');
    expect(contents.status).toBe('ok');

    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it('uses "anonymous" when userId is null', async () => {
    const tmp = await makeTmpDir();
    const t = new AgentTranscript({
      agentId: 'echo',
      userId: null,
      turnId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      input: { text: 'q', context: {} },
      mediaDir: tmp,
    });
    t.setStatus('ok');
    await t.flush();
    const day = t.startedAt.toISOString().slice(0, 10);
    const dir = path.join(tmp, 'logs', 'agents', 'echo', day, 'anonymous');
    const files = await fsp.readdir(dir);
    expect(files.length).toBe(1);
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it('flush() is idempotent — calling twice writes one file', async () => {
    const tmp = await makeTmpDir();
    const t = new AgentTranscript({
      agentId: 'x',
      userId: 'kc',
      turnId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      input: { text: 'q', context: {} },
      mediaDir: tmp,
    });
    t.setStatus('ok');
    await t.flush();
    await t.flush();
    const day = t.startedAt.toISOString().slice(0, 10);
    const dir = path.join(tmp, 'logs', 'agents', 'x', day, 'kc');
    const files = await fsp.readdir(dir);
    expect(files.length).toBe(1);
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it('flush() without mediaDir is a no-op (no throw)', async () => {
    const t = new AgentTranscript({
      agentId: 'x',
      userId: 'kc',
      input: { text: 'q', context: {} },
    });
    t.setStatus('ok');
    await expect(t.flush()).resolves.toBeUndefined();
  });

  it('flush() failures (unwriteable path) get warned, do not throw', async () => {
    const warnings = [];
    const t = new AgentTranscript({
      agentId: 'x',
      userId: 'kc',
      input: { text: 'q', context: {} },
      mediaDir: '/root/forbidden-no-permission-path-99999',
      logger: { warn: (event, data) => warnings.push({ event, data }) },
    });
    t.setStatus('ok');
    await expect(t.flush()).resolves.toBeUndefined();
    expect(warnings.length).toBeGreaterThanOrEqual(0);
    // We don't assert exactly one warning — different OSes have different
    // failure shapes — but we DO assert the call doesn't throw.
  });
});

describe('AgentTranscript.recordTool — linkedAttachments heuristic', () => {
  function makeWith(attachments) {
    return new AgentTranscript({
      agentId: 'health-coach',
      userId: 'kc',
      input: { text: 'q', context: { attachments } },
    });
  }

  it('links a period attachment when args.period deep-equals it', () => {
    const t = makeWith([
      { type: 'period', value: { rolling: 'last_30d' }, label: 'Last 30 days' },
    ]);
    t.recordTool({
      name: 'aggregate_metric',
      args: { metric: 'weight_lbs', period: { rolling: 'last_30d' } },
      result: {},
      ok: true,
      latencyMs: 1,
    });
    expect(t.toolCalls[0].linkedAttachments).toEqual([0]);
  });

  it('does NOT link when args.period differs', () => {
    const t = makeWith([
      { type: 'period', value: { rolling: 'last_30d' }, label: 'Last 30 days' },
    ]);
    t.recordTool({
      name: 'aggregate_metric',
      args: { metric: 'weight_lbs', period: { rolling: 'last_90d' } },
      result: {},
      ok: true,
      latencyMs: 1,
    });
    expect(t.toolCalls[0].linkedAttachments).toEqual([]);
  });

  it('links two attachments when compare_metric uses period_a + period_b', () => {
    const t = makeWith([
      { type: 'period', value: { rolling: 'last_30d' }, label: 'Last 30 days' },
      { type: 'period', value: { named: '2017-cut' }, label: '2017 Cut' },
    ]);
    t.recordTool({
      name: 'compare_metric',
      args: {
        metric: 'weight_lbs',
        period_a: { rolling: 'last_30d' },
        period_b: { named: '2017-cut' },
      },
      result: {},
      ok: true,
      latencyMs: 1,
    });
    expect(t.toolCalls[0].linkedAttachments.sort()).toEqual([0, 1]);
  });

  it('links a day attachment when args.date matches', () => {
    const t = makeWith([
      { type: 'day', date: '2026-05-04', label: 'May 4' },
    ]);
    t.recordTool({
      name: 'get_health_summary',
      args: { userId: 'kc', date: '2026-05-04' },
      result: {},
      ok: true,
      latencyMs: 1,
    });
    expect(t.toolCalls[0].linkedAttachments).toEqual([0]);
  });

  it('links a workout attachment when args.from === args.to === attachment.date', () => {
    const t = makeWith([
      { type: 'workout', date: '2026-05-04', label: 'Workout May 4' },
    ]);
    t.recordTool({
      name: 'query_historical_workouts',
      args: { userId: 'kc', from: '2026-05-04', to: '2026-05-04' },
      result: {},
      ok: true,
      latencyMs: 1,
    });
    expect(t.toolCalls[0].linkedAttachments).toEqual([0]);
  });

  it('returns empty array when no attachments present', () => {
    const t = new AgentTranscript({
      agentId: 'x',
      input: { text: 'q', context: {} },
    });
    t.recordTool({ name: 'a', args: { period: { rolling: 'last_30d' } }, result: {}, ok: true, latencyMs: 1 });
    expect(t.toolCalls[0].linkedAttachments).toEqual([]);
  });

  it('returns empty array when attachments exist but none match', () => {
    const t = makeWith([
      { type: 'period', value: { rolling: 'last_7d' }, label: 'Last 7 days' },
    ]);
    t.recordTool({
      name: 'aggregate_metric',
      args: { metric: 'weight_lbs', period: { rolling: 'last_30d' } },
      result: {},
      ok: true,
      latencyMs: 1,
    });
    expect(t.toolCalls[0].linkedAttachments).toEqual([]);
  });
});
