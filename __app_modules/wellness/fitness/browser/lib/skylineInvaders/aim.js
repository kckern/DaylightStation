// Skyline Invaders aim signal: BlazePose arms -> horizontal cannon position.
// Pure and React-free so the Phase 0 spike and the game's useInvadersAim share
// one mapping.
//
// Conventions
// - Keypoints are in camera-image pixels with y down and NO horizontal flip
//   (PoseDetectorService runs `flipHorizontal: false`).
// - "left"/"right" arm are the player's own left/right (BlazePose anatomical
//   naming).
// - aimX is in SCREEN space as a mirror: 0 = screen left, 1 = screen right. A
//   player pointing to their own right moves the cannon to the right.
// - Aim is the wrist's HORIZONTAL offset from the body's midline (midpoint of
//   the shoulders), in shoulder widths. Height does not matter: the camera is
//   2-D, so an arm reaching toward the screen projects onto the shoulder and
//   reads as center; reaching out to the side reads as that side. Nobody has
//   to raise their arms above their head. `reach` shoulder widths from the
//   midline maps to the screen edge (both hands together, reaching to one side).
// - An arm's angle (0 deg = up, +90 = toward screen right, +/-180 = down) is
//   still computed for the trace, but it does not drive aim.

import { round } from './stats.js';

export const KP = Object.freeze({
  nose: 0, leftEye: 2, rightEye: 5,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
});

export const DEFAULT_AIM_CONFIG = Object.freeze({
  // Shoulder and wrist must both score at least this for the arm to count.
  // Loss is judged by score, never by keypoint presence.
  minScore: 0.4,
  // Wrist offset from the midline, in shoulder widths, that maps to the screen
  // edge. Lobby calibration replaces this per player.
  // Hands together reaching to one side sit ~1.5 widths out.
  reach: 1.5,
  // A wrist this many shoulder widths below its shoulder is hanging, not
  // pointing; the other arm aims alone.
  downRatio: 1.1,
});

const usable = (kp) => !!kp && Number.isFinite(kp.x) && Number.isFinite(kp.y);
const scoreOf = (kp) => (usable(kp) && Number.isFinite(kp.score) ? kp.score : 0);

/** Mirrored angle from vertical of the shoulder->wrist vector, in degrees. */
export function armAngleDeg(shoulder, wrist) {
  return (Math.atan2(-(wrist.x - shoulder.x), -(wrist.y - shoulder.y)) * 180) / Math.PI;
}

/**
 * Mirrored screen position for a wrist: 0.5 at the body midline, 0/1 when the
 * wrist is `reach` shoulder widths out. Image x is not flipped, so a wrist at
 * smaller image x (the player's right) moves the cannon to screen right.
 */
export function offsetToAimX(wristX, midX, shoulderWidth, config = DEFAULT_AIM_CONFIG) {
  return 0.5 + (midX - wristX) / (2 * config.reach * shoulderWidth);
}

/**
 * One arm. state: 'ok' | 'missing' | 'low_score' | 'no_body' | 'down'.
 * score is min(shoulder, wrist); angleDeg/lengthRatio/x are reported whenever
 * the geometry exists, even when the arm is not usable, so traces stay complete.
 */
export function readArm(shoulder, wrist, body, config = DEFAULT_AIM_CONFIG) {
  if (!usable(shoulder) || !usable(wrist)) return { state: 'missing', score: 0, angleDeg: null, lengthRatio: null, x: null };
  const score = Math.min(scoreOf(shoulder), scoreOf(wrist));
  const angleDeg = armAngleDeg(shoulder, wrist);
  const sw = body?.shoulderWidth || 0;
  const length = Math.hypot(wrist.x - shoulder.x, wrist.y - shoulder.y);
  const lengthRatio = sw > 0 ? length / sw : null;
  const x = sw > 0 ? offsetToAimX(wrist.x, body.midX, sw, config) : null;
  let state = 'ok';
  if (score < config.minScore) state = 'low_score';
  else if (!(sw > 0)) state = 'no_body';
  else if ((wrist.y - shoulder.y) / sw > config.downRatio) state = 'down';
  return { state, score, angleDeg, lengthRatio, x };
}

/**
 * Aim for one pose.
 * @returns {{ aimX: number|null, rawX: number|null, lost: boolean, usableArms: number,
 *   weight: number, arms: { left: object, right: object } }}
 *   aimX is clamped to 0..1; rawX is the unclamped weighted mean. Both null when lost.
 */
export function computeAim(pose, config = DEFAULT_AIM_CONFIG) {
  const k = pose?.keypoints || [];
  const ls = k[KP.leftShoulder];
  const rs = k[KP.rightShoulder];
  const bothShoulders = usable(ls) && usable(rs) && scoreOf(ls) >= config.minScore && scoreOf(rs) >= config.minScore;
  const body = bothShoulders
    ? { shoulderWidth: Math.hypot(ls.x - rs.x, ls.y - rs.y), midX: (ls.x + rs.x) / 2 }
    : null;
  const arms = {
    left: readArm(ls, k[KP.leftWrist], body, config),
    right: readArm(rs, k[KP.rightWrist], body, config),
  };
  const ok = [arms.left, arms.right].filter((arm) => arm.state === 'ok');
  const weight = ok.reduce((acc, arm) => acc + arm.score, 0);
  if (!ok.length || weight <= 0) return { aimX: null, rawX: null, lost: true, usableArms: 0, weight: 0, arms };
  const rawX = ok.reduce((acc, arm) => acc + arm.x * arm.score, 0) / weight;
  return { aimX: Math.min(1, Math.max(0, rawX)), rawX, lost: false, usableArms: ok.length, weight, arms };
}

