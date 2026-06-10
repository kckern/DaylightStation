export const initialDispatchState = Object.freeze({ byId: new Map() });

export function reduceDispatch(state, action) {
  switch (action.type) {
    case 'INITIATED': {
      const { dispatchId, deviceId, contentId, mode } = action;
      const next = new Map(state.byId);
      next.set(dispatchId, {
        dispatchId,
        deviceId,
        contentId,
        mode,
        status: 'running',
        steps: [],
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
      next.set(dispatchId, {
        ...prev,
        steps: [...prev.steps, { step, status, elapsedMs, error: error ?? null, ts: new Date().toISOString() }],
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
