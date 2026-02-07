// backend/src/1_adapters/content/readalong/manifest.mjs

export default {
  provider: 'readalong',
  capability: 'readalong',
  displayName: 'Follow-Along Readalong Content (Scripture, Talks, Poetry)',
  mediaTypes: ['audio'],
  playableType: 'readalong',

  // Readalong adapter is implicitly available (no external dependencies)
  implicit: true,

  adapter: () => import('./ReadalongAdapter.mjs'),

  configSchema: {
    dataPath: {
      type: 'string',
      required: true,
      description: 'Path to readalong content data files (YAML metadata)'
    },
    mediaPath: {
      type: 'string',
      required: true,
      description: 'Path to readalong content media files'
    }
  }
};