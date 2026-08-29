export default {
  capability: 'stream',
  provider: 'stream',
  displayName: 'External Stream',
  adapter: () => import('./StreamAdapter.mjs'),
};
