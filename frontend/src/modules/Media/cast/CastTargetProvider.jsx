import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { PeekContext } from '../peek/PeekContext.js';
import mediaLog from '../logging/mediaLog.js';
import {
  AIM_IDLE_MS,
  advanceAimLifetime,
  renewAimActivity,
  restoreAimState,
} from './aimLifetime.js';

export const CAST_TARGET_KEY = 'media-app.cast-target';
export const CastTargetContext = createContext(null);

function readPersisted(now) {
  try {
    const raw = localStorage.getItem(CAST_TARGET_KEY);
    return restoreAimState(raw, { now });
  } catch {
    return restoreAimState(null, { now });
  }
}

function writePersisted(state) {
  try { localStorage.setItem(CAST_TARGET_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export function CastTargetProvider({ children }) {
  // This must be an initializer, not a mount effect: a blank first render
  // would persist over a real remote aim before restoration could happen.
  const [initial] = useState(() => {
    const now = Date.now();
    const restored = readPersisted(now);
    // Fleet evidence is asynchronous. Only a current positive observation can
    // pause expiry, so an already-idle persisted aim must be local before its
    // first layout, not briefly expose a stale remote destination.
    const expiry = advanceAimLifetime(restored.state, { now, exemption: false });
    return { ...restored, state: expiry.state, expired: expiry.expired };
  });
  const [aim, setAim] = useState(initial.state);
  const fleet = useContext(FleetContext);
  const peek = useContext(PeekContext);
  const fleetStore = fleet?.store ?? null;
  const subscribeFleet = useCallback(
    (notify) => fleetStore?.subscribeAll?.(notify) ?? (() => {}),
    [fleetStore]
  );
  const getFleetSnapshot = useCallback(
    () => fleetStore?.getAll?.() ?? EMPTY_FLEET,
    [fleetStore]
  );
  useSyncExternalStore(subscribeFleet, getFleetSnapshot, getFleetSnapshot);

  const exemption = getAimExemption(aim.targetIds, fleetStore, peek?.getSteeringActivity);

  useEffect(() => {
    if (initial.restored) mediaLog.aimRestored({ migrated: initial.migrated, targetIds: aim.targetIds });
    if (initial.expired) mediaLog.aimExpired({ targetIds: initial.state.targetIds });
  // Intentionally mounts once: restoration itself is synchronous.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { writePersisted(aim); }, [aim]);

  const reconcileLifetime = useCallback(() => {
    setAim((previous) => {
      const result = advanceAimLifetime(previous, { exemption, now: Date.now() });
      if (result.expired) mediaLog.aimExpired({ targetIds: previous.targetIds });
      else if (result.exemptionChanged) {
        mediaLog.aimExemption({ active: result.state.exemptionStartedAt != null, targetIds: previous.targetIds });
      }
      return result.state;
    });
  }, [exemption]);

  useEffect(() => {
    reconcileLifetime();
    if (aim.targetIds.length === 0 || exemption === true) return undefined;
    const remaining = Math.max(0, AIM_IDLE_MS - (Date.now() - aim.activityAt));
    const timer = setTimeout(reconcileLifetime, remaining);
    return () => clearTimeout(timer);
  }, [aim.activityAt, aim.targetIds.length, exemption, reconcileLifetime]);

  useEffect(() => {
    const renew = () => {
      setAim((previous) => {
        const next = renewAimActivity(previous, { now: Date.now() });
        mediaLog.aimActivity({ source: 'interaction', targetIds: previous.targetIds });
        return next;
      });
    };
    document.addEventListener('pointerdown', renew, { capture: true });
    document.addEventListener('keydown', renew, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', renew, { capture: true });
      document.removeEventListener('keydown', renew, { capture: true });
    };
  }, []);

  const setMode = useCallback((m) => {
    if (m !== 'transfer' && m !== 'fork') return;
    setAim((previous) => {
      const next = renewAimActivity({ ...previous, mode: m }, { now: Date.now() });
      mediaLog.aimActivity({ source: 'mode', targetIds: next.targetIds });
      return next;
    });
  }, []);

  const toggleTarget = useCallback((id) => {
    if (typeof id !== 'string' || !id) return;
    setAim((previous) => {
      const targetIds = previous.targetIds.includes(id)
        ? previous.targetIds.filter((targetId) => targetId !== id)
        : [...previous.targetIds, id];
      const next = renewAimActivity({ ...previous, targetIds }, { now: Date.now() });
      mediaLog.aimActivity({ source: 'target-selection', targetIds });
      return next;
    });
  }, []);

  const clearTargets = useCallback(() => {
    setAim((previous) => {
      const next = renewAimActivity({ ...previous, targetIds: [], exemptionStartedAt: null }, { now: Date.now() });
      mediaLog.aimActivity({ source: 'this-device', targetIds: [] });
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ mode: aim.mode, targetIds: aim.targetIds, setMode, toggleTarget, clearTargets }),
    [aim.mode, aim.targetIds, setMode, toggleTarget, clearTargets]
  );

  return <CastTargetContext.Provider value={value}>{children}</CastTargetContext.Provider>;
}

const EMPTY_FLEET = new Map();

function matchesSteeringPlayback(entry, activity) {
  const playback = activity?.playback;
  const snapshot = entry?.snapshot;
  return !entry?.offline
    && !entry?.isStale
    && snapshot?.state === 'playing'
    && typeof playback?.sessionId === 'string'
    && playback.sessionId === snapshot.sessionId
    && typeof playback?.contentId === 'string'
    && playback.contentId === snapshot.currentItem?.contentId
    && (playback.queueItemId == null || playback.queueItemId === snapshot.currentItem?.queueItemId);
}

// Unknown fleet state is not receiver-idle, but it is not a positive reason
// to pause this browser's inactivity timer either. Source provenance is also unknown today:
// snapshot.meta.ownerId belongs to the target device, not the sending client.
// The active-steering branch below is therefore the only truthful exemption
// until the origin contract is widened by Task7.
function getAimExemption(targetIds, fleetStore, getSteeringActivity) {
  if (targetIds.length === 0) return false;
  let unknown = false;
  for (const targetId of targetIds) {
    const entry = fleetStore?.getEntry?.(targetId);
    if (!entry || entry.isStale) {
      unknown = true;
      continue;
    }
    if (matchesSteeringPlayback(entry, getSteeringActivity?.(targetId))) return true;
  }
  return unknown ? null : false;
}

export default CastTargetProvider;
