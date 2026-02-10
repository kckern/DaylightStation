export default {
  provider: 'freshvideo',
  capability: 'freshvideo',
  displayName: 'Fresh Video (Daily Content)',
  mediaTypes: ['video'],
  playableType: 'video',
  implicit: true,
  adapter: () => import('./FreshVideoAdapter.mjs'),
  configSchema: {},
};
