// backend/src/1_adapters/content/readable/komga/manifest.mjs

export default {
  provider: 'komga',
  capability: 'readable',
  displayName: 'Komga Comics & Manga',
  mediaTypes: ['paged'],
  playableType: 'readable',
  implicit: false,
  adapter: () => import('./KomgaAdapter.mjs'),
  configSchema: {
    host: { type: 'string', required: true, description: 'Komga server URL' },
    apiKey: { type: 'string', required: true, description: 'Komga API key' },
    proxyPath: { type: 'string', description: 'Proxy path for image URLs' },
  },
};
