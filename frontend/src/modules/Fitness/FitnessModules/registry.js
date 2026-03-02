export const MODULE_REGISTRY = {};

export const registerModule = (moduleDef) => {
  if (moduleDef?.manifest?.id) {
    MODULE_REGISTRY[moduleDef.manifest.id] = moduleDef;
  }
};

export const getModule = (moduleId) => MODULE_REGISTRY[moduleId]?.default || null;
export const getModuleManifest = (moduleId) => MODULE_REGISTRY[moduleId]?.manifest || null;
export const listModules = () => Object.entries(MODULE_REGISTRY).map(([id, mod]) => ({
  id,
  ...mod.manifest
}));
