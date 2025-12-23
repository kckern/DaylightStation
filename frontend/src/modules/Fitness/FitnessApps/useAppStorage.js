import { useCallback } from 'react';

const APP_STORAGE_PREFIX = 'fitness_app_';

const useAppStorage = (appId) => {
  const storageKey = `${APP_STORAGE_PREFIX}${appId}`;
  
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
      console.error(`Failed to save app setting: ${key}`, e);
    }
  }, [storageKey]);
  
  const clear = useCallback(() => {
    localStorage.removeItem(storageKey);
  }, [storageKey]);
  
  const clearAll = useCallback(() => {
    // Clear all fitness app storage
    Object.keys(localStorage)
      .filter(key => key.startsWith(APP_STORAGE_PREFIX))
      .forEach(key => localStorage.removeItem(key));
  }, []);
  
  return { get, set, clear, clearAll };
};

export default useAppStorage;
