// backend/src/2_adapters/finance/buxfer/manifest.mjs

export default {
  provider: 'buxfer',
  capability: 'finance',
  displayName: 'Buxfer',

  adapter: () => import('../BuxferAdapter.mjs'),

  configSchema: {
    email: { type: 'string', required: true, description: 'Buxfer account email' },
    password: { type: 'string', secret: true, required: true, description: 'Buxfer account password' },
  }
};
