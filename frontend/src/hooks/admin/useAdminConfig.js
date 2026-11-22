import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import { readApiResource, useApiResource } from '../../lib/hooks/useApiResource.js';
import { useDismissibleError } from '../../lib/hooks/useDismissibleError.js';
import { notifications } from '@mantine/notifications';
import getLogger from '../../lib/logging/Logger.js';
import {
  acknowledgeAdminDraft,
  clearAdminDraft,
  adminDraftOwnerKey,
  rebaseAdminDraft,
  rememberAdminDraft,
  restoreAdminDraft,
} from '../../modules/Admin/shared/useAdminDraftState.js';
import { useAdminSessionKey } from '../../modules/Admin/shared/useAdminSessionKey.js';

const API_BASE = '/api/v1/admin/config/files';

function draftBaseline(snapshot) {
  return { exists: snapshot.exists, data: snapshot.data, raw: snapshot.raw, revision: snapshot.revision ?? null };
}

function draftValue(snapshot) {
  return { data: snapshot.data, raw: snapshot.raw, expectedRevision: snapshot.expectedRevision ?? null };
}

function expectedRevisionForDraft(restoredDraft, baseline) {
  return Object.prototype.hasOwnProperty.call(restoredDraft, 'expectedRevision')
    ? restoredDraft.expectedRevision
    : baseline.revision;
}

/**
 * Hook for loading and saving YAML config files via the admin config API.
 *
 * Provides both parsed (JS object) and raw (YAML string) representations,
 * dirty tracking, optimistic revert, and structured logging. Unsaved drafts
 * survive route unmounts only while the auth session and server baseline match.
 *
 * @param {string} filePath - Config file path relative to data root, e.g. 'household/fitness/config.yml'
 * @param {'parsed'|'raw'} mode - Editor representation, kept in its own history draft
 * @returns {object} Config state and actions
 */
