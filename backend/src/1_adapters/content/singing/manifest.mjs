// backend/src/1_adapters/content/singing/manifest.mjs

export default {
  provider: 'singing',
  capability: 'singing',
  displayName: 'Sing-Along Content (Hymns, Primary Songs)',

  // Singing adapter is implicitly available (no external dependencies)
  implicit: true,

  adapter: () => import('./SingingAdapter.mjs'),

  configSchema: {
    dataPath: {
      type: 'string',
      required: true,
      description: 'Path to singing content data files (YAML metadata)'
    },
    mediaPath: {
      type: 'string',
      required: true,
      description: 'Path to singing content media files'
    }
  }
};
