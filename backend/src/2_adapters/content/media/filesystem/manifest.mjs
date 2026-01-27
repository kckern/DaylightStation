// backend/src/2_adapters/content/media/filesystem/manifest.mjs

export default {
  provider: 'filesystem',
  capability: 'media',
  displayName: 'Local Filesystem',

  // Filesystem is always implicitly available
  implicit: true,

  adapter: () => import('./FilesystemAdapter.mjs'),

  configSchema: {
    basePath: { type: 'string', required: true, description: 'Base path for media files' },
  }
};
