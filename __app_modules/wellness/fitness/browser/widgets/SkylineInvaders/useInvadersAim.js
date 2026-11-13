import { useEffect, useMemo, useRef } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { KP, createAimSmoother } from '../../lib/skylineInvaders/aim.js';
import { GESTURE_INFO, gestureConfig, isGesture, readGestures } from '../../lib/skylineInvaders/gestures.js';
import { LANES, laneAim, laneOfAim, snapLane } from '../../lib/skylineInvaders/lanes.js';
import { INVADERS_TUNABLES } from '../../lib/skylineInvaders/tunables.js';

const MAX_POSE_GAP_MS = 250;   // drag and push integrate over pose frames; a stall is not a long push
const clamp01 = (value) => Math.min(1, Math.max(0, value));

/**
 * The aim state for one game, with no React in it. Poses arrive through
 * `processPoses` (registered as a PoseContext move detector by
 * InvadersPoseBridge) at the pose rate, about 13 Hz on the garage box; the
 * frame loop reads `sample()`.
 *
 * Three things live here:
 * - the raw aim (0..1), from the active gesture (gestures.js), the stick, or
 *   the lost-pose drift. How a gesture moves it depends on its kind: an `aim`
 *   gesture sets it (through the one smoothing filter), `velocity` (drag)
 *   and `impulse` (push) carry it along, and `hop` moves the lane itself;
 * - the cannon's lane, snapped from the raw aim with hysteresis (lanes.js).
 *   `sample().x` is the centre of that lane: where the cannon is drawn and
 *   where every shot leaves from;
 * - whether the player is lost: no torso (both shoulders) for
 *   `poseLostAfterMs`. Arms that drop or cannot be read only HOLD the aim.
 *
 * There is no calibration: every gesture has a fixed gain.
 */
