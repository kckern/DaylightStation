// backend/src/1_adapters/content/app-registry/manifest.mjs

export default {
  provider: 'app-registry',
  capability: 'app',
  displayName: 'Native Apps (Webcam, Gratitude, etc.)',
  mediaTypes: [],
  playableType: 'app',
  implicit: true,
  adapter: () => import('./AppRegistryAdapter.mjs'),
  configSchema: {
    apps: {
      type: 'object',
      required: true,
      description: 'Map of app IDs to { label, param? } objects',
    },
  },
};
