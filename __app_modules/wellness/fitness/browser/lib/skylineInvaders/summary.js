// Reduces per-step numbers to the single `skyline_invaders.spike.summary`
// payload. Headline numbers are plain fields (queryable in the log store); the
// complete per-step numbers ride along as one JSON string.

import { MODEL_A, MODEL_B } from './spikeScript.js';
import { POSE_FPS_GATE } from './poseMetrics.js';

const poseOf = (n) => (n ? {
  fps: n.pose.fps,
  minWindowFps: n.pose.minWindowFps,
  latencyP50Ms: n.pose.latencyMs.p50,
  latencyP95Ms: n.pose.latencyMs.p95,
  intervalP95Ms: n.pose.intervalMs.p95,
  intervalMaxMs: n.pose.intervalMs.max,
  frames: n.pose.frames,
  meetsGate: n.pose.meetsGate,
  loadLoopFps: n.load?.fps ?? null,
} : null);

const holdOf = (n) => (n ? {
  mean: n.aim.aimX.mean,
  sdRaw: n.aim.sdRaw,
  sdSmoothed: n.aim.sdSmoothed,
  peakToPeak: n.aim.peakToPeak,
  lostPct: n.aim.lostPct,
  leftAngleDeg: n.aim.left.angleDeg.mean,
  rightAngleDeg: n.aim.right.angleDeg.mean,
  samples: n.aim.samples,
} : null);

function aimOf(get, subject) {
  const n = (suffix) => get(`t2.${subject}.${suffix}`);
  const sweep = n('sweep');
  const away = n('turn_away');
  const up = n('arms_low');
  const one = (suffix) => {
    const r = n(suffix);
    return r ? { lostPct: r.aim.lostPct, oneArmPct: r.aim.oneArmPct, bothArmsPct: r.aim.bothArmsPct, leftOkPct: r.aim.left.okPct, rightOkPct: r.aim.right.okPct } : null;
  };
  return {
    holdLeft: holdOf(n('hold_left')),
    holdCenter: holdOf(n('hold_center')),
    holdRight: holdOf(n('hold_right')),
    sweep: sweep ? {
      rawXMin: sweep.aim.rawXMin, rawXMax: sweep.aim.rawXMax, lostPct: sweep.aim.lostPct, clampedPct: sweep.aim.clampedPct,
      leftAngleMinDeg: sweep.aim.left.angleDeg.min, leftAngleMaxDeg: sweep.aim.left.angleDeg.max,
      rightAngleMinDeg: sweep.aim.right.angleDeg.min, rightAngleMaxDeg: sweep.aim.right.angleDeg.max,
      wristsInFramePct: Math.min(sweep.frame.leftWristPct ?? 0, sweep.frame.rightWristPct ?? 0),
    } : null,
    oneArmLeft: one('one_arm_left'),
    oneArmRight: one('one_arm_right'),
    armsUp: up ? { armsUpPct: up.aim.armsUpPct, lostPct: up.aim.lostPct, sdRaw: up.aim.sdRaw } : null,
    turnAway: away ? { lostPct: away.aim.lostPct, firstLostAtMs: away.aim.lost.firstLostAtMs, longestLostMs: away.aim.lost.longestMs } : null,
  };
}

const latchOf = (n) => (n?.mat?.latch ? {
  presses: n.mat.latch.presses,
  aimLostAtPress: n.mat.latch.aimLostAtPress,
  sampleAgeP50Ms: n.mat.latch.sampleAgeMs.p50,
  rawThrowAbsP50: Object.fromEntries(Object.entries(n.mat.latch.raw.throwAbs).map(([d, s]) => [`ms${d}`, s.p50])),
  rawThrowAbsP95: Object.fromEntries(Object.entries(n.mat.latch.raw.throwAbs).map(([d, s]) => [`ms${d}`, s.p95])),
  smoothedThrowAbsP50: Object.fromEntries(Object.entries(n.mat.latch.smoothed.throwAbs).map(([d, s]) => [`ms${d}`, s.p50])),
  smoothedThrowAbsP95: Object.fromEntries(Object.entries(n.mat.latch.smoothed.throwAbs).map(([d, s]) => [`ms${d}`, s.p95])),
  rawRangeBefore400P50: n.mat.latch.raw.rangeBefore400.p50,
  rawRangeBefore400P95: n.mat.latch.raw.rangeBefore400.p95,
  rawRangeAfter400P50: n.mat.latch.raw.rangeAfter400.p50,
  rawRangeAfter400P95: n.mat.latch.raw.rangeAfter400.p95,
} : null);

