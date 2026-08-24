import { describe, expect, it, vi } from 'vitest';
import { OpenAIAdapter } from './OpenAIAdapter.mjs';

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
    expect(adapter.callApi).toHaveBeenCalledWith('/chat/completions', {
      model: 'gpt-5.6-luna',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 40,
      reasoning_effort: 'none',
    }, expect.objectContaining({ timeout: 1800 }));
  });
});
