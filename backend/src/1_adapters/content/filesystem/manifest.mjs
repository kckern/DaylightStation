// backend/src/1_adapters/content/filesystem/manifest.mjs
export default {
  provider: 'filesystem',
  capability: 'content',
  displayName: 'Filesystem Content',
  adapter: () => import('./FilesystemDriver.mjs'),
  configSchema: {
    instanceName: { type: 'string', required: true },
    content_format: { type: 'string', enum: ['singalong', 'readalong', null] },
    data_path: { type: 'string' },
    media_path: { type: 'string' },
    media_path_map: { type: 'object' },
    path: { type: 'string' },
  },
  implicit: true,
};
