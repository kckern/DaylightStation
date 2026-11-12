// Skyline Invaders aim signal: BlazePose arms -> horizontal cannon position.
// Pure and React-free so the Phase 0 spike and the game's useInvadersAim share
// one mapping.
//
// Aim is measured in the PLAYER'S OWN BODY FRAME, never the camera's. The
// reference is the torso: the shoulder line. Hands in front of the chest at any
// height = center; hands out to the player's left/right at any height =
// left/right. Height never matters and nobody has to raise their arms overhead.
// Where the player stands, how big they appear, a tilted shoulder line and a
// modest torso turn do not move the cannon.
//
// How
// - offset = the wrist's displacement from the shoulder midpoint, projected onto
//   the shoulder line (unit vector right shoulder -> left shoulder), divided by
//   the shoulder width. Signed so + = the player's right = SCREEN right (the
//   screen is a mirror). `reach` shoulder widths maps to the screen edge, or a
//   per-player `calibration` { left, right } (in the same units) replaces it.
// - Frame '3d' (normal): the projection is done on BlazePose's metric world
//   landmarks (`pose.keypoints3D`: metres, camera-aligned axes, x image-right,
//   y down, z depth). In 3-D the shoulder line turns WITH the torso and its
//   length is not foreshortened, so a torso turn cancels out. When the player
//   is square to the camera the result uses x/y only; wrist depth error enters
//   in proportion to sin(turn) (5 cm of depth error at 25 deg ~ 0.02 of screen).
// - Frame '2d' (fallback, when a pose carries no usable keypoints3D): the same
//   projection on image pixels. Tilt, position and size still cancel; a torso
//   turn does NOT (a 25 deg turn moves a forward reach ~0.2 of the screen),
//   because the image has no depth to undo it with.
// - A wrist well below its own shoulder (`downRatio` shoulder widths, measured
//   perpendicular to the shoulder line) is hanging, not pointing: the other arm
//   aims alone. "Below" is the camera's down, so a camera pitched steeply up or
//   down shifts that threshold a little; it never shifts the aim itself.
//
// Conventions
// - Keypoints are in camera-image pixels with y down and NO horizontal flip
//   (PoseDetectorService runs `flipHorizontal: false`).
// - "left"/"right" arm are the player's own left/right (BlazePose anatomical
//   naming). The player's left side is at larger image x.
// - aimX is in SCREEN space: 0 = screen left, 1 = screen right.
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
  // Offset from the midline, in shoulder widths, that maps to the screen edge
  // when there is no calibration. Hands together reaching to one side sit ~1.5
  // widths out.
  reach: 1.5,
  // Per-player range from the lobby: { left, right } offsets (shoulder widths,
  // + = screen right) that map to the screen's left and right edges.
  calibration: null,
  // A wrist this many shoulder widths below its shoulder is hanging, not
  // pointing; the other arm aims alone.
  downRatio: 1.1,
  // Measure in the 3-D torso frame when the pose carries keypoints3D. Off =
  // always the 2-D fallback (no torso-turn compensation).
  use3D: true,
});

/** A calibration narrower than this many shoulder widths is a failed capture. */
export const MIN_CALIBRATION_SPAN = 1;

const DEG = 180 / Math.PI;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const usable = (kp) => !!kp && Number.isFinite(kp.x) && Number.isFinite(kp.y);
const usable3 = (kp) => usable(kp) && Number.isFinite(kp.z);
const scoreOf = (kp) => (usable(kp) && Number.isFinite(kp.score) ? kp.score : 0);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Mirrored angle from vertical of the shoulder->wrist vector, in degrees. */
export function armAngleDeg(shoulder, wrist) {
  return Math.atan2(-(wrist.x - shoulder.x), -(wrist.y - shoulder.y)) * DEG;
}

/**
 * Screen position for an offset in shoulder widths (+ = screen right): 0.5 at
 * the body midline and 0/1 at `reach`, or 0/1 at the calibrated far reaches.
 * Not clamped.
 */
export function offsetToAimX(offset, config = DEFAULT_AIM_CONFIG) {
  const { calibration } = config;
  if (calibration && calibration.right > calibration.left) return (offset - calibration.left) / (calibration.right - calibration.left);
  const reach = config.reach ?? DEFAULT_AIM_CONFIG.reach;
  return 0.5 + offset / (2 * reach);
}

