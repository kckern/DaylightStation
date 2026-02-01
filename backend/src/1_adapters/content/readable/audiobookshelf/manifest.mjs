// backend/src/1_adapters/content/readable/audiobookshelf/manifest.mjs

export default {
  provider: 'abs',
  capability: 'readable',
  displayName: 'Audiobookshelf',

  adapter: () => import('./AudiobookshelfAdapter.mjs'),

  configSchema: {
    host: { type: 'string', required: true, description: 'Audiobookshelf server URL' },
    token: { type: 'string', secret: true, required: true, description: 'API token' }
  }
};
