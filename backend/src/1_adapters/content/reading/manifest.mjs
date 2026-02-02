// backend/src/1_adapters/content/reading/manifest.mjs

export default {
  provider: 'reading',
  capability: 'reading',
  displayName: 'Follow-Along Reading Content (Scripture, Talks, Poetry)',

  // Reading adapter is implicitly available (no external dependencies)
  implicit: true,

  adapter: () => import('./ReadingAdapter.mjs'),

  configSchema: {
    dataPath: {
      type: 'string',
      required: true,
      description: 'Path to reading content data files (YAML metadata)'
    },
    mediaPath: {
      type: 'string',
      required: true,
      description: 'Path to reading content media files'
    }
  }
};
