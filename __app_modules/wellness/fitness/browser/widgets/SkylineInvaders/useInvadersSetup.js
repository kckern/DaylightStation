import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MANUAL_METHOD, SETUP_METHODS, advanceSetupTest, createSetupTest, fireSetupTest, retrySetupTest, setupSecondsLeft, setupStepId,
} from '../../lib/skylineInvaders/setupTest.js';
import { INVADERS_TUNABLES } from '../../lib/skylineInvaders/tunables.js';

// The setup's moving parts, with no markup: which screen is up (`method`, the
// list of ways to aim, or `sweep`, the test of the one chosen), the method
// cursor, and the test sweep itself. The shell draws it (InvadersMenus
// `method` / `sweep`) and turns presses into `move`, `choose`, `fire`,
// `retry`, `other` and `close`.
//
// While the sweep runs the game's aim tracker plays the method under test, so
// the real cannon follows the defender; the test advances on what the tracker
// says, never on a press. Once all three steps pass, "It works!" stays up for
// `setupPassedMs` and then `onPassed(method)` hands the method back.

export { SETUP_METHODS };
const POLL_MS = 50;

/**
 * @param {object} options
 * @param {object} options.tracker          the game's aim tracker
 * @param {function} [options.onPassed]     (method) the method passed its test (or the gamepad was chosen)
 * @param {function} [options.onEvent]      (name, data) a step passed or timed out, a retry, a fire: for the log
 * @param {function} [options.onTick]       ({ at, sample, test }) every poll of a running sweep, for the trace recorder
 */
export default function useInvadersSetup({ tracker, onPassed, onEvent, onTick, tunables = INVADERS_TUNABLES } = {}) {
  const [state, setState] = useState({ open: false, from: null, stage: 'method', cursor: 0, test: null, lane: null, lost: true, leftS: 0 });
  const live = useRef({});
  live.current = { onPassed, onEvent, onTick, state };
  const testRef = useRef(null);
  const opts = { holdMs: tunables.setupHoldMs, timeoutMs: tunables.setupStepTimeoutS * 1000 };

  const setTest = useCallback((test, extra = {}) => {
    testRef.current = test;
    setState((prior) => ({ ...prior, test, ...extra }));
  }, []);

  /** Open on the method list, the cursor on the method the defender has now. */
  const open = useCallback((from, current = null) => {
    testRef.current = null;
    setState({ open: true, from, stage: 'method', cursor: Math.max(0, SETUP_METHODS.indexOf(current)), test: null, lane: null, lost: true, leftS: 0 });
  }, []);
  const close = useCallback(() => {
    testRef.current = null;
    setState((prior) => ({ ...prior, open: false, test: null }));
  }, []);
  const move = useCallback((delta) => setState((prior) => ({ ...prior, cursor: (prior.cursor + delta + SETUP_METHODS.length) % SETUP_METHODS.length })), []);

  /** Choose a method (or the one under the cursor). A gesture goes to its test; the gamepad needs none. */
  const choose = useCallback((method = SETUP_METHODS[live.current.state.cursor]) => {
    if (!SETUP_METHODS.includes(method)) return;
    if (method === MANUAL_METHOD) { live.current.onPassed?.(method); return; }
    tracker.setManual?.(false);
    tracker.setGesture(method);
    // Every test starts with the cannon in the middle: going left and going right are both a move.
    tracker.setAim(0.5);
    const test = createSetupTest(method, Date.now());
    testRef.current = test;
    setState((prior) => ({ ...prior, stage: 'sweep', cursor: SETUP_METHODS.indexOf(method), test, lane: tracker.sample().lane, lost: tracker.sample().lost, leftS: tunables.setupStepTimeoutS }));
  }, [tracker, tunables.setupStepTimeoutS]);

  /** Back to the method list from the sweep. */
  const other = useCallback(() => {
    testRef.current = null;
    setState((prior) => ({ ...prior, stage: 'method', test: null }));
  }, []);

  /** A step or stomp on the defender's mat, or fire on the keys: the fire step's test. */
  const fire = useCallback((source) => {
    const test = testRef.current;
    if (!test || test.status !== 'running' || setupStepId(test) !== 'fire') return false;
    const at = Date.now();
    const next = fireSetupTest(test, at);
    live.current.onEvent?.('step', { method: test.gesture, step: 'fire', result: 'passed', ms: next.results.fire, attempt: test.attempt, source });
    setTest(next);
    return true;
  }, [setTest]);

  const retry = useCallback(() => {
    const test = testRef.current;
    if (!test || test.status !== 'timeout') return;
    live.current.onEvent?.('retry', { method: test.gesture, step: setupStepId(test), attempt: test.attempt + 1 });
    setTest(retrySetupTest(test, Date.now()), { leftS: tunables.setupStepTimeoutS });
  }, [setTest, tunables.setupStepTimeoutS]);

  // The sweep runs on what the tracker says.
  const running = state.open && state.stage === 'sweep' && state.test?.status === 'running';
  const runKey = running ? `${state.test.gesture}:${state.test.attempt}` : null;
  useEffect(() => {
    if (!runKey) return undefined;
    const timer = setInterval(() => {
      const prior = testRef.current;
      if (!prior || prior.status !== 'running') return;
      const at = Date.now();
      const sample = tracker.sample();
      const lost = sample.lost || sample.mode !== 'pose';
      const next = advanceSetupTest(prior, { lane: sample.lane, lost, at }, opts);
      live.current.onTick?.({ at, sample, test: next });
      if (next.step !== prior.step || (next.status === 'passed' && prior.status !== 'passed')) {
        const id = setupStepId(prior);
        live.current.onEvent?.('step', { method: prior.gesture, step: id, result: 'passed', ms: next.results[id], attempt: prior.attempt });
      }
      if (next.status === 'timeout') {
        live.current.onEvent?.('step', { method: prior.gesture, step: setupStepId(prior), result: 'timeout', ms: at - prior.stepStartedAt, attempt: prior.attempt, lost, lane: sample.lane });
      }
      testRef.current = next;
      const leftS = setupSecondsLeft(next, at, opts);
      setState((view) => (view.test === prior && view.lane === sample.lane && view.lost === lost && view.leftS === leftS && next === prior
        ? view : { ...view, test: next, lane: sample.lane, lost, leftS }));
    }, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, tracker]);

  // Passed: "It works!" for a moment, then the method goes back to the shell.
  const passedKey = state.open && state.test?.status === 'passed' ? `${state.test.gesture}:${state.test.passedAt}` : null;
  useEffect(() => {
    if (!passedKey) return undefined;
    const method = testRef.current?.gesture;
    const timer = setTimeout(() => live.current.onPassed?.(method), tunables.setupPassedMs);
    return () => clearTimeout(timer);
  }, [passedKey, tunables.setupPassedMs]);

  return {
    open: state.open, from: state.from, stage: state.stage, cursor: state.cursor,
    method: state.stage === 'sweep' ? state.test?.gesture || null : SETUP_METHODS[state.cursor],
    test: state.test, lane: state.lane, lost: state.lost, leftS: state.leftS,
    status: state.test?.status || null,
    actions: { open, close, move, choose, other, fire, retry },
  };
}
