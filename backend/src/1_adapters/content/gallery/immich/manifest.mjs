// backend/src/1_adapters/content/gallery/immich/manifest.mjs

export default {
  provider: 'immich',
  capability: 'gallery',
  displayName: 'Immich Photo Library',
  mediaTypes: ['photo', 'video'],

  adapter: () => import('./ImmichAdapter.mjs'),

  configSchema: {
    host: { type: 'string', required: true, description: 'Immich server URL (e.g., http://localhost:2283)' },
    apiKey: { type: 'string', secret: true, required: true, description: 'Immich API key' },
    slideDuration: { type: 'number', default: 10, description: 'Default slide duration in seconds for photo slideshows' }
  }
};
