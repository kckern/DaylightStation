// backend/src/1_adapters/ai/jev/manifest.mjs

export default {
  provider: 'jev',
  capability: 'decision',
  displayName: 'TypeSafe Jev',

  adapter: () => import('../JevAdapter.mjs'),

  configSchema: {
    api_key: { type: 'string', secret: true, required: true, description: 'TypeSafe API key (system/auth/jev.yml)' },
    model: { type: 'string', default: 'jev-latest', description: 'Model or alias; pin a versioned id (e.g. jev-1.13.0) once thresholds are tuned' },
    timeout: { type: 'number', default: 10000, description: 'Request timeout in ms' },
  }
};
