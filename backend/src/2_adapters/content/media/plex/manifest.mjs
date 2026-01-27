// backend/src/2_adapters/content/media/plex/manifest.mjs

export default {
  provider: 'plex',
  capability: 'media',
  displayName: 'Plex Media Server',

  adapter: () => import('./PlexAdapter.mjs'),

  configSchema: {
    host: { type: 'string', required: true, description: 'Plex server URL (e.g., http://192.168.1.100:32400)' },
    port: { type: 'number', default: 32400, description: 'Plex server port' },
    token: { type: 'string', secret: true, description: 'X-Plex-Token for authentication' },
  }
};
