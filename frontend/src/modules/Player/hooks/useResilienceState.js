import { useEffect, useMemo, useReducer, useRef } from 'react';

export const RESILIENCE_STATUS = Object.freeze({
  startup: 'startup',
  idle: 'idle',
  playing: 'playing',
  paused: 'paused',
  stalling: 'stalling',
  recovering: 'recovering',
  exhausted: 'exhausted'
});

export const RESILIENCE_ACTIONS = Object.freeze({
  RESET: 'RESET',
  SET_STATUS: 'SET_STATUS'
});

const createInitialState = (initialStatus = RESILIENCE_STATUS.startup) => ({
  status: initialStatus
});

function reducer(state, action) {
  switch (action.type) {
    case RESILIENCE_ACTIONS.RESET: {
      const { nextStatus } = action.payload || {};
      return {
        ...state,
        status: nextStatus ?? RESILIENCE_STATUS.startup
      };
    }
    case RESILIENCE_ACTIONS.SET_STATUS: {
      const { status: nextStatus } = action.payload || {};
      if (!nextStatus) {
        return state;
      }
      return {
        ...state,
        status: nextStatus
      };
    }
    default:
      return state;
  }
}

export function useResilienceState(initialStatus = RESILIENCE_STATUS.startup) {
  const [state, dispatch] = useReducer(reducer, createInitialState(initialStatus));
  const statusRef = useRef(state.status);

  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);

  const actions = useMemo(() => ({
    reset: (payload) => dispatch({ type: RESILIENCE_ACTIONS.RESET, payload }),
    setStatus: (status, options) => dispatch({
      type: RESILIENCE_ACTIONS.SET_STATUS,
      payload: { ...(options || {}), status }
    })
  }), [dispatch]);

  return {
    state,
    status: state.status,
    statusRef,
    actions
  };
}
