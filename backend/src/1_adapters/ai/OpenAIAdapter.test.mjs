import { describe, expect, it, vi } from 'vitest';
import { OpenAIAdapter } from './OpenAIAdapter.mjs';

function makeDeps({ post }) {
  return {
    httpClient: { post },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    aiUsageLedger: { record: vi.fn() },
  };
}

describe('OpenAIAdapter chat options', () => {
  it('maps the port reasoning effort to the Chat Completions request', async () => {
    const adapter = new OpenAIAdapter(
      { apiKey: 'test-key' },
      { httpClient: { post: vi.fn() }, logger: { debug() {}, info() {}, warn() {}, error() {} } },
    );
    adapter.callApi = vi.fn(async () => ({ choices: [{ message: { content: 'Ready.' } }] }));
    await expect(adapter.chat([{ role: 'user', content: 'Hello' }], {
      model: 'gpt-5.6-luna', reasoningEffort: 'none', maxTokens: 40, timeout: 1800,
    })).resolves.toBe('Ready.');
    // gpt-5 onward rejects max_tokens; the adapter must send max_completion_tokens
    expect(adapter.callApi).toHaveBeenCalledWith('/chat/completions', {
      model: 'gpt-5.6-luna',
      messages: [{ role: 'user', content: 'Hello' }],
      max_completion_tokens: 40,
      reasoning_effort: 'none',
    }, expect.objectContaining({ timeout: 1800 }));
  });

  it('keeps max_tokens for the older model families', async () => {
    const adapter = new OpenAIAdapter(
      { apiKey: 'test-key' },
      { httpClient: { post: vi.fn() }, logger: { debug() {}, info() {}, warn() {}, error() {} } },
    );
    adapter.callApi = vi.fn(async () => ({ choices: [{ message: { content: 'Ready.' } }] }));
    await adapter.chat([{ role: 'user', content: 'Hello' }], { model: 'gpt-4.1', maxTokens: 40 });
    expect(adapter.callApi).toHaveBeenCalledWith('/chat/completions',
      expect.objectContaining({ max_tokens: 40 }), expect.anything());
  });

  it('learns the parameter rename from a 400 and retries once', async () => {
    const deps = makeDeps({ post: vi.fn() });
    const adapter = new OpenAIAdapter({ apiKey: 'test-key' }, deps);
    // an unknown-to-the-prefix-list model that rejects max_tokens
    const rejection = Object.assign(new Error("Unsupported parameter: 'max_tokens'"), {
      status: 400,
      apiError: { code: 'unsupported_parameter', param: 'max_tokens' },
    });
    adapter.callApi = vi.fn()
      .mockRejectedValueOnce(rejection)
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Ready.' } }] });

    await expect(adapter.chat([{ role: 'user', content: 'Hi' }], { model: 'future-model-9', maxTokens: 40 }))
      .resolves.toBe('Ready.');

    expect(adapter.callApi).toHaveBeenNthCalledWith(1, '/chat/completions',
      expect.objectContaining({ max_tokens: 40 }), expect.anything());
    expect(adapter.callApi).toHaveBeenNthCalledWith(2, '/chat/completions',
      expect.objectContaining({ max_completion_tokens: 40 }), expect.anything());
    expect(deps.logger.warn).toHaveBeenCalledWith('openai.maxTokensParam.switched', expect.anything());

    // the lesson sticks: the next call sends the right parameter first time
    expect(OpenAIAdapter.maxTokensParamFor('future-model-9')).toBe('max_completion_tokens');
  });

  it('does not retry a 400 that is about something else', async () => {
    const deps = makeDeps({ post: vi.fn() });
    const adapter = new OpenAIAdapter({ apiKey: 'test-key' }, deps);
    adapter.callApi = vi.fn().mockRejectedValue(Object.assign(new Error('Invalid model'), {
      status: 400, apiError: { code: 'model_not_found', param: null },
    }));
    await expect(adapter.chat([{ role: 'user', content: 'Hi' }], { model: 'gpt-4.1' }))
      .rejects.toThrow('Invalid model');
    expect(adapter.callApi).toHaveBeenCalledTimes(1);
  });
});

