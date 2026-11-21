import React, { createContext, useRef, useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmModal } from '../../../lib/ui/ConfirmModal.jsx';
import getLogger from '../../../lib/logging/Logger.js';

/**
 * UnsavedGuardContext — registry of dirty flags for admin editors.
 *
 * Editors register their dirty state via useUnsavedGuard(); navigation controls
 * ask prepareNavigation() before leaving the current draft.
 *
 * The registry lives in a ref (consumers need a point-in-time answer when a
 * navigation is requested). The provider owns the single confirmation flow.
 */
export const UnsavedGuardContext = createContext(null);

export function UnsavedGuardProvider({ children }) {
  const navigate = useNavigate();
  const logger = useMemo(() => getLogger().child({ component: 'unsaved-guard' }), []);
  const registryRef = useRef(new Map());
  const [pendingNavigation, setPendingNavigation] = useState(null);

  const register = useCallback((id, dirty, onDiscard) => {
    registryRef.current.set(id, { dirty: Boolean(dirty), onDiscard });
  }, []);

  const unregister = useCallback((id) => {
    registryRef.current.delete(id);
  }, []);

  const isAnyDirty = useCallback(() => {
    for (const entry of registryRef.current.values()) {
      if (entry.dirty) return true;
    }
    return false;
  }, []);

  const prepareNavigation = useCallback((to) => {
    if (!isAnyDirty()) return true;
    setPendingNavigation({ kind: 'navigate', to });
    logger.info('unsaved_guard.nav_blocked', { to });
    return false;
  }, [isAnyDirty, logger]);

  const guardedNavigate = useCallback((to) => {
    if (!prepareNavigation(to)) return false;
    navigate(to);
    return true;
  }, [navigate, prepareNavigation]);

  const cancelNavigation = useCallback(() => setPendingNavigation(null), []);
  const confirmNavigation = useCallback(() => {
    const pending = pendingNavigation;
    setPendingNavigation(null);
    for (const entry of registryRef.current.values()) {
      if (entry.dirty) entry.onDiscard?.();
    }
    if (pending?.to) {
      logger.info('unsaved_guard.discard_confirmed', { to: pending.to });
      navigate(pending.to);
    }
  }, [logger, navigate, pendingNavigation]);

  const value = useMemo(
    () => ({ register, unregister, isAnyDirty, prepareNavigation, guardedNavigate }),
    [register, unregister, isAnyDirty, prepareNavigation, guardedNavigate]
  );

  return (
    <UnsavedGuardContext.Provider value={value}>
      {children}
      <ConfirmModal
        opened={pendingNavigation !== null}
        onClose={cancelNavigation}
        onConfirm={confirmNavigation}
        title="Discard unsaved changes?"
        message="You have unsaved changes on this page."
        impact="Your edits will be lost."
        confirmLabel="Discard"
      />
    </UnsavedGuardContext.Provider>
  );
}

export default UnsavedGuardContext;
