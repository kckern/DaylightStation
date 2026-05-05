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
