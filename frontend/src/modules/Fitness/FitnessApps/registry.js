export const APP_REGISTRY = {};

export const registerApp = (appModule) => {
  if (appModule?.manifest?.id) {
    APP_REGISTRY[appModule.manifest.id] = appModule;
  }
};

export const getApp = (appId) => APP_REGISTRY[appId]?.default || null;
export const getAppManifest = (appId) => APP_REGISTRY[appId]?.manifest || null;
export const listApps = () => Object.entries(APP_REGISTRY).map(([id, mod]) => ({
  id,
  ...mod.manifest
}));
