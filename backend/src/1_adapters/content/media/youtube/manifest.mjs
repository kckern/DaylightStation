// backend/src/1_adapters/content/media/youtube/manifest.mjs
export default {
  provider: 'youtube',
  capability: 'media',
  displayName: 'YouTube (Piped Proxy)',
  mediaTypes: ['video'],
  adapter: () => import('./YouTubeAdapter.mjs'),
  configSchema: {
    host: { type: 'string', required: true, description: 'Piped API base URL (e.g., https://pipedapi.kckern.net)' },
  },
};
