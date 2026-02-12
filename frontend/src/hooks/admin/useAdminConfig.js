import { useState, useCallback, useMemo, useRef } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import { notifications } from '@mantine/notifications';
import getLogger from '../../lib/logging/Logger.js';

const API_BASE = '/api/v1/admin/config/files';

/**
 * Hook for loading and saving YAML config files via the admin config API.
 *
 * Provides both parsed (JS object) and raw (YAML string) representations,
 * dirty tracking, optimistic revert, and structured logging.
 *
 * @param {string} filePath - Config file path relative to data root, e.g. 'household/config/fitness.yml'
 * @returns {object} Config state and actions
 */
export function useAdminConfig(filePath) {
  const logger = useMemo(() => getLogger().child({ hook: 'useAdminConfig', filePath }), [filePath]);

  const [data, setDataState] = useState(null);
  const [raw, setRawState] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);

  // Store the original values from the last successful load for revert
  const originalRef = useRef({ data: null, raw: '' });

  // Fetch config from the API
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`${API_BASE}/${filePath}`);
      const loadedData = result.parsed ?? null;
      const loadedRaw = result.raw ?? '';
      setDataState(loadedData);
      setRawState(loadedRaw);
      originalRef.current = { data: loadedData, raw: loadedRaw };
      setDirty(false);
      logger.info('admin.config.loaded', { filePath });
      return result;
    } catch (err) {
      setError(err);
      logger.error('admin.config.load.failed', { filePath, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [filePath, logger]);

  // Save config to the API
  const save = useCallback(async ({ useRaw = false } = {}) => {
    setSaving(true);
    setError(null);
    try {
      const body = useRaw ? { raw } : { parsed: data };
      const result = await DaylightAPI(`${API_BASE}/${filePath}`, body, 'PUT');
      // After a successful save, update the originals so revert goes back to saved state
      const savedData = result.parsed ?? data;
      const savedRaw = result.raw ?? raw;
      setDataState(savedData);
      setRawState(savedRaw);
      originalRef.current = { data: savedData, raw: savedRaw };
      setDirty(false);
      logger.info('admin.config.saved', { filePath, useRaw });
      notifications.show({
        title: 'Saved',
        message: `${filePath} updated`,
        color: 'green',
        autoClose: 3000,
      });
      return result;
    } catch (err) {
      setError(err);
      logger.error('admin.config.save.failed', { filePath, message: err.message });
      notifications.show({
        title: 'Save failed',
        message: err.message || 'An error occurred',
        color: 'red',
        autoClose: false,
      });
      throw err;
    } finally {
      setSaving(false);
    }
  }, [filePath, data, raw, logger]);

  // Revert to the last-loaded values
  const revert = useCallback(() => {
    setDataState(originalRef.current.data);
    setRawState(originalRef.current.raw);
    setDirty(false);
    setError(null);
    logger.info('admin.config.reverted', { filePath });
    notifications.show({
      title: 'Reverted',
      message: 'Changes discarded',
      color: 'gray',
      autoClose: 2000,
    });
  }, [filePath, logger]);

  // Stage a parsed data update and mark dirty.
  // Accepts either a new object or an updater function: setData(prev => ({ ...prev, key: value }))
  const setData = useCallback((newDataOrUpdater) => {
    setDataState(prev => {
      const next = typeof newDataOrUpdater === 'function'
        ? newDataOrUpdater(prev)
        : newDataOrUpdater;
      return next;
    });
    setDirty(true);
  }, []);

  // Stage a raw YAML string update and mark dirty
  const setRaw = useCallback((newStr) => {
    setRawState(newStr);
    setDirty(true);
  }, []);

  // Clear error state
  const clearError = useCallback(() => setError(null), []);

  return {
    data,
    raw,
    loading,
    saving,
    error,
    dirty,
    load,
    save,
    revert,
    setData,
    setRaw,
    clearError
  };
}

export default useAdminConfig;
