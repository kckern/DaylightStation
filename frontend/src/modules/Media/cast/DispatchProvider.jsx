// frontend/src/modules/Media/cast/DispatchProvider.jsx
// Dispatch orchestration: client-side fan-out (one /load per target,
// independent dispatchIds), live wake-progress via homeline:* broadcasts,
// idempotency dedupe window (C9.8), and retry by exact dispatch attempt
// (C6.4). M0 blocks destructive transfer until an owner-qualified handoff
// exists; explicit fork/keep dispatch remains available.
// Hand-off sends the full SessionSnapshot with mode:"adopt" (§4.7).
import React, { createContext, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { subscribeTopicKind } from '../net/ws.js';
import { reduceDispatch, initialDispatchState } from './dispatchReducer.js';
import { buildDispatchUrl } from './dispatchUrl.js';
import { TIMING } from '../constants.js';
import mediaLog from '../logging/mediaLog.js';

export const DispatchContext = createContext(null);

function uuid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* ignore */ }
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function snapshotForRetry(snapshot) {
  // SessionSnapshot is a JSON wire contract. Capture those wire values now,
  // rather than retaining a caller-owned object that can change before Retry.
  return snapshot == null ? snapshot : JSON.parse(JSON.stringify(snapshot));
}

function buildDedupKey({ targetIds, play, queue, mode, shader, volume, shuffle, snapshot }) {
  const common = {
    targetIds: [...targetIds].sort(),
    mode: mode ?? 'transfer',
  };

  if (snapshot) {
    return JSON.stringify({
      ...common,
      request: { method: 'POST', mode: 'adopt', snapshot: snapshotForRetry(snapshot) },
    });
  }

  // Match buildDispatchUrl's wire normalization, excluding only dispatchId:
  // it is freshly generated per attempt and therefore cannot define whether
  // two user operations are duplicates.
  return JSON.stringify({
    ...common,
    request: {
      method: 'GET',
      verb: play ? 'play' : 'queue',
      contentId: play || queue,
      shader: shader || null,
      volume: typeof volume === 'number' && Number.isFinite(volume) ? volume : null,
      shuffle: !!shuffle,
    },
  });
}

export function DispatchProvider({ children }) {
  const [state, dispatch] = useReducer(reduceDispatch, initialDispatchState);
  // Fan-out rows retain independent replay inputs so one failed target can
  // be retried without replaying successful siblings.
  const attemptsRef = useRef(new Map());
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
  useEffect(() => {
    return subscribeTopicKind('homeline', (msg) => {
      const { dispatchId, step, status, elapsedMs, error, operation, queueLength,
        sessionId, ownerId, ownerInstanceId, playbackRevision, queueRevision } = msg;
      if (typeof dispatchId !== 'string' || !dispatchId) return;
      if (!step || !status) return;
      mediaLog.dispatchStep({ dispatchId, step, status, elapsedMs });
      dispatch({
        type: 'STEP', dispatchId, step, status, elapsedMs, error, operation, queueLength,
        sessionId, ownerId, ownerInstanceId, playbackRevision, queueRevision,
      });
    });
  }, []);

  const dispatchToTarget = useCallback(async ({ targetIds, play, queue, mode, shader, volume, shuffle, snapshot, title }, { bypassDedupe = false } = {}) => {
    if (!Array.isArray(targetIds) || targetIds.length === 0) return [];
    if (mode === 'transfer') {
      mediaLog.dispatchFailed({
        deviceId: targetIds[0] ?? null,
        contentId: play ?? queue ?? snapshot?.currentItem?.contentId ?? null,
        error: 'move-unsupported',
      });
      return [];
    }

    const key = buildDedupKey({
      targetIds, play, queue, mode, shader, volume, shuffle, snapshot,
    });
    const inFlight = inFlightRef.current.get(key);
    const cached = dedupCacheRef.current.get(key);
    const withinWindow = cached && Date.now() - cached.ts < TIMING.DISPATCH_DEDUPE_WINDOW_MS;
    // An explicit retry may bypass the settled-attempt window, but it must
    // never bypass an identical retry that is already in flight.
    if (inFlight?.size || (!bypassDedupe && withinWindow)) {
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
    const retrySnapshot = snapshotForRetry(snapshot);
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
      attemptsRef.current.set(dispatchId, {
        targetIds: [deviceId], play, queue, mode, shader, volume, shuffle, snapshot: retrySnapshot, title,
      });
      dispatch({
        type: 'INITIATED', dispatchId, deviceId, contentId, title: contentTitle,
        mode: mode ?? 'transfer', operation: queue ? 'add' : 'play-now',
      });
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
  }, []);

  const retry = useCallback((dispatchId) => {
    const attempt = attemptsRef.current.get(dispatchId);
    if (!attempt) return [];
    return dispatchToTarget(attempt, { bypassDedupe: true });
  }, [dispatchToTarget]);

  const removeDispatch = useCallback((dispatchId) => {
    attemptsRef.current.delete(dispatchId);
    dispatch({ type: 'REMOVED', dispatchId });
  }, []);

  const value = useMemo(
    () => ({ dispatches: state.byId, dispatchToTarget, retry, removeDispatch }),
    [state.byId, dispatchToTarget, retry, removeDispatch]
  );

  return <DispatchContext.Provider value={value}>{children}</DispatchContext.Provider>;
}

export default DispatchProvider;