export function createAimTracker({ tunables = INVADERS_TUNABLES, now = () => Date.now(), gesture = tunables.defaultGesture } = {}) {
  const config = gestureConfig(tunables);
  const smoother = createAimSmoother({ tauMs: tunables.aimSmoothingMs });
  const armSmoothers = [createAimSmoother({ tauMs: tunables.aimSmoothingMs }), createAimSmoother({ tauMs: tunables.aimSmoothingMs })];
  const listeners = new Set();
  const snap = (aim, lane) => snapLane(aim, lane, { hysteresis: tunables.laneHysteresis });
  let active = isGesture(gesture) ? gesture : tunables.defaultGesture;
  let memory = null;          // what the stateful gestures (offset, push, hop) remember between frames
  let glide = 0;              // push: the cannon's speed, screens per second
  let raw = 0.5;
  let lane = laneOfAim(raw);
  let armLanes = [null, null];
  let armsUp = false;
  let armsUpSince = null;
  let lastPoseAt = null;
  let lastBodyAt = null;
  let everSeen = false;
  let lost = true;
  let freezeUntil = 0;
  let manual = false;         // the gamepad / keys method: the pose is watched but never aims
  let seen = null;            // the last pose as the lobby reads it: { at, body, wide }
  let frame = null;           // the last pose and every gesture's reading of it, for the trace recorder
  const emit = (event) => listeners.forEach((listener) => listener(event));
  const resetSmoothing = () => { smoother.reset(); armSmoothers.forEach((arm) => arm.reset()); };

  // Loss is judged by time since the torso was last seen, both when a poor
  // frame arrives and when the frame loop asks: a stalled camera sends no frames.
  const checkLost = (at) => {
    if (lost || lastBodyAt === null || at - lastBodyAt <= tunables.poseLostAfterMs) return;
    lost = true;
    resetSmoothing();
    memory = null;
    glide = 0;
    armsUp = false;            // the aim is held, the bonus posture is not
    armsUpSince = null;
    armLanes = [null, null];
    emit('lost');
  };

  return {
    // PoseContext stores a truthy return as a move event: return nothing.
    processPoses(poses) {
      const at = now();
      const pose = poses?.[0] || null;
      const prevArmLanes = armLanes;
      const dtMs = lastPoseAt === null ? 0 : Math.min(MAX_POSE_GAP_MS, Math.max(0, at - lastPoseAt));
      lastPoseAt = at;
      const signals = readGestures(pose, memory, at, config);
      memory = signals.memory;
      frame = { at, pose, signals };
      const scored = (index) => (pose?.keypoints?.[index]?.score ?? 0) >= config.minScore;
      seen = { at, body: signals.body && scored(KP.nose), wide: signals.wide };
      if (!signals.body) { checkLost(at); return; }
      lastBodyAt = at;
      everSeen = true;
      if (manual) { if (lost) { lost = false; emit('acquired'); } return; }
      const signal = signals[active];
      const kind = GESTURE_INFO[active].kind;
      armLanes = [null, null];
      let hopped = false;
      if (kind === 'aim') {
        // No usable reading: hold. The filter keeps its value, so the aim picks
        // up from where it was when the reading comes back.
        if (signal.aim !== null) raw = smoother.push(signal.aim, at);
        if (signal.perArm) armLanes = signal.perArm.map((value, index) => (value === null ? null : snap(armSmoothers[index].push(value, at), prevArmLanes[index])));
      } else if (kind === 'velocity') {
        // Rate control: the gesture gives a speed, and the aim is where that
        // speed has carried it. Arms down is speed 0: the cannon stays.
        raw = clamp01(raw + (signal.velocity * dtMs) / 1000);
      } else if (kind === 'impulse') {
        // A stroke drives the cannon; after it the cannon glides on, slowed by
        // friction, and comes to rest on the centre of a lane.
        if (signal.stroke) glide = signal.velocity;
        else glide *= Math.exp(-dtMs / tunables.pushFrictionMs);
        if (Math.abs(glide) < tunables.pushSettleSpeed) {
          if (glide !== 0) raw = laneAim(laneOfAim(raw));
          glide = 0;
        } else {
          raw = clamp01(raw + (glide * dtMs) / 1000);
          if (raw === 0 || raw === 1) glide = 0;
        }
      } else if (signal.hop) {
        // A hop moves the cannon one whole lane, whatever the raw aim was doing.
        lane = Math.min(LANES - 1, Math.max(0, lane + signal.hop));
        raw = laneAim(lane);
        hopped = true;
      }
      // A mat step throws the arms: the lane holds for a moment after one.
      if (!hopped && at >= freezeUntil) lane = snap(raw, lane);
      armsUp = signals.armsUp;
      armsUpSince = armsUp ? (armsUpSince ?? at) : null;
      if (lost) { lost = false; emit('acquired'); }
    },
    /** Switch the aim gesture. The cannon stays where it is. */
    setGesture(next) {
      if (!isGesture(next) || next === active) return;
      active = next;
      memory = null;
      glide = 0;
      resetSmoothing();
      armLanes = [null, null];
    },
    gesture: () => active,
    /** The gamepad / keys method: while on, the pose never moves the cannon and `mode` is 'manual'. */
    setManual(on) {
      if (manual === !!on) return;
      manual = !!on;
      memory = null;
      glide = 0;
      resetSmoothing();
      armLanes = [null, null];
    },
    manual: () => manual,
    /**
     * The player as the lobby reads them: `body` = head and both shoulders in
     * view (wrists may hang out of frame), `wide` = both arms held out to the
     * sides (the hands-free "next"; null when it cannot be judged). Both empty
     * once the last pose is older than `poseLostAfterMs`.
     */
    presence() {
      if (!seen || now() - seen.at > tunables.poseLostAfterMs) return { body: false, wide: null };
      return { body: seen.body, wide: seen.wide };
    },
    /**
     * The aim right now. `x` is the centre of the cannon's lane (what the
     * engine fires from and the scene draws); `raw` is the aim before the
     * lane snap. `mode` is 'manual' until the camera has seen a torso, and
     * `lost` is always true then.
     */
    sample() {
      const at = now();
      if (everSeen) checkLost(at);
      const held = armsUp && armsUpSince !== null && at - armsUpSince >= tunables.armsUpHoldMs;
      return {
        x: laneAim(lane), raw, lane,
        perArm: armLanes.map((value) => (value === null ? null : laneAim(value))),
        armsUp: held && !manual, lost: everSeen ? lost : true, mode: everSeen && !manual ? 'pose' : 'manual', gesture: active,
      };
    },
    /** The last pose and every gesture's reading of it: `{ at, pose, signals }`, or null. For the trace recorder. */
    frame: () => frame,
    /** Hold the cannon's lane for `ms` from `at` (a mat step). The raw aim keeps moving. */
    freezeLane(ms = tunables.stepLaneFreezeMs, at = now()) { if (ms > 0) freezeUntil = Math.max(freezeUntil, at + ms); },
    /** Manual aim (gamepad, keyboard, drift assist). A live pose overrides it on its next usable frame. */
    setAim(x) { raw = clamp01(x); lane = snap(raw, lane); glide = 0; },
    /** Hear 'acquired' / 'lost'. Returns the unsubscribe. */
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

/** One stable tracker per mounted game. Never reads PoseContext. */
export default function useInvadersAim({ tunables = INVADERS_TUNABLES, gesture } = {}) {
  const log = useMemo(() => getLogger().child({ component: 'skyline-invaders-aim' }), []);
  const ref = useRef(null);
  if (!ref.current) ref.current = createAimTracker({ tunables, gesture });
  const tracker = ref.current;
  useEffect(() => tracker.subscribe((event) => {
    const sample = tracker.sample();
    log.info(`skyline_invaders.pose.${event}`, { aim: sample.raw, lane: sample.lane, gesture: sample.gesture });
  }), [tracker, log]);
  return tracker;
}
