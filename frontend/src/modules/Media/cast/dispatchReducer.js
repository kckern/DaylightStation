// frontend/src/modules/Media/cast/dispatchReducer.js
// Dispatch entries live from INITIATED until the UI explicitly REMOVEs them.
// Crucially, an entry is NOT torn down the moment the HTTP load succeeds:
// the backend's playback watchdog reports a trailing `playback` step up to
// ~90s later, and that late STEP must land on the (still-present) entry so
// the tray can show honest post-cast confirmation. The old 3s auto-clear
// removed the row first, which silently dropped every `playback: timeout`.

export const initialDispatchState = Object.freeze({ byId: new Map() });

/**
 * Normalize the trailing playback-watchdog status into a resolution.
 * Backend emits 'confirmed' when playback.log matches the dispatched content
 * (WakeAndLoadService) and 'timeout' when it never does; 'done'/'ok' are
 * accepted as confirmation aliases. Unknown statuses resolve nothing.
 * @returns {'confirmed'|'timeout'|null}
 */
export function normalizePlaybackStatus(status) {
  if (status === 'timeout' || status === 'failed') return 'timeout';
  if (status === 'confirmed' || status === 'done' || status === 'ok') return 'confirmed';
  return null;
}

export function reduceDispatch(state, action) {
  switch (action.type) {
    case 'INITIATED': {
      const { dispatchId, deviceId, contentId, mode, title } = action;
      const next = new Map(state.byId);
      next.set(dispatchId, {
        dispatchId,
        deviceId,
        contentId,
        title: title ?? null,        // human content title for the tray
        mode,
        status: 'running',
        steps: [],
        playback: null,              // trailing watchdog: 'confirmed' | 'timeout' | null
        error: null,
        failedStep: null,
        totalElapsedMs: null,
        initiatedAt: new Date().toISOString(),
      });
      return { ...state, byId: next };
    }
    case 'STEP': {
      const { dispatchId, step, status, elapsedMs, error } = action;
      const prev = state.byId.get(dispatchId);
      if (!prev) return state;
      const next = new Map(state.byId);
      // A `playback` step is the watchdog resolving — it can (and usually
      // does) arrive AFTER the dispatch already SUCCEEDED. Record it as a
      // resolution field, not just a step append, so the tray can react.
      const resolution = step === 'playback' ? normalizePlaybackStatus(status) : null;
      next.set(dispatchId, {
        ...prev,
        steps: [...prev.steps, { step, status, elapsedMs, error: error ?? null, ts: new Date().toISOString() }],
        ...(resolution ? { playback: resolution } : {}),
      });
      return { ...state, byId: next };
    }
    case 'SUCCEEDED': {
      const { dispatchId, totalElapsedMs } = action;
      const prev = state.byId.get(dispatchId);
      if (!prev) return state;
      const next = new Map(state.byId);
      next.set(dispatchId, { ...prev, status: 'success', totalElapsedMs: totalElapsedMs ?? null });
      return { ...state, byId: next };
    }
    case 'FAILED': {
      const { dispatchId, error, failedStep } = action;
      const prev = state.byId.get(dispatchId);
      if (!prev) return state;
      const next = new Map(state.byId);
      next.set(dispatchId, { ...prev, status: 'failed', error: error ?? 'unknown', failedStep: failedStep ?? null });
      return { ...state, byId: next };
    }
    case 'REMOVED': {
      if (!state.byId.has(action.dispatchId)) return state;
      const next = new Map(state.byId);
      next.delete(action.dispatchId);
      return { ...state, byId: next };
    }
    default:
      return state;
  }
}

export default reduceDispatch;
