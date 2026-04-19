export const initialFleetState = Object.freeze({
  byDevice: new Map(),
});

export function reduceFleet(state, action) {
  switch (action.type) {
    case 'RECEIVED': {
      const { deviceId, snapshot, reason, ts } = action;
      const prev = state.byDevice.get(deviceId) ?? {};
      const next = new Map(state.byDevice);
      next.set(deviceId, {
        snapshot: snapshot ?? prev.snapshot ?? null,
        reason: reason ?? 'change',
        lastSeenAt: ts ?? new Date().toISOString(),
        isStale: false,
        offline: reason === 'offline',
      });
      return { ...state, byDevice: next };
    }
    case 'STALE': {
      const next = new Map();
      for (const [id, entry] of state.byDevice.entries()) {
        next.set(id, { ...entry, isStale: true });
      }
      return { ...state, byDevice: next };
    }
    case 'RESET':
      return { ...state, byDevice: new Map() };
    default:
      return state;
  }
}

export default reduceFleet;
