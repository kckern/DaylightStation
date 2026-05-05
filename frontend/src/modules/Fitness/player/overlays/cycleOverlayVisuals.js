/**
 * getCycleOverlayVisuals(challenge)
 *
 * Pure helper that maps a cycle challenge snapshot (from the governance engine,
 * Task 17 shape) to the visual properties used by CycleChallengeOverlay.
 *
 * Returns:
 *   {
 *     visible: boolean,        // whether the overlay should render
 *     ringColor: string,       // hex color for the outer status ring
 *     ringOpacity: number,     // [0..1] — dims with dimFactor in the dim band
 *     dimPulse: boolean,       // true when maintain + dimFactor > 0 (orange)
 *     phaseProgress: number,   // [0..1] — clamped challenge.phaseProgressPct
 *     positionValid: boolean,  // always true for non-null cycle challenges
 *     lostSignal: boolean,     // cadenceFlags.lostSignal (no recent cadence data)
 *     stale: boolean,          // cadenceFlags.stale (cadence data is aged)
 *     waitingForBaseReq: boolean,  // waiting for initial baseline request
 *     clockPaused: boolean,    // init/ramp clocks are paused (rider idle)
 *     initRemainingMs: number|null,  // milliseconds left in init phase
 *     rampRemainingMs: number|null   // milliseconds left in ramp phase
 *   }
 *
 * Color mapping (per Task 21 spec):
 *   - init       → slate blue  #64748b
 *   - ramp       → warm yellow #f59e0b
 *   - maintain at/above hi (dimFactor === 0) → green  #22c55e
 *   - maintain in dim band   (dimFactor > 0) → orange #f97316
 *   - locked     → red         #ef4444
 */

const RING_COLORS = Object.freeze({
  init: '#64748b',
  ramp: '#f59e0b',
  maintainGreen: '#22c55e',
  maintainOrange: '#f97316',
  locked: '#ef4444',
  neutral: '#64748b'
});

const OFF = Object.freeze({
  visible: false,
  ringColor: RING_COLORS.neutral,
  ringOpacity: 0,
  dimPulse: false,
  phaseProgress: 0,
  positionValid: false,
  lostSignal: false,
  stale: false,
  waitingForBaseReq: false,
  clockPaused: false,
  initRemainingMs: null,
  rampRemainingMs: null
});

const clamp01 = (value) => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const normalizeType = (challenge) => {
  if (!challenge) return null;
  if (typeof challenge.type === 'string') return challenge.type.toLowerCase();
  // Infer cycle type from presence of cycleState (backward-tolerant)
  if (typeof challenge.cycleState === 'string') return 'cycle';
  return null;
};

export function getCycleOverlayVisuals(challenge) {
  if (!challenge || typeof challenge !== 'object') {
    return OFF;
  }

  const type = normalizeType(challenge);
  if (type !== 'cycle') {
    return OFF;
  }

  const cycleState = typeof challenge.cycleState === 'string'
    ? challenge.cycleState.toLowerCase()
    : null;
  if (!cycleState) {
    return OFF;
  }

  const dimFactor = clamp01(challenge.dimFactor);
  const phaseProgress = clamp01(challenge.phaseProgressPct);

  let ringColor = RING_COLORS.neutral;
  let ringOpacity = 1;
  let dimPulse = false;

  switch (cycleState) {
    case 'init':
      ringColor = RING_COLORS.init;
      ringOpacity = 0.9;
      break;
    case 'ramp':
      ringColor = RING_COLORS.ramp;
      ringOpacity = 1;
      break;
    case 'maintain':
      if (dimFactor > 0) {
        ringColor = RING_COLORS.maintainOrange;
        // Ring opacity scales down with dimFactor so that as the video dims,
        // the ring also fades. Floor at 0.35 so it never fully disappears.
        ringOpacity = Math.max(0.35, 1 - dimFactor * 0.55);
        dimPulse = true;
      } else {
        ringColor = RING_COLORS.maintainGreen;
        ringOpacity = 1;
      }
      break;
    case 'locked':
      ringColor = RING_COLORS.locked;
      ringOpacity = 1;
      break;
    default:
      return OFF;
  }

  const lostSignal        = Boolean(challenge.cadenceFlags?.lostSignal);
  const stale             = Boolean(challenge.cadenceFlags?.stale);
  const waitingForBaseReq = Boolean(challenge.waitingForBaseReq);
  const clockPaused       = Boolean(challenge.clockPaused);
  const initRemainingMs   = Number.isFinite(challenge.initRemainingMs)
    ? challenge.initRemainingMs : null;
  const rampRemainingMs   = Number.isFinite(challenge.rampRemainingMs)
    ? challenge.rampRemainingMs : null;

  return {
    visible: true,
    ringColor,
    ringOpacity,
    dimPulse,
    phaseProgress,
    positionValid: true,
    lostSignal,
    stale,
    waitingForBaseReq,
    clockPaused,
    initRemainingMs,
    rampRemainingMs
  };
}

