import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { RESILIENCE_STATUS } from '../hooks/useResilienceState.js';

const CompositeControllerContext = createContext(null);

const DEFAULT_COORDINATION = Object.freeze({
  overlayStallStrategy: 'mute-overlay'
});

const COMPOSITE_ROLES = new Set(['primary', 'overlay']);

const isMeaningfulRole = (value) => COMPOSITE_ROLES.has(value);

const didRecoverFromStall = (prevStatus, nextStatus) => (
  (prevStatus === RESILIENCE_STATUS.stalling || prevStatus === RESILIENCE_STATUS.recovering)
  && nextStatus === RESILIENCE_STATUS.playing
);

const isStalled = (status) => status === RESILIENCE_STATUS.stalling;

const getTransportApi = (controller) => controller?.transport || controller || null;

export function CompositeControllerProvider({ children, config }) {
  const coordination = useMemo(
    () => ({ ...DEFAULT_COORDINATION, ...(config || {}) }),
    [config]
  );

  const [registry, setRegistry] = useState(() => ({
    primary: { controller: null, resilience: null },
    overlay: { controller: null, resilience: null }
  }));

  const previousPrimaryStatusRef = useRef(null);
  const lastKnownOverlayStatusRef = useRef(null);
  const overlayMuteStateRef = useRef({ active: false, previousMuted: null });

  const updateRoleEntry = useCallback((role, patch) => {
    if (!isMeaningfulRole(role)) return;
    setRegistry((prev) => {
      const prevEntry = prev[role];
      let changed = false;
      const nextEntry = { ...prevEntry };
      if ('controller' in patch && prevEntry.controller !== patch.controller) {
        nextEntry.controller = patch.controller;
        changed = true;
      }
      if ('resilience' in patch && prevEntry.resilience !== patch.resilience) {
        nextEntry.resilience = patch.resilience;
        changed = true;
      }
      if (!changed) return prev;
      return { ...prev, [role]: nextEntry };
    });
  }, []);

  const contextValue = useMemo(() => ({
    registerController: (role, controller) => {
      updateRoleEntry(role, { controller });
    },
    reportResilienceState: (role, resilience) => {
      updateRoleEntry(role, { resilience });
    }
  }), [updateRoleEntry]);

  const getMediaElForRole = useCallback((role) => {
    const entry = registry[role];
    const api = getTransportApi(entry?.controller);
    try {
      return api?.getMediaEl?.() || null;
    } catch (_) {
      return null;
    }
  }, [registry]);

  const applyOverlayMute = useCallback((shouldMute) => {
    const mediaEl = getMediaElForRole('overlay');
    if (!mediaEl) {
      overlayMuteStateRef.current = { active: false, previousMuted: null };
      return;
    }
    if (shouldMute) {
      if (overlayMuteStateRef.current.active) return;
      overlayMuteStateRef.current = {
        active: true,
        previousMuted: mediaEl.muted
      };
      mediaEl.muted = true;
      return;
    }
    if (!overlayMuteStateRef.current.active) return;
    const fallback = overlayMuteStateRef.current.previousMuted ?? false;
    overlayMuteStateRef.current = { active: false, previousMuted: null };
    mediaEl.muted = fallback;
  }, [getMediaElForRole]);

  const syncOverlayToPrimary = useCallback(() => {
    const primarySeconds = registry.primary.resilience?.seconds;
    if (!Number.isFinite(primarySeconds)) return;
    const mediaEl = getMediaElForRole('overlay');
    if (!mediaEl) return;
    const current = Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : 0;
    if (Math.abs(current - primarySeconds) < 0.25) return;
    try {
      mediaEl.currentTime = primarySeconds;
    } catch (_) {
      // ignore seek issues; resilience will retry if needed
    }
  }, [getMediaElForRole, registry.primary.resilience]);

  useEffect(() => {
    const status = registry.primary.resilience?.status || null;
    const prevStatus = previousPrimaryStatusRef.current;
    previousPrimaryStatusRef.current = status;

    if (!status) return;

    if (isStalled(status)) {
      const overlayController = getTransportApi(registry.overlay.controller);
      overlayController?.pause?.();
      return;
    }

    if (prevStatus && didRecoverFromStall(prevStatus, status)) {
      const overlayController = getTransportApi(registry.overlay.controller);
      overlayController?.play?.();
      // syncOverlayToPrimary(); // Disabled: overlay audio should be independent
      if (overlayMuteStateRef.current.active) {
        applyOverlayMute(false);
      }
    }
  }, [registry.primary.resilience, registry.overlay.controller, syncOverlayToPrimary, applyOverlayMute]);

  useEffect(() => {
    const overlayStatus = registry.overlay.resilience?.status || null;
    if (!overlayStatus) return;

    const prevStatus = lastKnownOverlayStatusRef.current;
    lastKnownOverlayStatusRef.current = overlayStatus;

    if (isStalled(overlayStatus)) {
      if (coordination.overlayStallStrategy === 'pause-primary') {
        const primaryController = getTransportApi(registry.primary.controller);
        primaryController?.pause?.();
      } else {
        applyOverlayMute(true);
      }
      return;
    }

    const wasStalling = prevStatus === RESILIENCE_STATUS.stalling || prevStatus === RESILIENCE_STATUS.recovering;
    const isNowActive = overlayStatus === RESILIENCE_STATUS.playing || overlayStatus === RESILIENCE_STATUS.startup;

    if (wasStalling && isNowActive) {
      const overlayResilience = registry.overlay.resilience;
      if (overlayResilience?.userIntent === 'playing') {
        const overlayController = getTransportApi(registry.overlay.controller);
        overlayController?.play?.();
      }
    }

    // Enforce overlay playback if primary is playing but overlay is paused
    const primaryStatus = registry.primary.resilience?.status || null;
    const isPrimaryPlaying = primaryStatus === RESILIENCE_STATUS.playing || primaryStatus === RESILIENCE_STATUS.startup;
    if (isPrimaryPlaying && overlayStatus === RESILIENCE_STATUS.paused) {
      const overlayController = getTransportApi(registry.overlay.controller);
      overlayController?.play?.();
    }

    if (overlayStatus === RESILIENCE_STATUS.playing && overlayMuteStateRef.current.active) {
      applyOverlayMute(false);
    }
  }, [registry.overlay.resilience, registry.primary.resilience, registry.primary.controller, registry.overlay.controller, coordination.overlayStallStrategy, applyOverlayMute]);

  useEffect(() => () => {
    overlayMuteStateRef.current = { active: false, previousMuted: null };
  }, []);

  return (
    <CompositeControllerContext.Provider value={contextValue}>
      {children}
    </CompositeControllerContext.Provider>
  );
}

export function useCompositeControllerChannel(role) {
  const context = useContext(CompositeControllerContext);
  const normalizedRole = isMeaningfulRole(role) ? role : null;

  const registerController = useCallback((controller) => {
    if (!context || !normalizedRole) return;
    context.registerController(normalizedRole, controller);
  }, [context, normalizedRole]);

  const reportResilienceState = useCallback((state) => {
    if (!context || !normalizedRole) return;
    context.reportResilienceState(normalizedRole, state);
  }, [context, normalizedRole]);

  useEffect(() => () => {
    if (!context || !normalizedRole) return;
    context.registerController(normalizedRole, null);
    context.reportResilienceState(normalizedRole, null);
  }, [context, normalizedRole]);

  if (!context || !normalizedRole) {
    return null;
  }

  return {
    registerController,
    reportResilienceState
  };
}
