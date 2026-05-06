import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAgentRuntime } from './runtime.js';

describe('createAgentRuntime', () => {
  it('returns an object with run and runStream methods', () => {
    const runtime = createAgentRuntime('health-coach');
    expect(typeof runtime.run).toBe('function');
    expect(typeof runtime.runStream).toBe('function');
  });

  it('returns distinct runtimes for distinct agentIds', () => {
    const a = createAgentRuntime('health-coach');
    const b = createAgentRuntime('lifeplan-guide');
    expect(a).not.toBe(b);
  });
});

describe('createAgentRuntime("health-coach").run', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('posts input + attachments to /api/v1/agents/health-coach/run', async () => {
    let captured;
    globalThis.fetch = vi.fn(async (url, opts) => {
      captured = { url, body: JSON.parse(opts.body) };
      return { ok: true, json: async () => ({ output: 'ok response', toolCalls: [] }) };
    });

    const runtime = createAgentRuntime('health-coach');
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'How are you?' }] }];
    const attachments = [{ type: 'period', value: { rolling: 'last_30d' }, label: 'Last 30 days' }];
    const result = await runtime.run({ messages, userId: 'kc', attachments });

    expect(captured.url).toBe('/api/v1/agents/health-coach/run');
    expect(captured.body.input).toBe('How are you?');
    expect(captured.body.context.userId).toBe('kc');
    expect(captured.body.context.attachments).toEqual(attachments);
    expect(result.content[0].text).toBe('ok response');
  });

  it('builds the URL from agentId param', async () => {
    let capturedUrl;
    globalThis.fetch = vi.fn(async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ output: '', toolCalls: [] }) };
    });
    const runtime = createAgentRuntime('lifeplan-guide');
    await runtime.run({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      userId: 'default',
    });
    expect(capturedUrl).toBe('/api/v1/agents/lifeplan-guide/run');
  });

  it('returns assistant message with toolCalls in metadata', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: 'with tools',
        toolCalls: [{ name: 'aggregate_metric', args: { metric: 'weight_lbs' }, result: { value: 197.5 } }],
      }),
    }));
    const runtime = createAgentRuntime('health-coach');
    const result = await runtime.run({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      userId: 'kc',
    });
    expect(result.metadata?.toolCalls?.[0]?.name).toBe('aggregate_metric');
  });

  it('throws on non-2xx response', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, statusText: 'Server Error' }));
    const runtime = createAgentRuntime('health-coach');
    await expect(runtime.run({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      userId: 'kc',
    })).rejects.toThrow(/500/);
  });
});

describe('createAgentRuntime(...).runStream (async generator)', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  function readableStreamFrom(strings) {
    return new ReadableStream({
      async start(controller) {
        for (const s of strings) controller.enqueue(new TextEncoder().encode(s));
        controller.close();
      },
    });
  }

  it('hits /api/v1/agents/{agentId}/run-stream', async () => {
    let capturedUrl;
    globalThis.fetch = vi.fn(async (url) => {
      capturedUrl = url;
      return { ok: true, body: readableStreamFrom(['data: {"type":"finish"}\n\ndata: {"type":"done"}\n\n']) };
    });
    const runtime = createAgentRuntime('lifeplan-guide');
    for await (const _ of runtime.runStream({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      userId: 'default',
    })) { /* drain */ }
    expect(capturedUrl).toBe('/api/v1/agents/lifeplan-guide/run-stream');
  });

  it('yields incremental message updates as text-deltas arrive', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      body: readableStreamFrom([
        'data: {"type":"text-delta","text":"Hi "}\n\n',
        'data: {"type":"text-delta","text":"there"}\n\n',
        'data: {"type":"finish"}\n\ndata: {"type":"done"}\n\n',
      ]),
    }));

    const runtime = createAgentRuntime('health-coach');
    const updates = [];
    for await (const u of runtime.runStream({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      userId: 'kc',
    })) {
      updates.push(u);
    }
    expect(updates.length).toBeGreaterThanOrEqual(2);
    const lastText = updates.at(-1).content.find(p => p.type === 'text').text;
    expect(lastText).toBe('Hi there');
  });

  it('threads attachments through to the request body', async () => {
    let captured;
    globalThis.fetch = vi.fn(async (url, opts) => {
      captured = JSON.parse(opts.body);
      return { ok: true, body: readableStreamFrom(['data: {"type":"finish"}\n\ndata: {"type":"done"}\n\n']) };
    });

    const attachments = [{ type: 'period', value: { rolling: 'last_30d' }, label: 'Last 30 days' }];
    const runtime = createAgentRuntime('health-coach');
    for await (const _ of runtime.runStream({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      userId: 'kc',
      attachments,
    })) { /* drain */ }
    expect(captured.context.attachments).toEqual(attachments);
  });

  it('throws when SSE error event arrives', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      body: readableStreamFrom(['data: {"type":"error","message":"boom"}\n\n']),
    }));

    const runtime = createAgentRuntime('health-coach');
    await expect((async () => {
      for await (const _ of runtime.runStream({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
        userId: 'kc',
      })) { /* drain */ }
    })()).rejects.toThrow(/boom/);
  });
});
