// tests/unit/adapters/ai/AnthropicAdapter.test.mjs
import { jest } from '@jest/globals';
import { AnthropicAdapter } from '#backend/src/2_adapters/ai/AnthropicAdapter.mjs';

describe('AnthropicAdapter', () => {
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

    adapter = new AnthropicAdapter(
      { apiKey: 'test-api-key', model: 'claude-sonnet-4-20250514', maxTokens: 1000 },
      { httpClient: mockHttpClient, logger: mockLogger }
    );
  });

  describe('constructor', () => {
    test('throws if apiKey not provided', () => {
      expect(() => new AnthropicAdapter({})).toThrow('Anthropic API key is required');
    });

    test('initializes with defaults', () => {
      const a = new AnthropicAdapter({ apiKey: 'test' });
      expect(a.model).toBe('claude-sonnet-4-20250514');
      expect(a.maxTokens).toBe(1000);
      expect(a.isConfigured()).toBe(true);
    });

    test('accepts custom config', () => {
      const a = new AnthropicAdapter({
        apiKey: 'test',
        model: 'claude-3-haiku-20240307',
        maxTokens: 500
      });
      expect(a.model).toBe('claude-3-haiku-20240307');
      expect(a.maxTokens).toBe(500);
    });
  });

  describe('chat', () => {
    test('sends messages and returns response', async () => {
      mockHttpClient.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: 'Hello!' }],
          usage: { input_tokens: 5, output_tokens: 10 }
        })
      });

      const messages = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hi' }
      ];

      const response = await adapter.chat(messages);

      expect(response).toBe('Hello!');
      expect(mockHttpClient.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/messages'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-api-key': 'test-api-key',
            'anthropic-version': '2023-06-01'
          })
        })
      );
    });

    test('extracts system prompt from messages', async () => {
      mockHttpClient.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: 'Response' }],
          usage: { input_tokens: 10, output_tokens: 5 }
        })
      });

      const messages = [
        { role: 'system', content: 'Be concise' },
        { role: 'user', content: 'Hi' }
      ];

      await adapter.chat(messages);

      const callArgs = mockHttpClient.fetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.system).toBe('Be concise');
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe('user');
    });

    test('tracks token usage', async () => {
      mockHttpClient.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: 'Response' }],
          usage: { input_tokens: 20, output_tokens: 30 }
        })
      });

      await adapter.chat([{ role: 'user', content: 'Hi' }]);

      const metrics = adapter.getMetrics();
      expect(metrics.totals.inputTokens).toBe(20);
      expect(metrics.totals.outputTokens).toBe(30);
      expect(metrics.totals.totalTokens).toBe(50);
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
    test('sends URL image with messages', async () => {
      mockHttpClient.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: 'I see an image' }],
          usage: { input_tokens: 50, output_tokens: 20 }
        })
      });

      const messages = [{ role: 'user', content: 'What is this?' }];
      const response = await adapter.chatWithImage(messages, 'https://example.com/image.jpg');

      expect(response).toBe('I see an image');

      const callArgs = mockHttpClient.fetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.messages[0].content).toContainEqual(
        expect.objectContaining({
          type: 'image',
          source: expect.objectContaining({ type: 'url' })
        })
      );
    });

    test('sends base64 image with messages', async () => {
      mockHttpClient.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: 'I see a base64 image' }],
          usage: { input_tokens: 100, output_tokens: 20 }
        })
      });

      const messages = [{ role: 'user', content: 'What is this?' }];
      const response = await adapter.chatWithImage(
        messages,
        'data:image/jpeg;base64,/9j/4AAQSkZJRgABA...'
      );

      expect(response).toBe('I see a base64 image');

      const callArgs = mockHttpClient.fetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.messages[0].content).toContainEqual(
        expect.objectContaining({
          type: 'image',
          source: expect.objectContaining({ type: 'base64' })
        })
      );
    });
  });

  describe('chatWithJson', () => {
    test('parses JSON response', async () => {
      mockHttpClient.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: '{"name": "test", "value": 123}' }],
          usage: { input_tokens: 10, output_tokens: 15 }
        })
      });

      const messages = [{ role: 'user', content: 'Return JSON' }];
      const response = await adapter.chatWithJson(messages);

      expect(response).toEqual({ name: 'test', value: 123 });
    });

    test('handles markdown-wrapped JSON', async () => {
      mockHttpClient.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: '```json\n{"wrapped": true}\n```' }],
          usage: { input_tokens: 10, output_tokens: 15 }
        })
      });

      const messages = [{ role: 'user', content: 'Return JSON' }];
      const response = await adapter.chatWithJson(messages);

      expect(response).toEqual({ wrapped: true });
    });

    test('retries on parse failure', async () => {
      mockHttpClient.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: [{ text: 'Here is the data: {invalid}' }],
            usage: { input_tokens: 10, output_tokens: 10 }
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: [{ text: '{"valid": true}' }],
            usage: { input_tokens: 20, output_tokens: 10 }
          })
        });

      const messages = [{ role: 'user', content: 'Return JSON' }];
      const response = await adapter.chatWithJson(messages);

      expect(response).toEqual({ valid: true });
      expect(mockHttpClient.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('transcribe', () => {
    test('throws not supported error', async () => {
      await expect(adapter.transcribe(Buffer.from('audio')))
        .rejects.toThrow('does not support audio transcription');
    });
  });

  describe('embed', () => {
    test('throws not supported error', async () => {
      await expect(adapter.embed('text'))
        .rejects.toThrow('does not support embeddings');
    });
  });

  describe('getMetrics', () => {
    test('returns metrics data', async () => {
      mockHttpClient.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: 'Response' }],
          usage: { input_tokens: 10, output_tokens: 15 }
        })
      });

      await adapter.chat([{ role: 'user', content: 'Hi' }]);

      const metrics = adapter.getMetrics();

      expect(metrics.uptime.ms).toBeGreaterThanOrEqual(0);
      expect(metrics.totals.requests).toBe(1);
      expect(metrics.totals.inputTokens).toBe(10);
      expect(metrics.totals.outputTokens).toBe(15);
    });

    test('reset clears metrics', async () => {
      mockHttpClient.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: 'Response' }],
          usage: { input_tokens: 10, output_tokens: 15 }
        })
      });

      await adapter.chat([{ role: 'user', content: 'Hi' }]);
      adapter.resetMetrics();

      const metrics = adapter.getMetrics();
      expect(metrics.totals.requests).toBe(0);
      expect(metrics.totals.inputTokens).toBe(0);
    });
  });

  describe('isConfigured', () => {
    test('returns true when apiKey is set', () => {
      expect(adapter.isConfigured()).toBe(true);
    });
  });
});
