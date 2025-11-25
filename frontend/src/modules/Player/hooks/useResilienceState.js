import { useEffect, useMemo, useReducer, useRef } from 'react';

export const RESILIENCE_STATUS = Object.freeze({
  startup: 'startup',
  idle: 'idle',
  playing: 'playing',
  paused: 'paused',
  stalling: 'stalling',
  recovering: 'recovering'
});

export const RESILIENCE_ACTIONS = Object.freeze({
  RESET: 'RESET',
  PROGRESS_TICK: 'PROGRESS_TICK',
  STALL_DETECTED: 'STALL_DETECTED',
  RECOVERY_TRIGGERED: 'RECOVERY_TRIGGERED',
  SET_STATUS: 'SET_STATUS'
});

const createInitialState = (initialStatus = RESILIENCE_STATUS.startup) => ({
  status: initialStatus,
  lastStallToken: null,
  recoveryGuardToken: null,
  recoveryAttempts: 0,
  carryRecovery: initialStatus === RESILIENCE_STATUS.recovering
});

function reducer(state, action) {
  switch (action.type) {
    case RESILIENCE_ACTIONS.RESET: {
      const {
        nextStatus,
        preserveAttempts = false,
        clearCarry = false
      } = action.payload || {};
      const carryRecovery = clearCarry ? false : state.carryRecovery;
      const resolvedStatus = nextStatus
        ?? (carryRecovery ? RESILIENCE_STATUS.recovering : RESILIENCE_STATUS.startup);
      return {
        ...state,
        status: resolvedStatus,
        lastStallToken: null,
        recoveryGuardToken: null,
        recoveryAttempts: preserveAttempts ? state.recoveryAttempts : 0,
        carryRecovery: resolvedStatus === RESILIENCE_STATUS.recovering ? carryRecovery : false
      };
    }
    case RESILIENCE_ACTIONS.PROGRESS_TICK: {
      const { nextStatus = RESILIENCE_STATUS.playing } = action.payload || {};
      return {
        ...state,
        status: nextStatus,
        lastStallToken: null,
        recoveryGuardToken: null,
        recoveryAttempts: 0,
        carryRecovery: false
      };
    }
    case RESILIENCE_ACTIONS.STALL_DETECTED: {
      const { stallToken = null } = action.payload || {};
      if (state.status === RESILIENCE_STATUS.recovering) {
        return state;
      }
      return {
        ...state,
        status: RESILIENCE_STATUS.stalling,
        lastStallToken: stallToken
      };
    }
    case RESILIENCE_ACTIONS.RECOVERY_TRIGGERED: {
      const { guardToken = null } = action.payload || {};
      return {
        ...state,
        status: RESILIENCE_STATUS.recovering,
        recoveryGuardToken: guardToken,
        recoveryAttempts: state.recoveryAttempts + 1,
        carryRecovery: true
      };
    }
    case RESILIENCE_ACTIONS.SET_STATUS: {
      const {
        status: nextStatus,
        clearStallToken = false,
        clearRecoveryGuard = false,
        resetAttempts = false,
        carryRecovery = undefined
      } = action.payload || {};
      if (!nextStatus) {
        return state;
      }
      const nextCarry = nextStatus === RESILIENCE_STATUS.recovering
        ? (typeof carryRecovery === 'boolean' ? carryRecovery : state.carryRecovery)
        : false;
      return {
        ...state,
        status: nextStatus,
        lastStallToken: clearStallToken ? null : state.lastStallToken,
        recoveryGuardToken: clearRecoveryGuard ? null : state.recoveryGuardToken,
        recoveryAttempts: resetAttempts ? 0 : state.recoveryAttempts,
        carryRecovery: nextCarry
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
    progressTick: (payload) => dispatch({ type: RESILIENCE_ACTIONS.PROGRESS_TICK, payload }),
    stallDetected: (payload) => dispatch({ type: RESILIENCE_ACTIONS.STALL_DETECTED, payload }),
    recoveryTriggered: (payload) => dispatch({ type: RESILIENCE_ACTIONS.RECOVERY_TRIGGERED, payload }),
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
