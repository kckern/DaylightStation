// backend/src/1_adapters/content/list/manifest.mjs

export default {
  provider: 'list',
  capability: 'list',
  displayName: 'Lists (Menus, Programs, Watchlists)',

  // Lists are always implicitly available
  implicit: true,

  adapter: () => import('./ListAdapter.mjs'),

  configSchema: {
    listsBasePath: {
      type: 'string',
      required: false,
      description: 'Base path for list YAML files (defaults to data/household/config/lists)'
    }
  }
};
