import { useEffect, useMemo, useRef } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { DEFAULT_AIM_CONFIG, computeAim, createAimHistory, createAimSmoother } from '../../lib/skylineInvaders/aim.js';
import { INVADERS_TUNABLES } from '../../lib/skylineInvaders/tunables.js';

const SMOOTHER_TAU_MS = 120;
const HISTORY_MS = 1500;
const clamp01 = (value) => Math.min(1, Math.max(0, value));

/**
 * The aim state for one game, with no React in it. Poses arrive through
 * `processPoses` (registered as a PoseContext move detector by
 * InvadersPoseBridge) at the pose rate, about 13 Hz on the garage box; the
 * frame loop reads `sample()` and the fire hook reads `latched(pressAt)`.
 *
 * `now` and the press timestamps passed to `latched` must share one clock
 * (epoch ms: app events carry Date.now()).
 */
export function createAimTracker({ tunables = INVADERS_TUNABLES, now = () => Date.now() } = {}) {
  const smoother = createAimSmoother({ tauMs: SMOOTHER_TAU_MS });
  const armSmoothers = [createAimSmoother({ tauMs: SMOOTHER_TAU_MS }), createAimSmoother({ tauMs: SMOOTHER_TAU_MS })];
  const history = createAimHistory({ horizonMs: HISTORY_MS });
  const listeners = new Set();
  let config = { ...DEFAULT_AIM_CONFIG, minScore: tunables.keypointMinScore };
  let calibration = null;
  let current = { x: 0.5, perArm: [null, null], armsUp: false, armsUpSince: null };
  let lastSeenAt = null;
  let lost = true;
  let offset = null;
  const emit = (event) => listeners.forEach((listener) => listener(event));
  const resetSmoothing = () => { smoother.reset(); armSmoothers.forEach((arm) => arm.reset()); };
  const record = (at) => history.push({ t: at, ...current });

  // Loss is judged by time since the last usable arm, both when a poor frame
  // arrives and when the frame loop asks: a stalled camera sends no frames.
  const checkLost = (at) => {
    if (lost || lastSeenAt === null || at - lastSeenAt <= tunables.poseLostAfterMs) return;
    lost = true;
    resetSmoothing();
    current = { ...current, armsUp: false, armsUpSince: null };   // the aim is held, the bonus posture is not
    record(at);
    emit('lost');
  };

  return {
    // PoseContext stores a truthy return as a move event: return nothing.
    processPoses(poses) {
      const at = now();
      const read = computeAim(poses?.[0] || null, config);
      // The uncalibrated torso offset (shoulder widths): what the lobby captures.
      if (!read.lost) offset = read.offset;
      if (calibration && !read.lost) {
        current = {
          x: smoother.push(read.aimX, at),
          perArm: read.perArm.map((value, index) => (value === null ? null : armSmoothers[index].push(value, at))),
          armsUp: read.armsUp,
          armsUpSince: read.armsUp ? (current.armsUpSince ?? at) : null,
        };
        lastSeenAt = at;
        record(at);
        if (lost) { lost = false; emit('acquired'); }
        return;
      }
      checkLost(at);
      if (!lost) record(at);
    },
    /** `{ left, right }` in shoulder widths (calibrationFromSamples), or null for manual aim only. */
    setCalibration(next) {
      calibration = next || null;
      config = { ...config, calibration };
      resetSmoothing();
    },
    calibration: () => calibration,
    rawOffset: () => offset,
    /** The aim right now. `lost` is always true in manual mode (no calibration). */
    sample() {
      if (calibration) checkLost(now());
      return { ...current, lost: calibration ? lost : true, mode: calibration ? 'pose' : 'manual' };
    },
    /**
     * The aim a mat press at `atMs` fires with: the pose from `aimLatchMs`
     * earlier, because stepping throws the arms. Arms-up counts only when it
     * had been held for `armsUpHoldMs` by then. Manual aim is not moved by a
     * step, so it is used as it stands.
     */
    latched(atMs) {
      if (!calibration) return { x: current.x, perArm: current.perArm, armsUp: false };
      const then = atMs - tunables.aimLatchMs;
      const sample = history.at(then) || current;
      const held = sample.armsUpSince != null && then - sample.armsUpSince >= tunables.armsUpHoldMs;
      return { x: sample.x, perArm: sample.perArm, armsUp: !!sample.armsUp && held };
    },
    /** Manual aim (gamepad, keyboard, drift assist). A live pose overrides it on its next frame. */
    nudge(delta) { current = { ...current, x: clamp01(current.x + delta) }; record(now()); },
    setAim(x) { current = { ...current, x: clamp01(x) }; record(now()); },
    /** Hear 'acquired' / 'lost'. Returns the unsubscribe. */
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

/** One stable tracker per mounted game. Never reads PoseContext. */
export default function useInvadersAim({ tunables = INVADERS_TUNABLES } = {}) {
  const log = useMemo(() => getLogger().child({ component: 'skyline-invaders-aim' }), []);
  const ref = useRef(null);
  if (!ref.current) ref.current = createAimTracker({ tunables });
  const tracker = ref.current;
  useEffect(() => tracker.subscribe((event) => {
    log.info(`skyline_invaders.pose.${event}`, { aim: tracker.sample().x });
  }), [tracker, log]);
  return tracker;
}