export const CYCLE_OVERLAY_RING_COLORS = RING_COLORS;

/**
 * rpmToAngle(rpm, gaugeMax)
 *
 * Maps an RPM value to a radian angle on the top-hemisphere gauge arc.
 *
 * The gauge arc sweeps the TOP half of the overlay (from 9-o'clock through
 * 12-o'clock to 3-o'clock). In standard math convention with SVG's y-flipped
 * axis:
 *   - rpm=0         → angle = π            (left edge)
 *   - rpm=gaugeMax  → angle = 2π           (right edge)
 *   - rpm=halfway   → angle = 1.5π         (top center)
 *
 * With SVG's y-down convention, sin(θ) > 0 means y below cy; sin(θ) < 0 means
 * y above cy. For θ ∈ (π, 2π), sin(θ) < 0 so the points render above cy,
 * which is what we want (top hemisphere).
 *
 * Clamps rpm to [0, gaugeMax] so out-of-range values pin to the endpoints
 * rather than wrapping around.
 */
export function rpmToAngle(rpm, gaugeMax) {
  if (!Number.isFinite(gaugeMax) || gaugeMax <= 0) return Math.PI;
  const numeric = Number.isFinite(rpm) ? rpm : 0;
  const clamped = Math.max(0, Math.min(gaugeMax, numeric));
  return Math.PI + (clamped / gaugeMax) * Math.PI;
}

/**
 * polarToCartesian(cx, cy, r, angle)
 *
 * Converts a polar coordinate (center + radius + angle in radians) into a
 * cartesian { x, y } point. Uses standard math convention: angle 0 points
 * along +x, angle π/2 along +y (which in SVG's y-down coords renders BELOW
 * the center). The overlay uses angles in (π, 2π) so points land above the
 * center — see rpmToAngle for the gauge-arc geometry.
 */
export function polarToCartesian(cx, cy, r, angle) {
  return {
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle)
  };
}

/**
 * getBoosterAvatarSlots(boostingUsers, overlaySize)
 *
 * Returns up to 4 avatar slots positioned at the four quadrants (NE, SE, SW, NW)
 * around the perimeter of a square overlay. Each slot carries the user id,
 * the uppercase first-letter initial, and an inline style with `top`/`left`
 * pixel values suitable for `position: absolute`.
 *
 * Contract:
 *   - boostingUsers: string[]  (non-arrays or empty → [])
 *   - overlaySize:  number px  (default 220)
 *   - Caps at 4 entries; no overflow indicator (YAGNI).
 *   - Order:  [0]=NE, [1]=SE, [2]=SW, [3]=NW
 *
 * @param {string[]} boostingUsers
 * @param {number} [overlaySize=220]
 * @returns {Array<{ id: string, initial: string, style: { top: string, left: string } }>}
 */
export function getBoosterAvatarSlots(boostingUsers, overlaySize = 220) {
  if (!Array.isArray(boostingUsers) || boostingUsers.length === 0) return [];
  const positions = [
    { top: 8, left: overlaySize - 32 },                 // NE
    { top: overlaySize - 32, left: overlaySize - 32 },  // SE
    { top: overlaySize - 32, left: 8 },                 // SW
    { top: 8, left: 8 }                                 // NW
  ];
  return boostingUsers.slice(0, 4).map((uid, i) => {
    const idStr = typeof uid === 'string' ? uid : String(uid ?? '');
    const firstChar = idStr.length > 0 ? idStr.charAt(0).toUpperCase() : '?';
    return {
      id: idStr,
      initial: firstChar || '?',
      style: {
        top: `${positions[i].top}px`,
        left: `${positions[i].left}px`
      }
    };
  });
}

export default getCycleOverlayVisuals;
