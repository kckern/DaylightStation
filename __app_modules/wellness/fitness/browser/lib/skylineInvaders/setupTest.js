// The test sweep: before a defender plays with an aim gesture, they prove it
// works. Three steps, in order: take the cannon to the left edge, take it to
// the right edge, then fire (a step or a stomp on their mat). A step counts
// only when it is actually detected; one that is not detected within
// `timeoutMs` stops the test, and the defender can try that step again or
// choose a different method. Pure: the caller supplies the cannon's lane,
// whether the pose is lost, and the time.
import { GESTURES } from './gestures.js';
import { LANES } from './lanes.js';
import { INVADERS_TUNABLES } from './tunables.js';

/** The methods a defender can choose from: every aim gesture, then gamepad / keys aim (no test needed). */
export const MANUAL_METHOD = 'gamepad';
export const SETUP_METHODS = Object.freeze([...GESTURES, MANUAL_METHOD]);

export const SETUP_STEPS = Object.freeze([
  Object.freeze({ id: 'left', lane: 0, label: 'Go left', how: 'Move the cannon to the left edge.' }),
  Object.freeze({ id: 'right', lane: LANES - 1, label: 'Go right', how: 'Move the cannon to the right edge.' }),
  Object.freeze({ id: 'fire', lane: null, label: 'Stomp to fire', how: 'Stomp the mat.' }),
]);

const options = (over = {}) => ({
  holdMs: INVADERS_TUNABLES.setupHoldMs,
  timeoutMs: INVADERS_TUNABLES.setupStepTimeoutS * 1000,
  ...over,
});

/** A fresh test of one gesture, started at `at` (ms). */
export const createSetupTest = (gesture, at) => ({
  gesture, startedAt: at, step: 0, stepStartedAt: at, attempt: 1,
  status: 'running',            // running | timeout | passed
  onSince: null,                // when the cannon arrived on this step's edge lane
  away: false,                  // the cannon has been seen off this step's edge lane
  lane: null, lost: true,
  results: { left: null, right: null, fire: null },   // ms from the step opening to it being detected
  passedAt: null,
});

const nextStep = (test, at, result) => {
  const id = SETUP_STEPS[test.step].id;
  const step = test.step + 1;
  const done = step >= SETUP_STEPS.length;
  return {
    ...test, step: done ? test.step : step, stepStartedAt: at, onSince: null, away: false,
    results: { ...test.results, [id]: result },
    status: done ? 'passed' : 'running', passedAt: done ? at : null,
  };
};

/**
 * The test after the cannon is seen in `lane` at `at`. An edge step counts
 * once the cannon has ARRIVED on its edge lane (it must have been seen off it
 * during the step, so a cannon already parked there proves nothing) and
 * stayed `holdMs` with the defender in view. Any step not detected within
 * `timeoutMs` of opening stops the test with status `timeout`.
 */
export function advanceSetupTest(test, { lane, lost = false, at }, over) {
  if (!test || test.status !== 'running') return test;
  const { holdMs, timeoutMs } = options(over);
  const current = SETUP_STEPS[test.step];
  let next = { ...test, lane, lost };
  if (current.lane !== null) {
    const there = !lost && lane === current.lane;
    if (!there) next = { ...next, onSince: null, away: next.away || (!lost && lane !== null) };
    else if (next.away) {
      const onSince = next.onSince ?? at;
      next = { ...next, onSince };
      if (at - onSince >= holdMs) return nextStep(next, at, onSince - test.stepStartedAt);
    }
  }
  // A cannon resting on its edge when the clock runs out gets to finish its hold.
  if (at - test.stepStartedAt >= timeoutMs && next.onSince === null) return { ...next, status: 'timeout', onSince: null };
  return next;
}

/** The fire step: a step or stomp from the defender's mat (or fire on the keys). Ignored on any other step. */
export function fireSetupTest(test, at) {
  if (!test || test.status !== 'running' || SETUP_STEPS[test.step].id !== 'fire') return test;
  return nextStep(test, at, at - test.stepStartedAt);
}

/** Try the step that timed out again, from now. */
export function retrySetupTest(test, at) {
  if (!test || test.status !== 'timeout') return test;
  // Where the cannon was left counts: one that stopped short of the edge is already away from it.
  // A cannon already on the edge it is asked for starts its hold now.
  const edge = SETUP_STEPS[test.step].lane;
  const seen = edge !== null && !test.lost && test.lane !== null;
  const onEdge = seen && test.lane === edge;
  return { ...test, status: 'running', stepStartedAt: at, onSince: onEdge ? at : null, away: seen, attempt: test.attempt + 1 };
}

/** The current step's id (`left` | `right` | `fire`). */
export const setupStepId = (test) => SETUP_STEPS[test?.step ?? 0].id;

/** Each step as the screen draws it: done | now | failed | todo. */
export const setupStepsView = (test) => SETUP_STEPS.map((step, index) => ({
  id: step.id, label: step.label,
  state: test?.results?.[step.id] != null ? 'done'
    : index === test?.step ? (test.status === 'timeout' ? 'failed' : 'now') : 'todo',
}));

/** The two edge targets as the scene draws them (InvadersScene PracticeTargets). */
export const setupTargets = (test) => SETUP_STEPS.filter((step) => step.lane !== null).map((step) => ({
  id: step.id, lanes: [step.lane],
  lit: test?.status === 'running' && setupStepId(test) === step.id,
  reached: test?.results?.[step.id] != null,
}));

/** Seconds left on the step in hand. */
export const setupSecondsLeft = (test, at, over) => {
  if (!test || test.status !== 'running') return 0;
  const { timeoutMs } = options(over);
  return Math.max(0, Math.ceil((timeoutMs - (at - test.stepStartedAt)) / 1000));
};
