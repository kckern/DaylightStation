// backend/src/1_adapters/content/narrated/manifest.mjs

export default {
  provider: 'narrated',
  capability: 'narrated',
  displayName: 'Follow-Along Narrated Content (Scripture, Talks, Poetry)',
  mediaTypes: ['audio'],
  playableType: 'narrated',

  // Narrated adapter is implicitly available (no external dependencies)
  implicit: true,

  adapter: () => import('./NarratedAdapter.mjs'),

  configSchema: {
    dataPath: {
      type: 'string',
      required: true,
      description: 'Path to narrated content data files (YAML metadata)'
    },
    mediaPath: {
      type: 'string',
      required: true,
      description: 'Path to narrated content media files'
    }
  }
};
