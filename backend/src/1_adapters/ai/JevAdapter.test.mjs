import { describe, expect, it, vi } from 'vitest';
import { JevAdapter } from './JevAdapter.mjs';
import { yesNo, choice, score, isDecisionGateway } from '#apps/common/ports/IDecisionGateway.mjs';

function makeDeps(post) {
  return {
    httpClient: { post },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    aiUsageLedger: { record: vi.fn() },
  };
}

const OK_RESPONSE = {
  status: 200,
  headers: {},
  data: {
    model: 'jev-1.13.0',
    answers: {
      is_urgent: { type: 'noul', noul: 0.95 },
      department: {
        type: 'choice', choice: 'billing', confidence: 0.8,
        probabilities: { billing: 0.87, sales: 0, technical: 0.13 },
      },
      frustration: {
        type: 'score', score: 1.04, confidence: 0.94,
        legend: { 0: 'Calm', 1: 'Frustrated', 2: 'Very angry' },
        probabilities: { 0: 0, 1: 0.96, 2: 0.04 },
      },
    },
    usage: { input_tokens: 426, output_tokens: 73 },
  },
};

const QUESTIONS = {
  is_urgent: yesNo('Does this convey urgency?', { yes: 'Explicitly time-sensitive', no: 'No urgency expressed' }),
  department: choice('Which team should handle this?', {
    billing: 'Payments, invoicing, refunds',
    technical: 'Bugs, outages, integrations',
    sales: 'Pricing, upgrades, new accounts',
  }),
  frustration: score('How frustrated is the customer?', ['Calm', 'Frustrated', 'Very angry']),
};

