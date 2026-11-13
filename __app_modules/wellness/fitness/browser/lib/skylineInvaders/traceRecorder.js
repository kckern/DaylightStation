// The joint recorder: what the camera saw and what every gesture made of it,
// so the gestures can be compared from data instead of by feel. Two event
// streams, both batched:
//
//   skyline_invaders.pose.trace   10 rows a second: the arm and torso joints
//                                 and EVERY gesture's signal for that frame,
//                                 whichever gesture is driving the cannon.
//   skyline_invaders.shot.trace   one row per volley: where the cannon was,
//                                 what it was nearest to, and whether it hit.
//
// Rows are arrays of integers (null = no value) under one header per batch,
// because a keyed object per row would triple the size. A batch goes out
// every `traceBatchMs` (20 s): the log ingest allows each event name a burst
// of 30 and then 3 a minute per client, and 20 s is exactly 3 a minute.
//
// No clocks and no logger in here: the caller passes `now` and `emit`.
import { GESTURE_INFO } from './gestures.js';
import { INVADERS_TUNABLES } from './tunables.js';

/** BlazePose indexes recorded in the image (x, y in px, score x100). */
export const TRACE_KEYPOINTS_2D = Object.freeze([11, 12, 13, 14, 15, 16, 19, 20, 23, 24]);
/** BlazePose indexes recorded as world landmarks (x, y, z in mm). */
export const TRACE_KEYPOINTS_3D = Object.freeze([11, 12, 13, 14, 15, 16]);
export const ARM_STATE_CODES = Object.freeze({ ok: 0, down: 1, low_score: 2, missing: 3, no_body: 4 });
export const TRYOUT_TARGET_CODES = Object.freeze({ left: 1, centre: 2, right: 3 });

/**
 * Column names for a pose row, in order.
 *   dt                ms since the batch's t0
 *   k<i>x k<i>y k<i>s image keypoint i: px, px, score x100
 *   w<i>x w<i>y w<i>z world keypoint i: mm
 *   wiper twist wings wheel sprinkler offset   that gesture's aim x1000 (0 = screen left); null = it would hold
 *   dragVel           drag's cannon speed, screens/s x1000
 *   pushVel           the faster wrist's sideways speed, shoulder widths/s x100
 *   pushStroke        1 when a push stroke began since the last row (the trigger event)
 *   hop               -1 / 1 when a hop triggered since the last row, else 0
 *   roll span         wrist-to-wrist line: roll in degrees x10, wrist spacing in shoulder widths x100 (wings, wheel)
 *   yaw azimuth       torso yaw (twist) and hand azimuth (sprinkler), degrees x10
 *   lean              shoulders against hips, shoulder widths x100
 *   raw lane cannonX  the cannon: raw aim x1000, lane 0..7, drawn x in scene units
 *   lost              1 = no torso in view
 *   armL armR         ARM_STATE_CODES for the player's left and right arm
 *   target            controls intro only: TRYOUT_TARGET_CODES of the practice target the cannon is on, else 0
 */
export const POSE_TRACE_COLS = Object.freeze([
  'dt',
  ...TRACE_KEYPOINTS_2D.flatMap((i) => [`k${i}x`, `k${i}y`, `k${i}s`]),
  ...TRACE_KEYPOINTS_3D.flatMap((i) => [`w${i}x`, `w${i}y`, `w${i}z`]),
  'wiper', 'twist', 'wings', 'wheel', 'sprinkler', 'offset',
  'dragVel', 'pushVel', 'pushStroke', 'hop', 'roll', 'span', 'yaw', 'azimuth', 'lean',
  'raw', 'lane', 'cannonX', 'lost', 'armL', 'armR', 'target',
]);
/**
 * Column names for a shot row: t (ms since the batch's t0), lane, aim (raw
 * aim x1000), x (cannon x, scene units), tx / ty (the nearest threat, bombs
 * aside; null with an empty sky), miss (tx - x, signed: + = the threat was to
 * the right), hit (1 / 0; null = the round ended first), weapon (0 single,
 * 1 double, 2 spread).
 */
export const SHOT_TRACE_COLS = Object.freeze(['t', 'lane', 'aim', 'x', 'tx', 'ty', 'miss', 'hit', 'weapon']);
const WEAPON_CODES = Object.freeze({ small: 0, double: 1, spread: 2 });

const int = (value, scale = 1) => (Number.isFinite(value) ? Math.round(value * scale) : null);

/** One pose row. `frame` is the tracker's `{ at, pose, signals }`; `sample` its `sample()`. Pure. */
export function poseTraceRow(frame, sample, { t0, cannonX = null, pushStroke = false, hop = 0, target = 0 } = {}) {
  const k2 = frame?.pose?.keypoints || [];
  const k3 = frame?.pose?.keypoints3D || [];
  const signals = frame?.signals || {};
  const row = [int((frame?.at ?? t0) - t0)];
  for (const i of TRACE_KEYPOINTS_2D) row.push(int(k2[i]?.x), int(k2[i]?.y), int(k2[i]?.score, 100));
  for (const i of TRACE_KEYPOINTS_3D) row.push(int(k3[i]?.x, 1000), int(k3[i]?.y, 1000), int(k3[i]?.z, 1000));
  for (const id of ['wiper', 'twist', 'wings', 'wheel', 'sprinkler', 'offset']) row.push(int(signals[id]?.aim, 1000));
  row.push(
    int(signals.drag?.velocity, 1000), int(signals.push?.wristVel, 100), pushStroke ? 1 : 0, hop || 0,
    int(signals.wings?.rollDeg, 10), int(signals.wings?.spanSw, 100), int(signals.twist?.yawDeg, 10), int(signals.sprinkler?.azimuthDeg, 10), int(signals.lean, 100),
    int(sample?.raw, 1000), int(sample?.lane), int(cannonX), sample?.lost ? 1 : 0,
    ARM_STATE_CODES[signals.armStates?.[0]] ?? null, ARM_STATE_CODES[signals.armStates?.[1]] ?? null, target || 0,
  );
  return row;
}

