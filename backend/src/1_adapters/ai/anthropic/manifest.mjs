// backend/src/2_adapters/ai/anthropic/manifest.mjs

export default {
  provider: 'anthropic',
  capability: 'ai',
  displayName: 'Anthropic',

  adapter: () => import('../AnthropicAdapter.mjs'),

  configSchema: {
    api_key: { type: 'string', secret: true, required: true, description: 'Anthropic API key' },
    model: { type: 'string', default: 'claude-sonnet-4-20250514', description: 'Model to use for completions' },
    max_tokens: { type: 'number', default: 4000, description: 'Maximum tokens in response' },
  }
};
