import { useCallback, useSyncExternalStore } from 'react';
import {
  advanceAssessmentAttempt,
  createAssessmentAttempt,
  finalizeAssessmentAttempt,
  observeAssessment,
  startAssessmentAttempt,
} from './assessmentAttempt.js';

/**
 * Imperative binding around the pure attempt state machine.
 *
 * The runtime owns subscriptions and clock ticks only. It deliberately has no
 * renderer, HTTP client, or persistence policy; surfaces decide what terminal
 * results are authorized to save.
 */
export function createAssessmentRuntime({ attempt, createAttempt, subscribeMidi, now = () => performance.now(), tickMs = 50, onEvent, onTerminal } = {}) {
  const factory = createAttempt || (() => createAssessmentAttempt(attempt));
  let state = attempt?.expectation ? attempt : factory();
  let disposed = false;
  let midiDispose = null;
  let timer = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((listener) => listener());
  const publish = (next, events = []) => {
    const previousStatus = state.status;
    state = next;
    for (const event of events.filter(Boolean)) onEvent?.(event, state);
    emit();
    if (previousStatus !== state.status && ['completed', 'aborted', 'timeout', 'error'].includes(state.status)) onTerminal?.(state.result, state);
  };
  const observe = (event) => {
    const result = observeAssessment(state, event);
    publish(result.attempt, [result.event]);
  };
  const tick = () => {
    if (state.status !== 'running') return;
    const result = advanceAssessmentAttempt(state, now());
    publish(result.attempt, result.events);
  };
  const connect = () => {
    if (!midiDispose && subscribeMidi) midiDispose = subscribeMidi(observe) || (() => {});
    if (!timer && tickMs > 0) timer = globalThis.setInterval(tick, tickMs);
  };
  const disconnect = () => {
    midiDispose?.();
    midiDispose = null;
    if (timer) globalThis.clearInterval(timer);
    timer = null;
  };

  const terminate = (status = 'aborted') => {
    if (state.status === 'prepared' || state.status === 'running') publish(finalizeAssessmentAttempt(state, { status }));
    disconnect();
    return state;
  };

  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start(options = {}) {
      if (disposed) return state;
      publish(startAssessmentAttempt(state, { time: now(), ...options }));
      connect();
      return state;
    },
    observe,
    tick,
    reset(options = {}) {
      disconnect();
      state = options.attempt || factory();
      emit();
      return state;
    },
    terminate,
    timeout: () => terminate('timeout'),
    abort: () => terminate('aborted'),
    dispose() { disconnect(); disposed = true; listeners.clear(); },
  };
}

export function useAssessmentRuntime(runtime) {
  const snapshot = useSyncExternalStore(
    useCallback((listener) => runtime.subscribe(listener), [runtime]),
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  return { snapshot, start: runtime.start, reset: runtime.reset, abort: runtime.abort, timeout: runtime.timeout };
}

export default createAssessmentRuntime;
