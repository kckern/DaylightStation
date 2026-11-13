// The controls intro's practice task: the same three targets for every
// gesture (the left edge lane, the middle pair, the right edge lane), so the
// time a child takes to reach each one compares the gestures directly. Pure:
// the caller supplies the cannon's lane and the time.
import { LANES } from './lanes.js';
import { INVADERS_TUNABLES } from './tunables.js';

export const TRYOUT_TARGETS = Object.freeze([
  Object.freeze({ id: 'left', lanes: Object.freeze([0]) }),
  Object.freeze({ id: 'centre', lanes: Object.freeze([LANES / 2 - 1, LANES / 2]) }),
  Object.freeze({ id: 'right', lanes: Object.freeze([LANES - 1]) }),
]);

/** A fresh tryout of one gesture, started at `at` (ms). */
export const createTryout = (gesture, at) => ({ gesture, startedAt: at, lane: null, laneChanges: 0, on: null, onSince: null, reached: {}, visits: {} });

/**
 * The tryout after the cannon is seen in `lane` at `at`. A target lights
 * while the cannon stands under it and counts as reached once it has stayed
 * for `holdMs`; `reached[id]` is how long after the card opened the cannon
 * ARRIVED on the visit that held (so the hold itself is not counted).
 * `visits[id]` counts arrivals: more visits than one before a target is
 * reached means the aim passed through without settling.
 *
 * A target only counts when the cannon ARRIVES on it. The cannon usually
 * starts a card in the middle, and standing there is not reaching the centre
 * target: it has to leave and come back.
 */
export function advanceTryout(tryout, lane, at, { holdMs = INVADERS_TUNABLES.tryoutTargetHoldMs } = {}) {
  const target = TRYOUT_TARGETS.find((item) => item.lanes.includes(lane)) || null;
  const next = { ...tryout, lane };
  if (tryout.lane !== null && lane !== tryout.lane) next.laneChanges = tryout.laneChanges + 1;
  const id = target?.id ?? null;
  // The first sample only records where the cannon started.
  if (tryout.lane === null) return { ...next, on: id, onSince: null };
  if (id !== tryout.on) {
    next.on = id;
    next.onSince = id ? at : null;
    if (id) next.visits = { ...tryout.visits, [id]: (tryout.visits[id] || 0) + 1 };
  }
  if (id && next.onSince !== null && next.reached[id] === undefined && at - next.onSince >= holdMs) {
    next.reached = { ...next.reached, [id]: next.onSince - tryout.startedAt };
  }
  return next;
}

/** The practice targets as the scene draws them. */
export const tryoutTargets = (tryout) => TRYOUT_TARGETS.map((target) => ({
  id: target.id, lanes: target.lanes, lit: tryout?.on === target.id, reached: tryout?.reached?.[target.id] !== undefined,
}));

/** What a card's tryout came to, for the log. Times are ms from the card opening; null = never reached. */
export function tryoutSummary(tryout, at, how) {
  const targets = Object.fromEntries(TRYOUT_TARGETS.map((target) => [target.id, tryout.reached[target.id] ?? null]));
  return {
    gesture: tryout.gesture, how, ms: Math.max(0, Math.round(at - tryout.startedAt)),
    reached: Object.values(targets).filter((value) => value !== null).length,
    leftMs: targets.left, centreMs: targets.centre, rightMs: targets.right,
    visits: { ...tryout.visits }, laneChanges: tryout.laneChanges,
  };
}
