// backend/src/2_adapters/ai/openai/manifest.mjs

export default {
  provider: 'openai',
  capability: 'ai',
  displayName: 'OpenAI',

  adapter: () => import('../OpenAIAdapter.mjs'),

  configSchema: {
    api_key: { type: 'string', secret: true, required: true, description: 'OpenAI API key' },
    model: { type: 'string', default: 'gpt-4o', description: 'Model to use for completions' },
    max_tokens: { type: 'number', default: 4000, description: 'Maximum tokens in response' },
  }
};
