// frontend/src/modules/Health/CoachChat/runtime.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { healthCoachChatModel } from './runtime.js';

describe('healthCoachChatModel.run', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('posts input + attachments to /api/v1/agents/health-coach/run', async () => {
    let captured;
    globalThis.fetch = vi.fn(async (url, opts) => {
      captured = { url, body: JSON.parse(opts.body) };
      return {
        ok: true,
        json: async () => ({ output: 'ok response', toolCalls: [] }),
      };
    });

    const messages = [{ role: 'user', content: [{ type: 'text', text: 'How are you?' }] }];
    const attachments = [{ type: 'period', value: { rolling: 'last_30d' }, label: 'Last 30 days' }];
    const result = await healthCoachChatModel.run({
      messages,
      userId: 'kc',
      attachments,
    });

    expect(captured.url).toMatch(/\/api\/v1\/agents\/health-coach\/run/);
    expect(captured.body.input).toBe('How are you?');
    expect(captured.body.context.userId).toBe('kc');
    expect(captured.body.context.attachments).toEqual(attachments);
    expect(result.content[0].text).toBe('ok response');
  });

  it('returns assistant message with toolCalls in metadata', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: 'with tools',
        toolCalls: [{ name: 'aggregate_metric', args: { metric: 'weight_lbs' }, result: { value: 197.5 } }],
      }),
    }));
    const result = await healthCoachChatModel.run({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      userId: 'kc',
    });
    expect(result.metadata?.toolCalls?.[0]?.name).toBe('aggregate_metric');
  });

  it('throws on non-2xx response', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, statusText: 'Server Error' }));
    await expect(healthCoachChatModel.run({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      userId: 'kc',
    })).rejects.toThrow(/500/);
  });
});

describe('healthCoachChatModel.runStream (async generator)', () => {
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

  it('yields incremental message updates as text-deltas arrive', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      body: readableStreamFrom([
        'data: {"type":"text-delta","text":"Hi "}\n\n',
        'data: {"type":"text-delta","text":"there"}\n\n',
        'data: {"type":"finish"}\n\ndata: {"type":"done"}\n\n',
      ]),
    }));

    const messages = [{ role: 'user', content: [{ type: 'text', text: 'q' }] }];
    const updates = [];
    for await (const u of healthCoachChatModel.runStream({ messages, userId: 'kc' })) {
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
      return {
        ok: true,
        body: readableStreamFrom(['data: {"type":"finish"}\n\ndata: {"type":"done"}\n\n']),
      };
    });

    const attachments = [{ type: 'period', value: { rolling: 'last_30d' }, label: 'Last 30 days' }];
    for await (const _ of healthCoachChatModel.runStream({
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

    await expect((async () => {
      for await (const _ of healthCoachChatModel.runStream({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
        userId: 'kc',
      })) { /* drain */ }
    })()).rejects.toThrow(/boom/);
  });

  it('records latencyMs from tool-end event on the matching in-flight call', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      body: readableStreamFrom([
        'data: {"type":"tool-start","toolName":"metric_trajectory","args":{"metric":"weight_lbs"}}\n\n',
        'data: {"type":"tool-end","toolName":"metric_trajectory","result":{"slope":-0.04},"latencyMs":42}\n\n',
        'data: {"type":"finish"}\n\ndata: {"type":"done"}\n\n',
      ]),
    }));

    const updates = [];
    for await (const u of healthCoachChatModel.runStream({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      userId: 'kc',
    })) {
      updates.push(u);
    }
    const finalToolCalls = updates.at(-1).metadata.toolCalls;
    expect(finalToolCalls).toHaveLength(1);
    expect(finalToolCalls[0].toolName).toBe('metric_trajectory');
    expect(finalToolCalls[0].status).toBe('done');
    expect(finalToolCalls[0].latencyMs).toBe(42);
  });
});
