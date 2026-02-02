// backend/src/1_adapters/content/media/local-media/manifest.mjs

export default {
  provider: 'local',
  capability: 'media',
  displayName: 'Local Media Files',

  // LocalMedia is always implicitly available
  implicit: true,

  adapter: () => import('./LocalMediaAdapter.mjs'),

  configSchema: {
    roots: {
      type: 'array',
      required: false,
      description: 'Configured media roots with path, label, and mediaType',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', required: true },
          label: { type: 'string', required: true },
          mediaType: { type: 'string', enum: ['video', 'audio', 'image'] }
        }
      }
    }
  }
};