export function useAdminConfig(filePath, mode = 'parsed') {
  const sessionKey = useAdminSessionKey();
  const ownerKey = adminDraftOwnerKey('config', sessionKey, filePath, mode);
  const logger = useMemo(() => getLogger().child({ hook: 'useAdminConfig', filePath }), [filePath]);
  const resourcePath = `${API_BASE}/${filePath}`;
  const { data: loaded, loading: readLoading, error: readError, reload: reloadResource, refresh: refreshResource } = useApiResource(resourcePath, {
    deps: [sessionKey],
    label: `Admin config ${filePath}`,
    retryTransient: false,
  });
  const { error: visibleReadError, dismiss: dismissReadError } = useDismissibleError(readError);

  const [draft, setDraft] = useState({ ownerKey: null, filePath: null, data: null, raw: '', dirty: false });
  const [savingOwnerKey, setSavingOwnerKey] = useState(null);
  const [commandError, setCommandError] = useState(null);

  // Keep refs in sync so input edits and late save acknowledgements can identify
  // the current revision without relying on a stale render closure.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const originalRef = useRef({ ownerKey: null, filePath: null, exists: false, data: null, raw: '' });
  const activeOwnerKey = useRef(ownerKey);
  activeOwnerKey.current = ownerKey;
  const draftMatches = draft.ownerKey === ownerKey && draft.filePath === filePath;
  const data = draftMatches ? draft.data : null;
  const raw = draftMatches ? draft.raw : '';
  const dirty = draftMatches && draft.dirty;
  // A failed read still exposes its error instead of waiting for a draft that
  // cannot hydrate. A cached draft is restored only after a successful read.
  const loading = readLoading || (!readError && !draftMatches);
  const saving = savingOwnerKey === ownerKey;
  const error = (commandError?.ownerKey === ownerKey ? commandError.error : null) || visibleReadError;

  useEffect(() => {
    activeOwnerKey.current = ownerKey;
    return () => {
      if (activeOwnerKey.current === ownerKey) activeOwnerKey.current = null;
    };
  }, [ownerKey]);

  useEffect(() => {
    if (readLoading) return;
    if (readError) {
      // A confirmed missing allowed file is editable from the raw config
      // editor. Missing and existing empty files have different baselines.
      if (readError.status === 404) {
        const baseline = { ownerKey, filePath, exists: false, data: null, raw: '', revision: null };
        originalRef.current = baseline;
        const current = draftRef.current;
        if (current.ownerKey === ownerKey && current.filePath === filePath && current.dirty) {
          rememberAdminDraft(ownerKey, draftBaseline(baseline), draftValue(current));
          return;
        }
        const restored = restoreAdminDraft(ownerKey, draftBaseline(baseline));
        const next = restored
          ? { ...baseline, ...restored.draft, expectedRevision: expectedRevisionForDraft(restored.draft, baseline), dirty: true }
          : { ...baseline, expectedRevision: baseline.revision, dirty: false };
        draftRef.current = next;
        setDraft(next);
      }
      return;
    }

    const baseline = {
      ownerKey,
      filePath,
      exists: true,
      data: loaded?.parsed ?? null,
      raw: loaded?.raw ?? '',
      revision: loaded?.revision ?? null,
    };
    originalRef.current = baseline;
    const current = draftRef.current;
    if (current.ownerKey === ownerKey && current.filePath === filePath && current.dirty) {
      // Advance only the Revert baseline. The draft keeps the revision it was
      // opened against so a later save detects concurrent server changes.
      rememberAdminDraft(ownerKey, draftBaseline(baseline), draftValue(current));
    } else {
      const restored = restoreAdminDraft(ownerKey, draftBaseline(baseline));
      const next = restored
        ? { ...baseline, ...restored.draft, expectedRevision: expectedRevisionForDraft(restored.draft, baseline), dirty: true }
        : { ...baseline, expectedRevision: baseline.revision, dirty: false };
      draftRef.current = next;
      setDraft(next);
    }
    logger.info('admin.config.loaded', { filePath });
  }, [filePath, loaded, logger, ownerKey, readError, readLoading, resourcePath]);

  // Save config to the API
  const save = useCallback(async ({ useRaw = false } = {}) => {
    setSavingOwnerKey(ownerKey);
    setCommandError(null);
    const submittedOriginal = originalRef.current;
    const submittedDraft = draftValue(draftRef.current);
    try {
      const body = useRaw
        ? { raw: submittedDraft.raw, expectedRevision: submittedDraft.expectedRevision }
        : { parsed: submittedDraft.data, expectedRevision: submittedDraft.expectedRevision };
      const result = await DaylightAPI(resourcePath, body, 'PUT');
      const savedBaseline = {
        ownerKey,
        filePath,
        exists: true,
        data: result.parsed ?? submittedDraft.data,
        raw: result.raw ?? submittedDraft.raw,
        revision: result.revision,
      };
      acknowledgeAdminDraft(
        ownerKey,
        draftBaseline(submittedOriginal),
        submittedDraft,
        draftBaseline(savedBaseline),
      );

      if (originalRef.current.ownerKey === ownerKey) originalRef.current = savedBaseline;
      if (activeOwnerKey.current === ownerKey) {
        const current = draftRef.current;
        if (current.ownerKey === ownerKey && current.filePath === filePath) {
          if (current === draft) {
            const clean = { ...savedBaseline, expectedRevision: savedBaseline.revision, dirty: false };
            draftRef.current = clean;
            setDraft(clean);
          } else {
            const rebased = { ...current, expectedRevision: savedBaseline.revision, dirty: true };
            draftRef.current = rebased;
            setDraft(rebased);
            rememberAdminDraft(ownerKey, draftBaseline(savedBaseline), draftValue(rebased));
          }
        }
        dismissReadError();
        notifications.show({
          title: 'Saved',
          message: `${filePath} updated`,
          color: 'green',
          autoClose: 3000,
        });
      }
      logger.info('admin.config.saved', { filePath, useRaw });
      return result;
    } catch (err) {
      let visibleError = err;
      if (err.status === 409) {
        let latestBaseline = null;
        try {
          const latest = await refreshResource();
          latestBaseline = {
            ownerKey,
            filePath,
            exists: true,
            data: latest?.parsed ?? null,
            raw: latest?.raw ?? '',
            revision: latest?.revision ?? null,
          };
        } catch (refreshError) {
          if (refreshError.status === 404) {
            latestBaseline = { ownerKey, filePath, exists: false, data: null, raw: '', revision: null };
          } else if (refreshError.name === 'AbortError') {
            try {
              const latest = await readApiResource(resourcePath, { freshMs: 0, followSuperseding: true });
              latestBaseline = {
                ownerKey,
                filePath,
                exists: true,
                data: latest?.parsed ?? null,
                raw: latest?.raw ?? '',
                revision: latest?.revision ?? null,
              };
            } catch (fallbackError) {
              if (fallbackError.status === 404) {
                latestBaseline = { ownerKey, filePath, exists: false, data: null, raw: '', revision: null };
              }
            }
          }
        }
        if (latestBaseline) {
          if (originalRef.current.ownerKey === ownerKey) originalRef.current = latestBaseline;
          rebaseAdminDraft(ownerKey, draftBaseline(latestBaseline));
        }
        visibleError = new Error('This file changed since you opened it. Your edits are still here.');
        visibleError.status = 409;
      }
      if (activeOwnerKey.current === ownerKey) {
        setCommandError({ ownerKey, error: visibleError });
        notifications.show({
          title: err.status === 409 ? 'Save conflict' : 'Save failed',
          message: visibleError.message || 'An error occurred',
          color: 'red',
          autoClose: false,
        });
      }
      logger.error('admin.config.save.failed', { filePath, message: err.message });
      throw err;
    } finally {
      setSavingOwnerKey(current => current === ownerKey ? null : current);
    }
  }, [dismissReadError, draft, filePath, logger, ownerKey, refreshResource, resourcePath]);

  // Revert to the last accepted server or saved snapshot.
  const revert = useCallback(() => {
    if (originalRef.current.ownerKey !== ownerKey || originalRef.current.filePath !== filePath) return;
    clearAdminDraft(ownerKey);
    const next = { ...originalRef.current, expectedRevision: originalRef.current.revision ?? null, dirty: false };
    draftRef.current = next;
    setDraft(next);
    setCommandError(null);
    logger.info('admin.config.reverted', { filePath });
    notifications.show({
      title: 'Reverted',
      message: 'Changes discarded',
      color: 'gray',
      autoClose: 2000,
    });
  }, [filePath, logger, ownerKey]);

  // Stage a parsed data update and synchronously remember it before navigation
  // can unmount the editor.
  const setData = useCallback((newDataOrUpdater) => {
    const current = draftRef.current;
    if (current.ownerKey !== ownerKey || current.filePath !== filePath) return;
    const nextData = typeof newDataOrUpdater === 'function'
      ? newDataOrUpdater(current.data)
      : newDataOrUpdater;
    const next = { ...current, data: nextData, dirty: true };
    draftRef.current = next;
    setDraft(next);
    const original = originalRef.current;
    if (original.ownerKey === ownerKey && original.filePath === filePath) {
      rememberAdminDraft(ownerKey, draftBaseline(original), draftValue(next));
    }
  }, [filePath, ownerKey]);

  // Stage a raw YAML string update and synchronously remember it.
  const setRaw = useCallback((newStr) => {
    const current = draftRef.current;
    if (current.ownerKey !== ownerKey || current.filePath !== filePath) return;
    const next = { ...current, raw: newStr, dirty: true };
    draftRef.current = next;
    setDraft(next);
    const original = originalRef.current;
    if (original.ownerKey === ownerKey && original.filePath === filePath) {
      rememberAdminDraft(ownerKey, draftBaseline(original), draftValue(next));
    }
  }, [filePath, ownerKey]);

  const discardDraft = useCallback(() => clearAdminDraft(ownerKey), [ownerKey]);

  // Clear error state
  const clearError = useCallback(() => {
    setCommandError(null);
    dismissReadError();
  }, [dismissReadError]);

  const retryRead = useCallback(() => {
    setCommandError(null);
    dismissReadError();
    reloadResource();
  }, [dismissReadError, reloadResource]);

  return {
    data,
    raw,
    loading,
    saving,
    error,
    readError: visibleReadError,
    draftReady: draftMatches,
    dirty,
    save,
    revert,
    setData,
    setRaw,
    discardDraft,
    clearError,
    retryRead
  };
}

export default useAdminConfig;
