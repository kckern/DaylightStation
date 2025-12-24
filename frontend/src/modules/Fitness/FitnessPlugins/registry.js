export const PLUGIN_REGISTRY = {};

export const registerPlugin = (pluginModule) => {
  if (pluginModule?.manifest?.id) {
    PLUGIN_REGISTRY[pluginModule.manifest.id] = pluginModule;
  }
};

export const getPlugin = (pluginId) => PLUGIN_REGISTRY[pluginId]?.default || null;
export const getPluginManifest = (pluginId) => PLUGIN_REGISTRY[pluginId]?.manifest || null;
export const listPlugins = () => Object.entries(PLUGIN_REGISTRY).map(([id, mod]) => ({
  id,
  ...mod.manifest
}));
