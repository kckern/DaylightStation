// backend/src/1_adapters/content/media/media/manifest.mjs

export default {
  provider: 'files',
  capability: 'media',
  displayName: 'Local Media',

  // Media is always implicitly available
  implicit: true,

  adapter: () => import('./MediaAdapter.mjs'),

  configSchema: {
    basePath: { type: 'string', required: true, description: 'Base path for media files' },
  }
};
