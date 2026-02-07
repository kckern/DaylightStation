// backend/src/1_adapters/content/singalong/manifest.mjs

export default {
  provider: 'singalong',
  capability: 'singalong',
  displayName: 'Singalong Content (Hymns, Primary Songs)',
  mediaTypes: ['audio'],
  playableType: 'singalong',

  // Singalong adapter is implicitly available (no external dependencies)
  implicit: true,

  adapter: () => import('./SingalongAdapter.mjs'),

  configSchema: {
    dataPath: {
      type: 'string',
      required: true,
      description: 'Path to singalong content data files (YAML metadata)'
    },
    mediaPath: {
      type: 'string',
      required: true,
      description: 'Path to singalong content media files'
    }
  }
};