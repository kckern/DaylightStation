import { describe, it, expect, vi } from 'vitest';
import { AnthropicAdapter } from './AnthropicAdapter.mjs';

// Same guarantee as the OpenAI adapter: unparseable model output can echo a
// user's words, so logs and thrown errors carry its size, never its text.
describe('AnthropicAdapter JSON parse failure logs', () => {
  const setup = output => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const adapter = new AnthropicAdapter({ apiKey: 'test-key' }, { httpClient: { post: vi.fn() }, logger });
    adapter.chat = vi.fn(async () => output);
    const logged = () => JSON.stringify([logger.debug, logger.info, logger.warn, logger.error].flatMap(fn => fn.mock.calls));
    return { adapter, logger, logged };
  };

  it('logs the size of unparseable model output, never the output itself', async () => {
    const output = '{"subject": "my mom made pancakes" "extra": ]}';
    const { adapter, logger, logged } = setup(output);
    await expect(adapter.chatStructured([{ role: 'user', content: 'x' }])).rejects.toThrow();
    const warning = logger.warn.mock.calls.find(([event]) => event === 'anthropic.json.parseError')[1];
    expect(warning).not.toHaveProperty('sample');
    expect(warning.sampleLength).toBe(output.length);
    expect(logged()).not.toContain('pancakes');
  });

  it('drops the input excerpt that JSON.parse quotes, in logs and in the thrown error', async () => {
    const { adapter, logged } = setup('{"a": my mom}');
    const thrown = await adapter.chatStructured([{ role: 'user', content: 'x' }]).catch(error => error);
    expect(logged()).not.toContain('my mom');
    expect(thrown.code).toBe('INVALID_JSON_RESPONSE');
    expect(JSON.stringify(thrown)).not.toContain('my mom');
  });
});
