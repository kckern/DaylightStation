export default {
  provider: 'retroarch',
  capability: 'game',
  displayName: 'RetroArch Games (N64, SNES, Genesis, etc.)',
  mediaTypes: [],
  playableType: 'game',
  implicit: true,
  adapter: () => import('./RetroArchAdapter.mjs'),
  configSchema: {
    config: { type: 'object', required: true },
    catalog: { type: 'object', required: true }
  }
};
