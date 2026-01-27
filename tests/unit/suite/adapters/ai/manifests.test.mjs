// tests/unit/suite/adapters/ai/manifests.test.mjs
import openaiManifest from '#backend/src/2_adapters/ai/openai/manifest.mjs';
import anthropicManifest from '#backend/src/2_adapters/ai/anthropic/manifest.mjs';

describe('AI Provider Manifests', () => {
  describe('OpenAI', () => {
    test('has required fields', () => {
      expect(openaiManifest.provider).toBe('openai');
      expect(openaiManifest.capability).toBe('ai');
      expect(openaiManifest.displayName).toBe('OpenAI');
    });

    test('adapter factory returns OpenAIAdapter class', async () => {
      const { OpenAIAdapter: AdapterClass } = await openaiManifest.adapter();
      expect(AdapterClass.name).toBe('OpenAIAdapter');
    });

    test('has config schema with api_key as secret', () => {
      expect(openaiManifest.configSchema.api_key.secret).toBe(true);
      expect(openaiManifest.configSchema.api_key.required).toBe(true);
    });
  });

  describe('Anthropic', () => {
    test('has required fields', () => {
      expect(anthropicManifest.provider).toBe('anthropic');
      expect(anthropicManifest.capability).toBe('ai');
      expect(anthropicManifest.displayName).toBe('Anthropic');
    });

    test('adapter factory returns AnthropicAdapter class', async () => {
      const { AnthropicAdapter: AdapterClass } = await anthropicManifest.adapter();
      expect(AdapterClass.name).toBe('AnthropicAdapter');
    });

    test('has config schema with api_key as secret', () => {
      expect(anthropicManifest.configSchema.api_key.secret).toBe(true);
      expect(anthropicManifest.configSchema.api_key.required).toBe(true);
    });
  });
});
