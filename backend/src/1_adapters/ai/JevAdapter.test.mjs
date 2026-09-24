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

describe('JevAdapter large choices', () => {
  const icons = Array.from({ length: 534 }, (_, i) => `icon-${String(i).padStart(3, '0')}`);

  // Round 1: every part leans to its first option, with two runners-up.
  // Round 2: answers over whatever finalists it was sent.
  function narrowingPost() {
    return vi.fn(async (url, body) => {
      const answers = {};
      for (const [id, q] of Object.entries(body.questions)) {
        const keys = Object.keys(q.criteria || {});
        if (id.includes('__part')) {
          answers[id] = { type: 'choice', choice: keys[0], confidence: 0.5,
            probabilities: { [keys[0]]: 0.6, [keys[1]]: 0.3, [keys[2]]: 0.1 } };
        } else if (q.type === 'choice') {
          answers[id] = { type: 'choice', choice: keys.at(-1), confidence: 0.9, probabilities: { [keys.at(-1)]: 0.95 } };
        } else {
          answers[id] = { type: 'noul', noul: 0.2 };
        }
      }
      return { status: 200, headers: {}, data: { model: 'jev-1.13.0', answers, usage: { input_tokens: 1000, output_tokens: 10 } } };
    });
  }

  it('splits a >255-option choice into balanced parts and runs a final round over the leaders', async () => {
    const post = narrowingPost();
    const adapter = new JevAdapter({ apiKey: 'k' }, makeDeps(post));
    const result = await adapter.evaluate({ food: 'plain yogurt' }, {
      icon: choice('Nearest icon?', icons),
      isDrink: yesNo('Is this a drink?'),
    });

    expect(post).toHaveBeenCalledTimes(2);
    const round1 = post.mock.calls[0][1].questions;
    const partIds = Object.keys(round1).filter(id => id.startsWith('icon__part'));
    expect(partIds).toHaveLength(3);
    const sizes = partIds.map(id => Object.keys(round1[id].criteria).length);
    expect(sizes.every(n => n <= 255)).toBe(true);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(534);
    expect(round1.isDrink.type).toBe('noul'); // other questions ride in round 1

    const round2 = post.mock.calls[1][1];
    expect(Object.keys(round2.questions)).toEqual(['icon']);
    expect(Object.keys(round2.questions.icon.criteria)).toHaveLength(9); // 3 parts × 3 leaders
    expect(round2.model).toBe('jev-1.13.0'); // pinned to the version that answered round 1

    expect(result.answers.icon).toMatchObject({ type: 'choice', confidence: 0.9 });
    expect(icons).toContain(result.answers.icon.choice);
    expect(result.answers.isDrink).toEqual({ type: 'yesNo', probability: 0.2 });
    expect(result.answers).not.toHaveProperty('icon__part0');
    expect(result.usage).toEqual({ inputTokens: 2000, outputTokens: 20 });
  });

  it('keeps a <=255-option choice to one call', async () => {
    const post = narrowingPost();
    const adapter = new JevAdapter({ apiKey: 'k' }, makeDeps(post));
    await adapter.evaluate('s', { icon: choice('Nearest icon?', icons.slice(0, 255)) });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('rejects a score rubric over the provider cap before calling', async () => {
    const post = vi.fn();
    const adapter = new JevAdapter({ apiKey: 'k' }, makeDeps(post));
    await expect(adapter.evaluate('s', { q: score('q', Array.from({ length: 11 }, (_, i) => `L${i}`)) }))
      .rejects.toThrow(/at most 10 score levels/);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('IDecisionGateway question builders', () => {
  it('enforces only logical minimums, not provider caps', () => {
    expect(() => choice('q', ['only'])).toThrow(/at least 2 options/);
    expect(() => score('q', ['one'])).toThrow(/at least 2 levels/);
    expect(() => yesNo('')).toThrow(/instructions/);
    expect(() => choice('q', Array.from({ length: 600 }, (_, i) => `o${i}`))).not.toThrow();
  });

  it('accepts bare option keys for choice', () => {
    expect(choice('q', ['a', 'b'])).toEqual({ type: 'choice', instructions: 'q', options: { a: null, b: null } });
  });
});
