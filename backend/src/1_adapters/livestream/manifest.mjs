// backend/src/1_adapters/livestream/manifest.mjs
export default {
  provider: 'livestream',
  capability: 'livestream',
  displayName: 'LiveStream Engine',
  adapter: () => import('./FFmpegStreamAdapter.mjs'),
  configSchema: {
    channels: { type: 'object', description: 'Channel definitions (name → config)' },
    programs: { type: 'object', description: 'Program definitions (name → { type, path })' },
  },
};
