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
 *     positionValid: boolean   // always true for non-null cycle challenges
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
  positionValid: false
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

  return {
    visible: true,
    ringColor,
    ringOpacity,
    dimPulse,
    phaseProgress,
    positionValid: true
  };
}

export const CYCLE_OVERLAY_RING_COLORS = RING_COLORS;

export default getCycleOverlayVisuals;
