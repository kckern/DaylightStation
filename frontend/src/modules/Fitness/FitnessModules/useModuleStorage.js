import { useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useModuleStorage' });
  return _logger;
}

const MODULE_STORAGE_PREFIX = 'fitness_module_';

const useModuleStorage = (moduleId) => {
  const storageKey = `${MODULE_STORAGE_PREFIX}${moduleId}`;

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
      logger().warn('module-storage-save-failed', { key, error: e.message });
    }
  }, [storageKey]);

  const clear = useCallback(() => {
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  const clearAll = useCallback(() => {
    // Clear all fitness module storage
    Object.keys(localStorage)
      .filter(key => key.startsWith(MODULE_STORAGE_PREFIX))
      .forEach(key => localStorage.removeItem(key));
  }, []);

  return { get, set, clear, clearAll };
};

export default useModuleStorage;
