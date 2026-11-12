// Gathers everything measured during one spike step and reduces it to the
// numbers logged in `skyline_invaders.spike.step_end`. Pure: every timestamp is
// passed in (one monotonic clock, ms).

import { createPoseMeter, createFrameMeter } from './poseMetrics.js';
import { drillResult, intervalsOf, relayTiming } from './matMetrics.js';
import { LATCH_OFFSETS_MS } from './aim.js';
import { pct, round, stddev, summarize } from './stats.js';

const ARM_STATES = ['ok', 'missing', 'low_score', 'no_body', 'down'];

function armNumbers(samples, side) {
  const arms = samples.map((s) => s.aim?.arms?.[side]).filter(Boolean);
  const states = {};
  ARM_STATES.forEach((state) => { states[state] = pct(arms.filter((a) => a.state === state).length, samples.length); });
  return {
    okPct: states.ok,
    score: summarize(arms.map((a) => a.score), 2),
    angleDeg: summarize(arms.filter((a) => a.state === 'ok').map((a) => a.angleDeg), 1),
    lengthRatio: summarize(arms.map((a) => a.lengthRatio), 2),
    statePct: states,
  };
}

function lostEpisodes(samples, tStart) {
  let count = 0;
  let longest = 0;
  let firstLostAt = null;
  let openedAt = null;
  samples.forEach((s, i) => {
    const lost = !s.aim || s.aim.lost;
    if (lost && openedAt == null) {
      openedAt = s.t;
      count += 1;
      if (firstLostAt == null) firstLostAt = s.t - tStart;
    }
    if (openedAt != null && (!lost || i === samples.length - 1)) {
      longest = Math.max(longest, s.t - openedAt);
      if (!lost) openedAt = null;
    }
  });
  return { count, longestMs: round(longest, 0), firstLostAtMs: round(firstLostAt, 0) };
}

function latchNumbers(presses) {
  const out = { presses: presses.filter((p) => p.latch).length };
  ['x', 'xs'].forEach((key) => {
    const name = key === 'x' ? 'raw' : 'smoothed';
    const group = { throwAbs: {}, driftAfterAbs: {} };
    LATCH_OFFSETS_MS.forEach((d) => {
      group.throwAbs[d] = summarize(presses.map((p) => p.latch?.[key]?.throw?.[d]).filter((v) => v != null).map(Math.abs), 4);
      group.driftAfterAbs[d] = summarize(presses.map((p) => p.after?.[key]?.drift?.[d]).filter((v) => v != null).map(Math.abs), 4);
    });
    group.rangeBefore400 = summarize(presses.map((p) => p.latch?.[key]?.range400), 4);
    group.rangeAfter400 = summarize(presses.map((p) => p.after?.[key]?.range400), 4);
    out[name] = group;
  });
  out.sampleAgeMs = summarize(presses.map((p) => p.latch?.x?.sampleAgeMs), 0);
  out.aimLostAtPress = presses.filter((p) => p.aimLost).length;
  return out;
}

/**
 * @param {object} [options]
 * @param {number} [options.settleMs] aim statistics skip this long after start
 *   (time for the player to reach the asked position). Pose and mat numbers
 *   always cover the whole span.
 */
export function createStepCollector({ settleMs = 0 } = {}) {
  let tStart = 0;
  const poseMeter = createPoseMeter();
  const loadMeter = createFrameMeter();
  const samples = [];
  const presses = [];
  const otherMatPresses = [];
  const releases = [];
  let stomps = 0;
  let rearms = 0;

  return {
    start(t) { tStart = t; },
    get startedAt() { return tStart; },
    pose(sample) {
      poseMeter.add(sample.t, sample.latencyMs, sample.hasPose);
      samples.push(sample);
    },
    loadFrame(t) { loadMeter.add(t); },
    press(record, { activeMat = true } = {}) { (activeMat ? presses : otherMatPresses).push(record); },
    stomp() { stomps += 1; },
    release(record) { releases.push(record); },
    rearm() { rearms += 1; },
    get presses() { return presses; },
    get poseFrames() { return poseMeter.frames; },

    result(tEnd, { load = false, drill = false } = {}) {
      const spanMs = tEnd - tStart;
      const all = samples.filter((s) => s.t >= tStart && s.t <= tEnd);
      const settled = all.filter((s) => s.t >= tStart + settleMs);
      const found = settled.filter((s) => s.aim && !s.aim.lost);
      const xs = found.map((s) => s.aim.aimX);
      const rawXs = found.map((s) => s.aim.rawX);
      const smoothed = found.map((s) => s.xs).filter((v) => v != null);
      const posed = all.filter((s) => s.hasPose);
      const upKnown = settled.filter((s) => s.armsUp != null);
      const pressTimes = presses.map((p) => p.t);

      const numbers = {
        spanMs: round(spanMs, 0),
        pose: { ...poseMeter.result(tStart, tEnd), posePresentPct: pct(posed.length, all.length) },
        aim: {
          settleMs,
          samples: settled.length,
          lostPct: pct(settled.length - found.length, settled.length),
          aimX: summarize(xs, 4),
          // Jitter while the player holds still: sample sd of aimX, unfiltered
          // and after the hook smoother, plus peak-to-peak.
          sdRaw: round(stddev(xs), 4),
          sdSmoothed: round(stddev(smoothed), 4),
          peakToPeak: xs.length ? round(Math.max(...xs) - Math.min(...xs), 4) : null,
          rawXMin: rawXs.length ? round(Math.min(...rawXs), 3) : null,
          rawXMax: rawXs.length ? round(Math.max(...rawXs), 3) : null,
          clampedPct: pct(rawXs.filter((v) => v < 0 || v > 1).length, rawXs.length),
          bothArmsPct: pct(found.filter((s) => s.aim.usableArms === 2).length, settled.length),
          oneArmPct: pct(found.filter((s) => s.aim.usableArms === 1).length, settled.length),
          armsUpPct: pct(upKnown.filter((s) => s.armsUp).length, upKnown.length),
          lost: lostEpisodes(settled, tStart),
          left: armNumbers(settled, 'left'),
          right: armNumbers(settled, 'right'),
        },
        frame: {
          headPct: pct(all.filter((s) => s.frame?.head).length, all.length),
          leftWristPct: pct(all.filter((s) => s.frame?.leftWrist).length, all.length),
          rightWristPct: pct(all.filter((s) => s.frame?.rightWrist).length, all.length),
          shouldersPct: pct(all.filter((s) => s.frame?.shoulders).length, all.length),
          hipsPct: pct(all.filter((s) => s.frame?.hips).length, all.length),
          okPct: pct(all.filter((s) => s.frame?.ok).length, all.length),
        },
        // Relay timing and latch numbers only exist when there were presses.
        mat: {
          presses: presses.length,
          otherMatPresses: otherMatPresses.length,
          stomps,
          stompPct: pct(stomps, presses.length),
          releases: releases.length,
          rearms,
          perSec: spanMs > 0 ? round((presses.length * 1000) / spanMs, 2) : null,
          ...(presses.length ? {
            intervalMs: summarize(intervalsOf(pressTimes), 0),
            onMatMs: summarize(releases.map((r) => r.pressDurationMs), 0),
            relay: relayTiming(presses),
            latch: latchNumbers(presses),
          } : {}),
        },
      };
      if (load) numbers.load = loadMeter.result(tStart, tEnd);
      if (drill) numbers.mat.drill = drillResult(pressTimes, tStart, spanMs);
      return numbers;
    },
  };
}