const headTopY = (k, minScore) => {
  const nose = k[KP.nose];
  const ls = k[KP.leftShoulder];
  const rs = k[KP.rightShoulder];
  if (scoreOf(nose) < minScore || scoreOf(ls) < minScore || scoreOf(rs) < minScore) return null;
  // Roughly the crown: a quarter of the nose->shoulder drop above the nose.
  return nose.y - 0.25 * Math.abs((ls.y + rs.y) / 2 - nose.y);
};

/** Both wrists above the head. null when the pose cannot say. */
export function wristsAboveHead(pose, minScore = DEFAULT_AIM_CONFIG.minScore) {
  const k = pose?.keypoints || [];
  const top = headTopY(k, minScore);
  const lw = k[KP.leftWrist];
  const rw = k[KP.rightWrist];
  if (top == null || scoreOf(lw) < minScore || scoreOf(rw) < minScore) return null;
  return lw.y < top && rw.y < top;
}

/** Both wrists above their shoulders (the arms-up bonus posture). null when unknown. */
export function wristsAboveShoulders(pose, minScore = DEFAULT_AIM_CONFIG.minScore) {
  const k = pose?.keypoints || [];
  const pairs = [[k[KP.leftShoulder], k[KP.leftWrist]], [k[KP.rightShoulder], k[KP.rightWrist]]];
  if (pairs.some(([s, w]) => scoreOf(s) < minScore || scoreOf(w) < minScore)) return null;
  return pairs.every(([s, w]) => w.y < s.y);
}

/**
 * Frame-rate independent exponential smoother. A lost sample (null) holds the
 * last value; `reset()` forgets it.
 */
export function createAimSmoother({ tauMs = 120 } = {}) {
  let value = null;
  let lastT = null;
  return {
    push(x, tMs) {
      if (x == null) return value;
      if (value == null || lastT == null) value = x;
      else value += (1 - Math.exp(-Math.max(0, tMs - lastT) / tauMs)) * (x - value);
      lastT = tMs;
      return value;
    },
    reset() { value = null; lastT = null; },
    get value() { return value; },
  };
}

/**
 * Short aim history for the fire latch. Samples are { t, x, xs, lost } where x
 * is the unfiltered aimX and xs the smoothed one. A lost sample carries the
 * last known values so lookups never return a hole mid-press.
 */
export function createAimHistory({ horizonMs = 3000 } = {}) {
  const samples = [];
  return {
    push(sample) {
      samples.push(sample);
      while (samples.length && sample.t - samples[0].t > horizonMs) samples.shift();
    },
    /** Latest sample at or before t, or null. */
    at(t) {
      for (let i = samples.length - 1; i >= 0; i -= 1) if (samples[i].t <= t) return samples[i];
      return null;
    },
    /** Samples with t0 <= t <= t1. */
    between(t0, t1) { return samples.filter((s) => s.t >= t0 && s.t <= t1); },
    get length() { return samples.length; },
    clear() { samples.length = 0; },
  };
}

export const LATCH_OFFSETS_MS = Object.freeze([100, 200, 300, 400]);

const span = (list, key) => {
  const values = list.map((s) => s[key]).filter((v) => v != null);
  return values.length ? Math.max(...values) - Math.min(...values) : null;
};

/**
 * What the aim was doing around a press received at tPress (same clock as the
 * history). For `key` 'x' (unfiltered) or 'xs' (smoothed):
 * - atPress: aim at the press; before[d]: aim d ms earlier;
 * - throw[d] = atPress - before[d] (signed, in aimX units, + = toward screen right);
 * - range400: max - min over the 400 ms before the press;
 * - sampleAgeMs: how old the newest pose sample was at the press.
 */
export function latchBefore(history, tPress, key = 'x', offsets = LATCH_OFFSETS_MS) {
  const now = history.at(tPress);
  const atPress = now ? now[key] ?? null : null;
  const before = {};
  const thrown = {};
  offsets.forEach((d) => {
    const s = history.at(tPress - d);
    const v = s ? s[key] ?? null : null;
    before[d] = round(v, 4);
    thrown[d] = atPress != null && v != null ? round(atPress - v, 4) : null;
  });
  const window = history.between(tPress - Math.max(...offsets), tPress);
  return {
    atPress: round(atPress, 4),
    before,
    throw: thrown,
    range400: round(span(window, key), 4),
    samples: window.length,
    lostSamples: window.filter((s) => s.lost).length,
    sampleAgeMs: now ? round(tPress - now.t, 1) : null,
  };
}

/**
 * Aim after the press: drift[d] = aim(tPress + d) - aim(tPress), plus the range
 * over what has elapsed. Offsets not yet reached at tNow are null rather than
 * filled from an earlier sample.
 */
export function latchAfter(history, tPress, tNow = Infinity, key = 'x', offsets = LATCH_OFFSETS_MS) {
  const base = history.at(tPress);
  const atPress = base ? base[key] ?? null : null;
  const drift = {};
  offsets.forEach((d) => {
    const s = tNow >= tPress + d ? history.at(tPress + d) : null;
    const v = s ? s[key] ?? null : null;
    drift[d] = atPress != null && v != null ? round(v - atPress, 4) : null;
  });
  const end = Math.min(tNow, tPress + Math.max(...offsets));
  return { drift, range400: round(span(history.between(tPress, end), key), 4), observedMs: round(end - tPress, 0) };
}