/**
 * Lobby calibration from two held reaches (each a computeAim result, or any
 * { offset }). Order-proof. null when either is missing or they are less than
 * MIN_CALIBRATION_SPAN shoulder widths apart.
 */
export function calibrationFromSamples(a, b) {
  if (!Number.isFinite(a?.offset) || !Number.isFinite(b?.offset)) return null;
  const left = Math.min(a.offset, b.offset);
  const right = Math.max(a.offset, b.offset);
  return right - left >= MIN_CALIBRATION_SPAN ? { left, right } : null;
}

/**
 * The torso frame for a pose, or null without both shoulders.
 * @returns {null|{ frame: '3d'|'2d', points: object[], shoulderWidth: number, mid: object,
 *   along: object, down: object|null, yawDeg: number|null, tiltDeg: number }}
 *   `along` is the unit vector right shoulder -> left shoulder (toward the
 *   player's left); `down` is the camera's down made perpendicular to it;
 *   `points` are the keypoints in the frame's own space, by BlazePose index.
 */
export function torsoFrame(pose, config = DEFAULT_AIM_CONFIG) {
  const k2 = pose?.keypoints || [];
  const k3 = pose?.keypoints3D || [];
  const minScore = config.minScore ?? DEFAULT_AIM_CONFIG.minScore;
  if (scoreOf(k2[KP.leftShoulder]) < minScore || scoreOf(k2[KP.rightShoulder]) < minScore) return null;
  const is3D = config.use3D !== false && usable3(k3[KP.leftShoulder]) && usable3(k3[KP.rightShoulder])
    && Math.hypot(k3[KP.leftShoulder].x - k3[KP.rightShoulder].x, k3[KP.leftShoulder].y - k3[KP.rightShoulder].y, k3[KP.leftShoulder].z - k3[KP.rightShoulder].z) > 1e-6;
  const points = is3D ? k3 : k2;
  const ls = points[KP.leftShoulder];
  const rs = points[KP.rightShoulder];
  const line = sub(ls, rs);
  const shoulderWidth = Math.hypot(line.x, line.y, line.z);
  if (!(shoulderWidth > 0)) return null;
  const along = { x: line.x / shoulderWidth, y: line.y / shoulderWidth, z: line.z / shoulderWidth };
  // Camera down with its component along the shoulder line removed.
  const perp = { x: -along.y * along.x, y: 1 - along.y * along.y, z: -along.y * along.z };
  const perpLength = Math.hypot(perp.x, perp.y, perp.z);
  const down = perpLength > 1e-6 ? { x: perp.x / perpLength, y: perp.y / perpLength, z: perp.z / perpLength } : null;
  return {
    frame: is3D ? '3d' : '2d',
    points,
    shoulderWidth,
    mid: { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: ((ls.z || 0) + (rs.z || 0)) / 2 },
    along,
    down,
    // Turn about the vertical: 0 = square to the camera. The sign follows
    // keypoints3D z and is for the trace only; aim never uses it.
    yawDeg: is3D ? Math.atan2(line.z, line.x) * DEG : null,
    tiltDeg: Math.atan2(line.y, Math.hypot(line.x, line.z)) * DEG,
  };
}

const NO_ARM = Object.freeze({ state: 'missing', score: 0, angleDeg: null, lengthRatio: null, offset: null, drop: null, x: null });

/**
 * One arm. state: 'ok' | 'missing' | 'low_score' | 'no_body' | 'down'.
 * `shoulder` and `wrist` are points in the space of `body` (a torsoFrame);
 * `score` is min(shoulder, wrist) and may be passed when the points carry none.
 * offset (shoulder widths from the midline, + = screen right), drop (shoulder
 * widths below the own shoulder), angleDeg, lengthRatio and x are reported
 * whenever the geometry exists, even when the arm is not usable, so traces stay
 * complete.
 */