/**
 * @param {object} args
 * @param {object} args.session   identity and environment (sid, backend, ...)
 * @param {Array<{id: string}>} args.steps  the script
 * @param {Record<string, {numbers: object, attempts: number, outcome: string}>} args.results
 *   latest finished attempt per step id
 * @param {boolean} args.complete  true when the script reached the results step
 */
export function buildSummary({ session = {}, steps = [], results = {}, complete = false, extra = {} }) {
  const get = (id) => (results[id]?.outcome === 'end' ? results[id].numbers : null);
  const timedSteps = steps.filter((s) => s.kind === 'timed');
  const drill = get('t3.drill');
  const free = get('t3.free');
  // Relay numbers exist only on a step that recorded presses.
  const relaySource = [free, drill].find((r) => r?.mat?.relay) || null;
  return {
    ...session,
    complete,
    stepsMeasured: timedSteps.filter((s) => get(s.id)).length,
    stepsTotal: timedSteps.length,
    stepsMissing: timedSteps.filter((s) => !get(s.id)).map((s) => s.id).join(','),
    fpsGate: POSE_FPS_GATE,
    pose: {
      [MODEL_A]: { baseline: poseOf(get(`t1.${MODEL_A}.baseline`)), load: poseOf(get(`t1.${MODEL_A}.load`)) },
      [MODEL_B]: { baseline: poseOf(get(`t1.${MODEL_B}.baseline`)), load: poseOf(get(`t1.${MODEL_B}.load`)) },
    },
    aim: { adult: aimOf(get, 'adult'), kid: aimOf(get, 'kid') },
    mat: {
      // A step with zero presses has no interval/onMat numbers: every read is optional.
      drill: drill ? { ...drill.mat.drill, intervalMs: undefined, intervalP50Ms: drill.mat.drill?.intervalMs?.p50 ?? null, intervalP95Ms: drill.mat.drill?.intervalMs?.p95 ?? null, intervalMinMs: drill.mat.drill?.intervalMs?.min ?? null, stomps: drill.mat.stomps, rearms: drill.mat.rearms, onMatP50Ms: drill.mat.onMatMs?.p50 ?? null } : null,
      free: free ? { presses: free.mat.presses, perSec: free.mat.perSec, intervalP50Ms: free.mat.intervalMs?.p50 ?? null, intervalP95Ms: free.mat.intervalMs?.p95 ?? null, stomps: free.mat.stomps, rearms: free.mat.rearms, onMatP50Ms: free.mat.onMatMs?.p50 ?? null } : null,
      relay: relaySource ? {
        absoluteLatencyMs: null,
        note: relaySource.mat.relay.note,
        deliveryExcessP50Ms: relaySource.mat.relay.deliveryExcessMs.p50,
        deliveryExcessP95Ms: relaySource.mat.relay.deliveryExcessMs.p95,
        deliveryExcessMaxMs: relaySource.mat.relay.deliveryExcessMs.max,
        spacingErrorP95Ms: relaySource.mat.relay.spacingErrorMs.p95,
        backendToAppP50Ms: relaySource.mat.relay.backendToAppMs.p50,
        backendToAppP95Ms: relaySource.mat.relay.backendToAppMs.p95,
        deviceClockPresses: relaySource.mat.relay.deviceClockPresses,
        backendClockPresses: relaySource.mat.relay.backendClockPresses,
        from: relaySource === free ? 't3.free' : 't3.drill',
      } : null,
      latch: latchOf(free),
    },
    ...extra,
    stepOutcomes: Object.fromEntries(Object.entries(results).map(([id, r]) => [id.replace(/\./g, '_'), `${r.outcome}x${r.attempts}`])),
    detailJson: JSON.stringify(Object.fromEntries(Object.entries(results).map(([id, r]) => [id, r]))),
  };
}
