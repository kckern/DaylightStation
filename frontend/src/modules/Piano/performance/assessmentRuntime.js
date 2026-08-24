import { useCallback, useSyncExternalStore } from 'react';
import {
  advanceAssessment,
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
export function createAssessmentRuntime({ attempt, createAttempt, subscribeMidi, now = () => performance.now(), tickMs = 50, snapshotMs = 50, onEvent, onTerminal } = {}) {
  const factory = createAttempt || (() => createAssessmentAttempt(attempt));
  let state = attempt?.expectation ? attempt : factory();
  let snapshot = state;
  let disposed = false;
  let midiDispose = null;
  let timer = null;
  let snapshotTimer = null;
  const listeners = new Set();
  const emitSnapshot = () => {
    if (snapshotTimer) globalThis.clearTimeout(snapshotTimer);
    snapshotTimer = null;
    if (snapshot === state) return;
    snapshot = state;
    listeners.forEach((listener) => listener());
  };
  const scheduleSnapshot = () => {
    if (!(snapshotMs > 0)) return emitSnapshot();
    if (!snapshotTimer) snapshotTimer = globalThis.setTimeout(emitSnapshot, snapshotMs);
  };
  const publish = (next, events = [], { immediate = false } = {}) => {
    const previous = state;
    const previousStatus = state.status;
    state = next.status === 'completed' && !next.result ? finalizeAssessmentAttempt(next) : next;
    for (const event of events.filter(Boolean)) onEvent?.(event, state);
    const terminal = previousStatus !== state.status && ['completed', 'aborted', 'timeout', 'error'].includes(state.status);
    if (state !== previous) (immediate || terminal ? emitSnapshot() : scheduleSnapshot());
    if (terminal) {
      disconnect();
      onTerminal?.(state.result, state);
    }
  };
  const observe = (event) => {
    if (disposed) return { attempt: state, event: { type: 'ignored', reason: 'disposed' }, events: [] };
    const result = observeAssessment(state, event);
    publish(result.attempt, result.events || [result.event]);
    return { ...result, attempt: state };
  };
  const tick = () => {
    if (state.status !== 'running') return;
    const result = advanceAssessment(state, now());
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
    // Imperative callers need the newest state for abort/timeout decisions.
    // React reads the separately published snapshot so high-rate MIDI input
    // cannot force one render per attack.
    getSnapshot: () => state,
    getStoreSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start(options = {}) {
      if (disposed) return state;
      publish(startAssessmentAttempt(state, { time: now(), ...options }), [], { immediate: true });
      if (state.status === 'running') connect();
      return state;
    },
    observe,
    tick,
    reset(options = {}) {
      disconnect();
      state = options.attempt || factory();
      emitSnapshot();
      return state;
    },
    terminate,
    timeout: () => terminate('timeout'),
    abort: () => terminate('aborted'),
    dispose() {
      disconnect();
      if (snapshotTimer) globalThis.clearTimeout(snapshotTimer);
      snapshotTimer = null;
      disposed = true;
      listeners.clear();
    },
  };
}

export function useAssessmentRuntime(runtime) {
  const snapshot = useSyncExternalStore(
    useCallback((listener) => runtime.subscribe(listener), [runtime]),
    runtime.getStoreSnapshot,
    runtime.getStoreSnapshot,
  );
  return { snapshot, start: runtime.start, reset: runtime.reset, abort: runtime.abort, timeout: runtime.timeout };
}

export default createAssessmentRuntime;
