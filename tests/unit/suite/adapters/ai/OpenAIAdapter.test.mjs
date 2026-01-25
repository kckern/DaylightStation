// tests/unit/adapters/ai/OpenAIAdapter.test.mjs
import { jest } from '@jest/globals';
import { OpenAIAdapter } from '#backend/src/2_adapters/ai/OpenAIAdapter.mjs';

describe('OpenAIAdapter', () => {
  let adapter;
  let mockHttpClient;
  let mockLogger;

  beforeEach(() => {
    mockHttpClient = {
      fetch: jest.fn()
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    adapter = new OpenAIAdapter(
      { apiKey: 'test-api-key', model: 'gpt-4o', maxTokens: 1000 },
      { httpClient: mockHttpClient, logger: mockLogger }
    );
  });

  describe('constructor', () => {
    test('throws if apiKey not provided', () => {
      expect(() => new OpenAIAdapter({})).toThrow('OpenAI API key is required');
    });

    test('initializes with defaults', () => {
      const a = new OpenAIAdapter({ apiKey: 'test' });
      expect(a.model).toBe('gpt-4o');
      expect(a.maxTokens).toBe(1000);
      expect(a.isConfigured()).toBe(true);
    });

    test('accepts custom config', () => {
      const a = new OpenAIAdapter({
        apiKey: 'test',
        model: 'gpt-3.5-turbo',
        maxTokens: 500
      });
      expect(a.model).toBe('gpt-3.5-turbo');
      expect(a.maxTokens).toBe(500);
    });
  });

  describe('chat', () => {
    test('sends messages and returns response', async () => {
      mockHttpClient.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello!' } }],
          usage: { total_tokens: 10 }
        })
      });

      const messages = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hi' }
      ];

      const response = await adapter.chat(messages);

      expect(response).toBe('Hello!');
      expect(mockHttpClient.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/chat/completions'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
    });

    test('tracks token usage', async () => {
      mockHttpClient.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
          usage: { total_tokens: 50 }
        })
      });

      await adapter.chat([{ role: 'user', content: 'Hi' }]);

      const metrics = adapter.getMetrics();
      expect(metrics.totals.tokens).toBe(50);
    });

    test('handles rate limit error', async () => {
      mockHttpClient.fetch.mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: () => '60' },
        json: async () => ({})
      });

      await expect(adapter.chat([{ role: 'user', content: 'Hi' }]))
        .rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('chatWithImage', () => {
    test('sends image with messages', async () => {
      mockHttpClient.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'I see an image' } }],
          usage: { total_tokens: 20 }
        })
      });

      const messages = [{ role: 'user', content: 'What is this?' }];
      const response = await adapter.chatWithImage(messages, 'https://example.com/image.jpg');

      expect(response).toBe('I see an image');

      const callArgs = mockHttpClient.fetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.messages[0].content).toContainEqual(
        expect.objectContaining({ type: 'image_url' })
      );
    });
  });

  describe('chatWithJson', () => {
    test('parses JSON response', async () => {
      mockHttpClient.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"name": "test", "value": 123}' } }],
          usage: { total_tokens: 15 }
        })
      });

      const messages = [{ role: 'user', content: 'Return JSON' }];
      const response = await adapter.chatWithJson(messages);

      expect(response).toEqual({ name: 'test', value: 123 });
    });

    test('retries on parse failure', async () => {
      mockHttpClient.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Invalid JSON here' } }],
            usage: { total_tokens: 10 }
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"valid": true}' } }],
            usage: { total_tokens: 10 }
          })
        });

      const messages = [{ role: 'user', content: 'Return JSON' }];
      const response = await adapter.chatWithJson(messages);

      expect(response).toEqual({ valid: true });
      expect(mockHttpClient.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('embed', () => {
    test('returns embedding vector', async () => {
      const mockEmbedding = Array(1536).fill(0.1);
      mockHttpClient.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: mockEmbedding }]
        })
      });

      const embedding = await adapter.embed('test text');

      expect(embedding).toHaveLength(1536);
      expect(mockHttpClient.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/embeddings'),
        expect.any(Object)
      );
    });
  });

  describe('getMetrics', () => {
    test('returns metrics data', async () => {
      mockHttpClient.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
          usage: { total_tokens: 25 }
        })
      });

      await adapter.chat([{ role: 'user', content: 'Hi' }]);

      const metrics = adapter.getMetrics();

      expect(metrics.uptime.ms).toBeGreaterThanOrEqual(0);
      expect(metrics.totals.requests).toBe(1);
      expect(metrics.totals.tokens).toBe(25);
    });

    test('reset clears metrics', async () => {
      mockHttpClient.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
          usage: { total_tokens: 25 }
        })
      });

      await adapter.chat([{ role: 'user', content: 'Hi' }]);
      adapter.resetMetrics();

      const metrics = adapter.getMetrics();
      expect(metrics.totals.requests).toBe(0);
      expect(metrics.totals.tokens).toBe(0);
    });
  });

  describe('isConfigured', () => {
    test('returns true when apiKey is set', () => {
      expect(adapter.isConfigured()).toBe(true);
    });
  });

  describe('retry helpers', () => {
    test('sleep delays for specified milliseconds', async () => {
      const testAdapter = new OpenAIAdapter({ apiKey: 'test-key' });
      const start = Date.now();
      await testAdapter._testSleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45);
      expect(elapsed).toBeLessThan(100);
    });

    describe('isRetryable', () => {
      test('returns true for fetch failed errors', () => {
        const error = new Error('fetch failed');
        expect(adapter._testIsRetryable(error)).toBe(true);
      });

      test('returns true for ECONNRESET', () => {
        const error = new Error('connection reset');
        error.cause = { code: 'ECONNRESET' };
        expect(adapter._testIsRetryable(error)).toBe(true);
      });

      test('returns true for ETIMEDOUT', () => {
        const error = new Error('timed out');
        error.cause = { code: 'ETIMEDOUT' };
        expect(adapter._testIsRetryable(error)).toBe(true);
      });

      test('returns true for RATE_LIMIT errors', () => {
        const error = new Error('rate limited');
        error.code = 'RATE_LIMIT';
        expect(adapter._testIsRetryable(error)).toBe(true);
      });

      test('returns true for 5xx server errors', () => {
        const error = new Error('server error');
        error.status = 503;
        expect(adapter._testIsRetryable(error)).toBe(true);
      });

      test('returns false for 4xx client errors', () => {
        const error = new Error('bad request');
        error.status = 400;
        expect(adapter._testIsRetryable(error)).toBe(false);
      });

      test('returns false for generic errors', () => {
        const error = new Error('something went wrong');
        expect(adapter._testIsRetryable(error)).toBe(false);
      });
    });
  });
});