export function readArm(shoulder, wrist, body, config = DEFAULT_AIM_CONFIG, score = Math.min(scoreOf(shoulder), scoreOf(wrist))) {
  if (!usable(shoulder) || !usable(wrist)) return { ...NO_ARM };
  const angleDeg = armAngleDeg(shoulder, wrist);
  const sw = body?.shoulderWidth || 0;
  const hasBody = sw > 0 && !!body.down;
  const arm = sub(wrist, shoulder);
  const lengthRatio = sw > 0 ? Math.hypot(arm.x, arm.y, arm.z) / sw : null;
  // `along` points to the player's left, which is screen left: negate.
  const offset = hasBody ? -dot(sub(wrist, body.mid), body.along) / sw : null;
  const drop = hasBody ? dot(arm, body.down) / sw : null;
  const x = hasBody ? offsetToAimX(offset, config) : null;
  let state = 'ok';
  if (score < config.minScore) state = 'low_score';
  else if (!hasBody) state = 'no_body';
  else if (drop > config.downRatio) state = 'down';
  return { state, score, angleDeg, lengthRatio, offset, drop, x };
}

/**
 * Aim for one pose.
 * @returns {{ aimX: number|null, rawX: number|null, offset: number|null, lost: boolean,
 *   usableArms: number, weight: number, score: number, perArm: (number|null)[], armsUp: boolean,
 *   frame: '3d'|'2d'|null, yawDeg: number|null, tiltDeg: number|null,
 *   arms: { left: object, right: object } }}
 *   aimX is clamped to 0..1; rawX is the unclamped score-weighted mean; offset
 *   is the same mean in shoulder widths before reach/calibration (what lobby
 *   calibration captures). All three null when lost. perArm is
 *   [player's left arm, player's right arm] as clamped aimX, null for an arm
 *   that is not usable. armsUp: every usable wrist is above its shoulder.
 */
export function computeAim(pose, config = DEFAULT_AIM_CONFIG) {
  const k2 = pose?.keypoints || [];
  const body = torsoFrame(pose, config);
  const points = body ? body.points : k2;
  const read = (shoulderIndex, wristIndex) => {
    const shoulder = points[shoulderIndex];
    const wrist = points[wristIndex];
    // Scores come from the image keypoints; world landmarks may not carry them.
    const score = Math.min(scoreOf(k2[shoulderIndex]), scoreOf(k2[wristIndex]));
    if (body?.frame === '3d' && !usable3(wrist)) return { ...NO_ARM };
    return readArm(shoulder, wrist, body, config, score);
  };
  const arms = { left: read(KP.leftShoulder, KP.leftWrist), right: read(KP.rightShoulder, KP.rightWrist) };
  const frame = { frame: body?.frame ?? null, yawDeg: body?.yawDeg ?? null, tiltDeg: body?.tiltDeg ?? null };
  const ok = [arms.left, arms.right].filter((arm) => arm.state === 'ok');
  const weight = ok.reduce((acc, arm) => acc + arm.score, 0);
  if (!ok.length || weight <= 0) {
    return { aimX: null, rawX: null, offset: null, lost: true, usableArms: 0, weight: 0, score: 0, perArm: [null, null], armsUp: false, ...frame, arms };
  }
  const offset = ok.reduce((acc, arm) => acc + arm.offset * arm.score, 0) / weight;
  const rawX = offsetToAimX(offset, config);
  return {
    aimX: clamp01(rawX), rawX, offset, lost: false, usableArms: ok.length, weight, score: weight / ok.length,
    perArm: [arms.left, arms.right].map((arm) => (arm.state === 'ok' ? clamp01(arm.x) : null)),
    armsUp: ok.every((arm) => arm.drop < 0),
    ...frame, arms,
  };
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

/** Each wrist this many shoulder widths out on its own side counts as arms wide. */
export const ARMS_WIDE_OFFSET = 1.3;

/**
 * Both arms held out to their own sides (a "T", at any height), read from a
 * computeAim result. The spike's hands-free "next": it is not an aiming
 * posture (aiming moves both hands the same way) and never needs the arms
 * overhead. null when either arm cannot be judged.
 */
export function armsWide(aim, minOffset = ARMS_WIDE_OFFSET) {
  const left = aim?.arms?.left;
  const right = aim?.arms?.right;
  const judged = (arm) => !!arm && (arm.state === 'ok' || arm.state === 'down') && arm.offset != null;
  if (!judged(left) || !judged(right)) return null;
  // The player's left is screen left: a negative offset.
  return left.offset <= -minOffset && right.offset >= minOffset;
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
