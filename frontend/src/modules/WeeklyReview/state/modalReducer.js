// Priority: higher = more blocking. A higher-priority modal cannot be displaced
// by an OPEN of a lower-priority one (the existing flag-based code relied on the
// keyboard handler's order; making it explicit here removes the foot-gun).
export const OVERLAY_PRIORITY = {
  preflightFailed: 100,
  disconnect:      90,
  finalizeError:   80,
  stopConfirm:     70,
  resumeDraft:     60,
};

export const initialModalState = { type: null, focusIndex: 0, payload: null };

export function modalReducer(state, action) {
  switch (action.type) {
    case 'OPEN': {
      const incoming = action.modal;
      const incomingPriority = OVERLAY_PRIORITY[incoming] ?? 0;
      const currentPriority = OVERLAY_PRIORITY[state.type] ?? 0;
      if (state.type && incomingPriority < currentPriority) return state;
      return {
        type: incoming,
        focusIndex: 0,
        payload: action.payload ?? null,
      };
    }
    case 'CLOSE':
      return initialModalState;
    case 'TOGGLE_FOCUS':
      return { ...state, focusIndex: state.focusIndex === 0 ? 1 : 0 };
    case 'SET_FOCUS':
      return { ...state, focusIndex: action.index };
    default:
      return state;
  }
}