describe('JevAdapter', () => {
  it('implements IDecisionGateway', () => {
    const adapter = new JevAdapter({ apiKey: 'k' }, makeDeps(vi.fn()));
    expect(isDecisionGateway(adapter)).toBe(true);
    expect(adapter.isConfigured()).toBe(true);
  });

  it('requires an api key and an http client', () => {
    expect(() => new JevAdapter({}, makeDeps(vi.fn()))).toThrow(/API key/);
    expect(() => new JevAdapter({ apiKey: 'k' }, {})).toThrow(/httpClient/);
  });

  it('translates port questions to the TypeSafe wire format', async () => {
    const post = vi.fn(async () => OK_RESPONSE);
    const adapter = new JevAdapter({ apiKey: 'secret' }, makeDeps(post));
    await adapter.evaluate('Help! My payouts have been failing for 3 days.', QUESTIONS);

    const [url, body, opts] = post.mock.calls[0];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(opts.headers.Authorization).toBe('Bearer secret');
    expect(opts.timeout).toBe(10000);
    expect(body).toEqual({
      model: 'jev-latest',
      state: 'Help! My payouts have been failing for 3 days.',
      questions: {
        is_urgent: {
          type: 'noul',
          instructions: 'Does this convey urgency?',
          criteria: { true: 'Explicitly time-sensitive', false: 'No urgency expressed' },
        },
        department: {
          type: 'choice',
          instructions: 'Which team should handle this?',
          criteria: {
            billing: 'Payments, invoicing, refunds',
            technical: 'Bugs, outages, integrations',
            sales: 'Pricing, upgrades, new accounts',
          },
        },
        frustration: {
          type: 'score',
          instructions: 'How frustrated is the customer?',
          criteria: ['Calm', 'Frustrated', 'Very angry'],
        },
      },
    });
  });

  it('omits noul criteria when none are given', async () => {
    const post = vi.fn(async () => ({ status: 200, headers: {}, data: {
      model: 'jev-1.13.0', answers: { q: { type: 'noul', noul: 0.1 } }, usage: {},
    } }));
    const adapter = new JevAdapter({ apiKey: 'k' }, makeDeps(post));
    await adapter.evaluate('x', { q: yesNo('Is it raining?') });
    expect(post.mock.calls[0][1].questions.q).toEqual({ type: 'noul', instructions: 'Is it raining?' });
  });

  it('normalizes answers back to the port shape', async () => {
    const adapter = new JevAdapter({ apiKey: 'k' }, makeDeps(vi.fn(async () => OK_RESPONSE)));
    const result = await adapter.evaluate('state', QUESTIONS);
    expect(result).toEqual({
      model: 'jev-1.13.0',
      answers: {
        is_urgent: { type: 'yesNo', probability: 0.95 },
        department: {
          type: 'choice', choice: 'billing', confidence: 0.8,
          probabilities: { billing: 0.87, sales: 0, technical: 0.13 },
        },
        frustration: { type: 'score', score: 1.04, confidence: 0.94, probabilities: [0, 0.96, 0.04] },
      },
      usage: { inputTokens: 426, outputTokens: 73 },
    });
  });

  it('honors per-call model and timeout', async () => {
    const post = vi.fn(async () => OK_RESPONSE);
    const adapter = new JevAdapter({ apiKey: 'k', model: 'jev-1.13.0' }, makeDeps(post));
    await adapter.evaluate('s', QUESTIONS, { model: 'jev-preview', timeout: 500 });
    expect(post.mock.calls[0][1].model).toBe('jev-preview');
    expect(post.mock.calls[0][2].timeout).toBe(500);
  });

  it('records usage with input-only pricing', async () => {
    const deps = makeDeps(vi.fn(async () => OK_RESPONSE));
    const adapter = new JevAdapter({ apiKey: 'k' }, deps);
    await adapter.evaluate('s', QUESTIONS);
    const entry = deps.aiUsageLedger.record.mock.calls[0][0];
    expect(entry).toMatchObject({
      provider: 'jev', endpoint: '/systemone', model: 'jev-1.13.0', requestedModel: 'jev-latest',
      promptTokens: 426, completionTokens: 73, status: 'ok',
    });
    // 426 input tokens at $0.042 / 1M; output is free
    expect(entry.costUsd).toBeCloseTo(426 * 0.042 / 1_000_000, 12);
    expect(deps.logger.info).toHaveBeenCalledWith('jev.usage', entry);
  });

  it('surfaces rate limits with retryAfter', async () => {
    const deps = makeDeps(vi.fn(async () => ({ status: 429, headers: { 'retry-after': '7' }, data: {} })));
    const adapter = new JevAdapter({ apiKey: 'k' }, deps);
    await expect(adapter.evaluate('s', QUESTIONS)).rejects.toMatchObject({ code: 'RATE_LIMIT', retryAfter: 7 });
    expect(deps.aiUsageLedger.record.mock.calls[0][0]).toMatchObject({ status: 'error', httpStatus: 429, costUsd: 0 });
  });

  it('keeps the API error body on non-2xx responses', async () => {
    const deps = makeDeps(vi.fn(async () => ({
      status: 400, headers: {}, data: { error: { message: 'criteria must have at least two levels' } },
    })));
    const adapter = new JevAdapter({ apiKey: 'k' }, deps);
    await expect(adapter.evaluate('s', QUESTIONS)).rejects.toMatchObject({
      status: 400, message: 'criteria must have at least two levels',
    });
    expect(deps.logger.error).toHaveBeenCalledWith('jev.error', expect.objectContaining({ status: 400 }));
  });

  it('fails when an answer is missing rather than returning a partial result', async () => {
    const adapter = new JevAdapter({ apiKey: 'k' }, makeDeps(vi.fn(async () => ({
      status: 200, headers: {}, data: { model: 'jev-1.13.0', answers: { is_urgent: { type: 'noul', noul: 1 } }, usage: {} },
    }))));
    await expect(adapter.evaluate('s', QUESTIONS)).rejects.toThrow(/missing answer for "department"/);
  });

  it('rejects empty state or no questions before calling the API', async () => {
    const post = vi.fn();
    const adapter = new JevAdapter({ apiKey: 'k' }, makeDeps(post));
    await expect(adapter.evaluate('', QUESTIONS)).rejects.toThrow(/state/);
    await expect(adapter.evaluate('s', {})).rejects.toThrow(/question/);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('IDecisionGateway question builders', () => {
  it('validates option and level counts', () => {
    expect(() => choice('q', ['only'])).toThrow(/2–255 options/);
    expect(() => score('q', ['one'])).toThrow(/2–10 levels/);
    expect(() => score('q', Array.from({ length: 11 }, (_, i) => `L${i}`))).toThrow(/2–10 levels/);
    expect(() => yesNo('')).toThrow(/instructions/);
  });

  it('accepts bare option keys for choice', () => {
    expect(choice('q', ['a', 'b'])).toEqual({ type: 'choice', instructions: 'q', options: { a: null, b: null } });
  });
});
