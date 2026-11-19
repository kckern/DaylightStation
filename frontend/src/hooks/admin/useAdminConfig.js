import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import { useApiResource } from '../../lib/hooks/useApiResource.js';
import { useDismissibleError } from '../../lib/hooks/useDismissibleError.js';
import { notifications } from '@mantine/notifications';
import getLogger from '../../lib/logging/Logger.js';

const API_BASE = '/api/v1/admin/config/files';

/**
 * Hook for loading and saving YAML config files via the admin config API.
 *
 * Provides both parsed (JS object) and raw (YAML string) representations,
 * dirty tracking, optimistic revert, and structured logging.
 *
 * @param {string} filePath - Config file path relative to data root, e.g. 'household/fitness/config.yml'
 * @returns {object} Config state and actions
 */
export function useAdminConfig(filePath) {
  const logger = useMemo(() => getLogger().child({ hook: 'useAdminConfig', filePath }), [filePath]);
  const resourcePath = `${API_BASE}/${filePath}`;
  const { data: loaded, loading: readLoading, error: readError, resourceKey } = useApiResource(resourcePath, {
    label: `Admin config ${filePath}`,
    retryTransient: false,
  });
  const { error: visibleReadError, dismiss: dismissReadError } = useDismissibleError(readError);

  const [draft, setDraft] = useState({ filePath: null, data: null, raw: '', dirty: false });
  const [savingPath, setSavingPath] = useState(null);
  const [commandError, setCommandError] = useState(null);

  // Store the original values from the last successful load for revert
  const originalRef = useRef({ filePath: null, data: null, raw: '' });
  const activeFilePath = useRef(filePath);
  activeFilePath.current = filePath;
  const draftMatches = draft.filePath === filePath;
  const data = draftMatches ? draft.data : null;
  const raw = draftMatches ? draft.raw : '';
  const dirty = draftMatches && draft.dirty;
  const loading = readLoading;
  const saving = savingPath === filePath;
  const error = (commandError?.filePath === filePath ? commandError.error : null) || visibleReadError;

  useEffect(() => {
    if (readLoading || resourceKey !== resourcePath || readError) return;
    const loadedData = loaded?.parsed ?? null;
    const loadedRaw = loaded?.raw ?? '';
    setDraft(current => current.filePath === filePath && current.dirty
      ? current
      : { filePath, data: loadedData, raw: loadedRaw, dirty: false });
    originalRef.current = { filePath, data: loadedData, raw: loadedRaw };
    logger.info('admin.config.loaded', { filePath });
  }, [filePath, loaded, logger, readError, readLoading, resourceKey, resourcePath]);

  // Save config to the API
  const save = useCallback(async ({ useRaw = false } = {}) => {
    setSavingPath(filePath);
    setCommandError(null);
    try {
      const body = useRaw ? { raw } : { parsed: data };
      const result = await DaylightAPI(`${API_BASE}/${filePath}`, body, 'PUT');
      // After a successful save, update the originals so revert goes back to saved state
      const savedData = result.parsed ?? data;
      const savedRaw = result.raw ?? raw;
      if (activeFilePath.current === filePath) {
        setDraft(current => current.filePath === filePath
          ? { ...current, data: savedData, raw: savedRaw, dirty: false }
          : current);
        if (originalRef.current.filePath === filePath) {
          originalRef.current = { filePath, data: savedData, raw: savedRaw };
        }
      }
      logger.info('admin.config.saved', { filePath, useRaw });
      if (activeFilePath.current === filePath) {
        notifications.show({
          title: 'Saved',
          message: `${filePath} updated`,
          color: 'green',
          autoClose: 3000,
        });
      }
      return result;
    } catch (err) {
      if (activeFilePath.current === filePath) setCommandError({ filePath, error: err });
      logger.error('admin.config.save.failed', { filePath, message: err.message });
      if (activeFilePath.current === filePath) {
        notifications.show({
          title: 'Save failed',
          message: err.message || 'An error occurred',
          color: 'red',
          autoClose: false,
        });
      }
      throw err;
    } finally {
      setSavingPath(current => current === filePath ? null : current);
    }
  }, [filePath, data, raw, logger]);

  // Revert to the last-loaded values
  const revert = useCallback(() => {
    if (originalRef.current.filePath !== filePath) return;
    setDraft({
      filePath,
      data: originalRef.current.data,
      raw: originalRef.current.raw,
      dirty: false,
    });
    setCommandError(null);
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
    setDraft(current => {
      if (current.filePath !== filePath) return current;
      const next = typeof newDataOrUpdater === 'function'
        ? newDataOrUpdater(current.data)
        : newDataOrUpdater;
      return { ...current, data: next, dirty: true };
    });
  }, [filePath]);

  // Stage a raw YAML string update and mark dirty
  const setRaw = useCallback((newStr) => {
    setDraft(current => current.filePath === filePath
      ? { ...current, raw: newStr, dirty: true }
      : current);
  }, [filePath]);

  // Clear error state
  const clearError = useCallback(() => {
    setCommandError(null);
    dismissReadError();
  }, [dismissReadError]);

  return {
    data,
    raw,
    loading,
    saving,
    error,
    dirty,
    save,
    revert,
    setData,
    setRaw,
    clearError
  };
}

export default useAdminConfig;
