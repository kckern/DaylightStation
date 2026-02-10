// backend/src/1_adapters/content/query/manifest.mjs
export default {
  provider: 'query',
  capability: 'query',
  displayName: 'Saved Queries (Smart Playlists)',
  mediaTypes: [],
  playableType: 'query',
  implicit: true,
  adapter: () => import('./QueryAdapter.mjs'),
  configSchema: {},
};
