import { useCallback } from 'react';

const PLUGIN_STORAGE_PREFIX = 'fitness_plugin_';

const usePluginStorage = (pluginId) => {
  const storageKey = `${PLUGIN_STORAGE_PREFIX}${pluginId}`;
  
  const get = useCallback((key, defaultValue = null) => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return defaultValue;
      const data = JSON.parse(raw);
      return data[key] ?? defaultValue;
    } catch {
      return defaultValue;
    }
  }, [storageKey]);
  
  const set = useCallback((key, value) => {
    try {
      const raw = localStorage.getItem(storageKey);
      const data = raw ? JSON.parse(raw) : {};
      data[key] = value;
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch (e) {
      console.error(`Failed to save plugin setting: ${key}`, e);
    }
  }, [storageKey]);
  
  const clear = useCallback(() => {
    localStorage.removeItem(storageKey);
  }, [storageKey]);
  
  const clearAll = useCallback(() => {
    // Clear all fitness plugin storage
    Object.keys(localStorage)
      .filter(key => key.startsWith(PLUGIN_STORAGE_PREFIX))
      .forEach(key => localStorage.removeItem(key));
  }, []);
  
  return { get, set, clear, clearAll };
};

export default usePluginStorage;
