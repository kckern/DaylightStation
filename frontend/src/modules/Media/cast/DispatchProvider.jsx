import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { wsService } from '../../../services/WebSocketService.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { reduceDispatch, initialDispatchState } from './dispatchReducer.js';
import { buildDispatchUrl } from './dispatchUrl.js';
import { useSessionController } from '../session/useSessionController.js';
import mediaLog from '../logging/mediaLog.js';

const DispatchContext = createContext(null);

function uuid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* ignore */ }
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isHomelineMsg(msg) {
  return !!msg && typeof msg.topic === 'string' && msg.topic.startsWith('homeline:');
}

export function DispatchProvider({ children }) {
  const [state, dispatch] = useReducer(reduceDispatch, initialDispatchState);
  const lastAttemptRef = useRef(null);
  const localController = useSessionController('local');
  const controllerRef = useRef(localController);
  useEffect(() => { controllerRef.current = localController; }, [localController]);

  useEffect(() => {
    const unsub = wsService.subscribe(isHomelineMsg, (msg) => {
      const { dispatchId, step, status, elapsedMs, error } = msg;
      if (typeof dispatchId !== 'string' || !dispatchId) return;
      if (!step || !status) return;
      dispatch({ type: 'STEP', dispatchId, step, status, elapsedMs, error });
    });
    return unsub;
  }, []);

  const dispatchToTarget = useCallback(async ({ targetIds, play, queue, mode, shader, volume, shuffle, snapshot }) => {
    if (!Array.isArray(targetIds) || targetIds.length === 0) return [];
    const isAdopt = mode === 'adopt';
    const contentId = play ?? queue ?? (isAdopt ? (snapshot?.currentItem?.contentId ?? 'adopt-snapshot') : null);
    const dispatchIds = [];
    lastAttemptRef.current = { targetIds, play, queue, mode, shader, volume, shuffle, snapshot };

    for (const deviceId of targetIds) {
      const dispatchId = uuid();
      dispatchIds.push(dispatchId);
      dispatch({ type: 'INITIATED', dispatchId, deviceId, contentId, mode: mode ?? 'transfer' });
      mediaLog.dispatchInitiated({ dispatchId, deviceId, contentId, mode });

      const httpPromise = isAdopt
        ? DaylightAPI(`api/v1/device/${deviceId}/load`, { dispatchId, snapshot, mode: 'adopt' }, 'POST')
        : DaylightAPI(buildDispatchUrl({ deviceId, play, queue, dispatchId, shader, volume, shuffle }));
      httpPromise
        .then((res) => {
          if (res?.ok) {
            dispatch({ type: 'SUCCEEDED', dispatchId, totalElapsedMs: res.totalElapsedMs ?? null });
            mediaLog.dispatchSucceeded({ dispatchId, totalElapsedMs: res.totalElapsedMs });
            if (mode === 'transfer') {
              try { controllerRef.current?.transport?.stop?.(); } catch { /* ignore */ }
            }
          } else {
            dispatch({
              type: 'FAILED', dispatchId,
              error: res?.error ?? 'unknown',
              failedStep: res?.failedStep ?? null,
            });
            mediaLog.dispatchFailed({ dispatchId, failedStep: res?.failedStep, error: res?.error });
          }
        })
        .catch((err) => {
          dispatch({ type: 'FAILED', dispatchId, error: err?.message ?? 'network-error', failedStep: null });
          mediaLog.dispatchFailed({ dispatchId, error: err?.message });
        });
    }
    return dispatchIds;
  }, []);

  const retryLast = useCallback(() => {
    if (!lastAttemptRef.current) return [];
    return dispatchToTarget(lastAttemptRef.current);
  }, [dispatchToTarget]);

  const value = useMemo(
    () => ({ dispatches: state.byId, dispatchToTarget, retryLast }),
    [state.byId, dispatchToTarget, retryLast]
  );

  return <DispatchContext.Provider value={value}>{children}</DispatchContext.Provider>;
}

export function useDispatch() {
  const ctx = useContext(DispatchContext);
  if (!ctx) throw new Error('useDispatch must be used inside DispatchProvider');
  return ctx;
}

export default DispatchProvider;