/**
 * @param {object} options
 * @param {(name: string, data: object) => void} options.emit   sends one batch (the logger)
 * @param {() => number} [options.now]   epoch ms
 * @returns the recorder: begin(header), pose(frame, sample, extra), volleyFired(event data, sample),
 *   volleySettled(volley, hit), flush(reason, { final }), end(reason)
 */
export function createTraceRecorder({ emit, now = () => Date.now(), tunables = INVADERS_TUNABLES } = {}) {
  const everyMs = 1000 / tunables.traceHz;
  let header = null;
  let seq = 0;
  let pose = null;        // { t0, rows }
  let shots = null;       // { t0, rows }
  let pending = new Map(); // volley id -> shot row, waiting for its hit or miss
  let nextRowAt = -Infinity;   // rows are kept on a fixed beat, so a 60 Hz caller still gets ten a second
  let lastFrameAt = null;
  let batchStartedAt = null;
  let stroke = false;
  let hop = 0;

  const send = (name, batch, cols, reason) => {
    if (!batch || !batch.rows.length) return;
    emit(name, { ...header, seq: seq++, t0: batch.t0, n: batch.rows.length, cols, rows: batch.rows, reason });
  };
  const flush = (reason = 'interval', { final = false } = {}) => {
    if (!header) return;
    if (final && shots) {
      // The round ended with these volleys still in the air.
      for (const row of pending.values()) shots.rows.push(row);
      pending = new Map();
    }
    send('skyline_invaders.pose.trace', pose, POSE_TRACE_COLS, reason);
    send('skyline_invaders.shot.trace', shots, SHOT_TRACE_COLS, reason);
    pose = null;
    shots = null;
    batchStartedAt = null;
  };
  const due = (at) => { if (batchStartedAt !== null && at - batchStartedAt >= tunables.traceBatchMs) flush('interval'); };
  const open = (at) => { if (batchStartedAt === null) batchStartedAt = at; };

  return {
    /**
     * Start recording under a header that every batch carries: `{ kind:
     * 'round' | 'tryout', runId, levelId, shooterId, gesture, ... }`. Anything
     * still buffered from the last header is sent first.
     */
    begin(next) {
      flush('begin', { final: true });
      header = { ...next, gestureKind: GESTURE_INFO[next?.gesture]?.kind || null, hz: tunables.traceHz };
      seq = 0;
      nextRowAt = -Infinity;
      lastFrameAt = null;
      stroke = false;
      hop = 0;
    },
    /**
     * Offer the tracker's latest frame; call it every game frame. A row is
     * kept `traceHz` times a second. Push strokes and hops that happen between
     * rows are remembered and written on the next one, so a trigger is never
     * lost to the downsampling.
     */
    pose(frame, sample, extra = {}) {
      if (!header || !frame) return;
      const at = now();
      if (frame.at !== lastFrameAt) {
        lastFrameAt = frame.at;
        if (frame.signals?.push?.started) stroke = true;
        if (frame.signals?.hop?.hop) hop = frame.signals.hop.hop;
      }
      due(at);
      if (at < nextRowAt) return;
      nextRowAt = nextRowAt + everyMs > at ? nextRowAt + everyMs : at + everyMs;
      open(at);
      pose ||= { t0: frame.at, rows: [] };
      pose.rows.push(poseTraceRow(frame, sample, { ...extra, t0: pose.t0, pushStroke: stroke, hop }));
      stroke = false;
      hop = 0;
    },
    /** A volley left the cannon: the engine's `shot.fired` data and the tracker sample. */
    volleyFired(fired, sample) {
      if (!header) return;
      const at = now();
      due(at);
      open(at);
      shots ||= { t0: at, rows: [] };
      pending.set(fired.volley, [
        int(at - shots.t0), int(fired.lane), int(sample?.raw, 1000), int(fired.x),
        int(fired.target?.x), int(fired.target?.y), int(fired.target?.miss), null, WEAPON_CODES[fired.tier] ?? null,
      ]);
    },
    /** The engine's `volley.settled`: the volley hit something, or all of it left the field. */
    volleySettled(volley, hit) {
      const row = pending.get(volley);
      if (!row) return;
      pending.delete(volley);
      row[7] = hit ? 1 : 0;
      shots ||= { t0: now(), rows: [] };
      shots.rows.push(row);
    },
    flush,
    /** Send what is buffered and stop recording until the next begin(). */
    end(reason = 'end') {
      flush(reason, { final: true });
      header = null;
    },
    /** For tests and the render-health line: how much is buffered. */
    stats: () => ({ recording: !!header, poseRows: pose?.rows.length || 0, shotRows: shots?.rows.length || 0, pending: pending.size, seq }),
  };
}