describe('OpenAIAdapter usage observability', () => {
  it('logs an openai.usage event and writes a ledger row for every successful call', async () => {
    const post = vi.fn(async () => ({
      status: 200,
      headers: {},
      data: {
        model: 'gpt-4.1-2025-04-14',
        choices: [{ message: { content: 'Hi.' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
      },
    }));
    const deps = makeDeps({ post });
    const adapter = new OpenAIAdapter({ apiKey: 'test-key' }, deps);

    await adapter.chat([{ role: 'user', content: 'Hello' }], { model: 'gpt-4.1' });

    const expected = {
      provider: 'openai',
      endpoint: '/chat/completions',
      model: 'gpt-4.1-2025-04-14',
      requestedModel: 'gpt-4.1',
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      costUsd: 0.006, // (1000×$2 + 500×$8) / 1M — via prefix match on gpt-4.1
      status: 'ok',
    };
    expect(deps.logger.info).toHaveBeenCalledWith('openai.usage', expect.objectContaining(expected));
    expect(deps.aiUsageLedger.record).toHaveBeenCalledWith(expect.objectContaining(expected));
  });

  it('surfaces the API error body on a 400 instead of a generic axios message', async () => {
    const post = vi.fn(async () => ({
      status: 400,
      headers: {},
      data: { error: { message: "Unsupported parameter: 'max_tokens'.", type: 'invalid_request_error', param: 'max_tokens' } },
    }));
    const deps = makeDeps({ post });
    const adapter = new OpenAIAdapter({ apiKey: 'test-key' }, deps);

    await expect(adapter.chat([{ role: 'user', content: 'Hello' }], { model: 'gpt-4.1' }))
      .rejects.toThrow("Unsupported parameter: 'max_tokens'.");

    // non-2xx must flow back as a response (validateStatus), never an axios throw
    expect(post.mock.calls[0][2]).toMatchObject({ validateStatus: expect.any(Function) });
    expect(deps.logger.error).toHaveBeenCalledWith('openai.error', expect.objectContaining({
      status: 400,
      apiError: expect.objectContaining({ param: 'max_tokens' }),
    }));
    expect(deps.aiUsageLedger.record).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error',
      httpStatus: 400,
      costUsd: 0,
    }));
  });

  it('never lets a ledger failure break the API call', async () => {
    const post = vi.fn(async () => ({
      status: 200,
      headers: {},
      data: { model: 'gpt-4.1', choices: [{ message: { content: 'Hi.' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
    }));
    const deps = makeDeps({ post });
    deps.aiUsageLedger.record = vi.fn(() => { throw new Error('disk full'); });
    const adapter = new OpenAIAdapter({ apiKey: 'test-key' }, deps);

    await expect(adapter.chat([{ role: 'user', content: 'Hello' }])).resolves.toBe('Hi.');
    expect(deps.logger.warn).toHaveBeenCalledWith('openai.usage.record-failed', expect.anything());
  });

  it('reports null cost for an unpriced model while still recording tokens', async () => {
    const post = vi.fn(async () => ({
      status: 200,
      headers: {},
      data: { model: 'gpt-5.6-luna', choices: [{ message: { content: 'Hi.' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    }));
    const deps = makeDeps({ post });
    const adapter = new OpenAIAdapter({ apiKey: 'test-key' }, deps);

    await adapter.chat([{ role: 'user', content: 'Hello' }], { model: 'gpt-5.6-luna' });
    expect(deps.aiUsageLedger.record).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.6-luna', promptTokens: 10, completionTokens: 5, costUsd: null,
    }));
  });

  it('prices an unpriced model from a config pricing override', async () => {
    const post = vi.fn(async () => ({
      status: 200,
      headers: {},
      data: { model: 'gpt-5.6-luna', choices: [{ message: { content: 'Hi.' } }], usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 } },
    }));
    const deps = makeDeps({ post });
    const adapter = new OpenAIAdapter(
      { apiKey: 'test-key', pricing: { 'gpt-5.6-luna': { input: 1, output: 3 } } },
      deps,
    );

    await adapter.chat([{ role: 'user', content: 'Hello' }], { model: 'gpt-5.6-luna' });
    expect(deps.aiUsageLedger.record).toHaveBeenCalledWith(expect.objectContaining({ costUsd: 0.004 }));
  });
});
