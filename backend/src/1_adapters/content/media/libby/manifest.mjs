export default {
  provider: 'libby',
  capability: 'media',
  displayName: 'Libby',
  mediaTypes: ['audio'],
  libraryTypes: ['audiobook'],
  adapter: () => import('./LibbyAdapter.mjs'),
  configSchema: {
    username: { type: 'string', required: true, description: 'Daylight user whose auth/libby.yml supplies the JWT' },
  },
};
