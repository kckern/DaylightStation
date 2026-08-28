// frontend/src/modules/Media/cast/DispatchProvider.jsx
// Dispatch orchestration: client-side fan-out (one /load per target,
// independent dispatchIds), live wake-progress via homeline:* broadcasts,
// idempotency dedupe window (C9.8), parameter-free retry of the last attempt
// (C6.4). Transfer mode stops local playback only on confirmed success.
// Hand-off sends the full SessionSnapshot with mode:"adopt" (§4.7).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { subscribeTopicKind } from '../net/ws.js';
import { reduceDispatch, initialDispatchState } from './dispatchReducer.js';
import { buildDispatchUrl } from './dispatchUrl.js';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { TIMING } from '../constants.js';
import mediaLog from '../logging/mediaLog.js';

export const DispatchContext = createContext(null);

function uuid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* ignore */ }
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildDedupKey({ targetIds, play, queue, mode, snapshot }) {
  const ids = [...targetIds].sort().join(',');
  // Adopt-mode (hand-off) keys carry the snapshot's identity — two
  // consecutive hand-offs of DIFFERENT content/positions are different
  // dispatches, not duplicates (C9.8 covers identical parameters only).
  const content = play ?? queue ?? (snapshot
    ? `adopt:${snapshot.sessionId}:${snapshot.currentItem?.contentId ?? 'none'}:${Math.round(snapshot.position ?? 0)}`
    : 'adopt');
  return `${ids}|${content}|${mode ?? 'transfer'}`;
}

export function DispatchProvider({ children }) {
  const [state, dispatch] = useReducer(reduceDispatch, initialDispatchState);
  const lastAttemptRef = useRef(null);
  const dedupCacheRef = useRef(new Map());
  // Identical dispatches still IN FLIGHT, keyed the same way as the dedupe
  // cache. The 5s window (C9.8) assumes a dispatch resolves quickly, but a
  // cold LG OLED holds the power step for up to 80s — on 2026-08-12 a user
  // tapped cast three times during one such wait and the window had long
  // since lapsed, so a second full backend dispatch went out and only the
  // BACKEND caught the third. An in-flight duplicate is a duplicate however
  // long it has been running. Kept in a ref, not reducer state, so
  // dispatchToTarget's identity stays stable.
  const inFlightRef = useRef(new Map());
  // The controller object is stable for the provider's lifetime — no
  // ref-mirroring needed to use it inside async callbacks.
  const localCtx = useContext(LocalSessionContext);
  const localController = localCtx?.controller ?? null;

  useEffect(() => {
    return subscribeTopicKind('homeline', (msg) => {
      const { dispatchId, step, status, elapsedMs, error } = msg;
      if (typeof dispatchId !== 'string' || !dispatchId) return;
      if (!step || !status) return;
      mediaLog.dispatchStep({ dispatchId, step, status, elapsedMs });
      dispatch({ type: 'STEP', dispatchId, step, status, elapsedMs, error });
    });
  }, []);

  const dispatchToTarget = useCallback(async ({ targetIds, play, queue, mode, shader, volume, shuffle, snapshot, title }, { bypassDedupe = false } = {}) => {
    if (!Array.isArray(targetIds) || targetIds.length === 0) return [];

    const key = buildDedupKey({ targetIds, play, queue, mode, snapshot });
    const inFlight = inFlightRef.current.get(key);
    const cached = dedupCacheRef.current.get(key);
    const withinWindow = cached && Date.now() - cached.ts < TIMING.DISPATCH_DEDUPE_WINDOW_MS;
    if (!bypassDedupe && (inFlight?.size || withinWindow)) {
      const firstDispatchIds = inFlight?.size ? [...inFlight] : cached.dispatchIds;
      mediaLog.dispatchDeduplicated({
        targetIds,
        contentId: play ?? queue ?? 'adopt',
        mode: mode ?? 'transfer',
        reason: inFlight?.size ? 'in-flight' : 'window',
        windowMs: TIMING.DISPATCH_DEDUPE_WINDOW_MS,
        firstDispatchIds,
      });
      return firstDispatchIds;
    }

    const isAdopt = !!snapshot;
    const contentId = play ?? queue ?? (isAdopt ? (snapshot?.currentItem?.contentId ?? 'adopt-snapshot') : null);
    // Human content title for the tray (additive — callers that don't pass
    // one degrade to no title, never to a raw content id in the UI).
    const contentTitle = title ?? snapshot?.currentItem?.title ?? null;
    const dispatchIds = [];
    lastAttemptRef.current = { targetIds, play, queue, mode, shader, volume, shuffle, snapshot, title };

    const settle = (dispatchId) => {
      const set = inFlightRef.current.get(key);
      if (!set) return;
      set.delete(dispatchId);
      if (set.size === 0) inFlightRef.current.delete(key);
    };
    inFlightRef.current.set(key, new Set());

    for (const deviceId of targetIds) {
      const dispatchId = uuid();
      dispatchIds.push(dispatchId);
      inFlightRef.current.get(key)?.add(dispatchId);
      dispatch({ type: 'INITIATED', dispatchId, deviceId, contentId, title: contentTitle, mode: mode ?? 'transfer' });
      mediaLog.dispatchInitiated({ dispatchId, deviceId, contentId, mode });

      const httpPromise = isAdopt
        ? DaylightAPI(`api/v1/device/${deviceId}/load`, { dispatchId, snapshot, mode: 'adopt' }, 'POST')
        : DaylightAPI(buildDispatchUrl({ deviceId, play, queue, dispatchId, shader, volume, shuffle }));
      httpPromise
        .then((res) => {
          settle(dispatchId);
          if (res?.ok) {
            dispatch({ type: 'SUCCEEDED', dispatchId, totalElapsedMs: res.totalElapsedMs ?? null });
            mediaLog.dispatchSucceeded({ dispatchId, totalElapsedMs: res.totalElapsedMs });
            // Cast Transfer: local stops only after the target confirms.
            if (mode === 'transfer') {
              try { localController?.transport?.stop?.(); } catch { /* ignore */ }
            }
          } else {
            // Failure must not poison the idempotency cache — the user's
            // retry within the window has to actually re-dispatch (C6.4).
            dedupCacheRef.current.delete(key);
            dispatch({
              type: 'FAILED', dispatchId,
              error: res?.error ?? 'unknown',
              failedStep: res?.failedStep ?? null,
            });
            mediaLog.dispatchFailed({ dispatchId, failedStep: res?.failedStep, error: res?.error });
          }
        })
        .catch((err) => {
          settle(dispatchId);
          dedupCacheRef.current.delete(key);
          dispatch({ type: 'FAILED', dispatchId, error: err?.message ?? 'network-error', failedStep: null });
          mediaLog.dispatchFailed({ dispatchId, error: err?.message });
        });
    }

    dedupCacheRef.current.set(key, { ts: Date.now(), dispatchIds });
    return dispatchIds;
  }, [localController]);

  const retryLast = useCallback(() => {
    if (!lastAttemptRef.current) return [];
    // Explicit user retry is never a duplicate.
    return dispatchToTarget(lastAttemptRef.current, { bypassDedupe: true });
  }, [dispatchToTarget]);

  const removeDispatch = useCallback((dispatchId) => {
    dispatch({ type: 'REMOVED', dispatchId });
  }, []);

  const value = useMemo(
    () => ({ dispatches: state.byId, dispatchToTarget, retryLast, removeDispatch }),
    [state.byId, dispatchToTarget, retryLast, removeDispatch]
  );

  return <DispatchContext.Provider value={value}>{children}</DispatchContext.Provider>;
}

export default DispatchProvider;
