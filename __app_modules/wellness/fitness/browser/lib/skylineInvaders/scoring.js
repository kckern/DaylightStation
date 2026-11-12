// Skyline Invaders scoring. Pure.
import { THREATS } from './threats.js';

// Raised arms are a bonus only. Aim is body-relative and no posture is ever
// required to play; the hook decides `armsUp` and this multiplies the points.
const ARMS_UP_MULTIPLIER = 1.5;
const COMBO_STEP = 0.1;
const COMBO_CAP = 10;

/** Points for one kill. `combo` already includes this hit. */
export function killPoints(type, { combo = 0, armsUp = false } = {}) {
  const base = THREATS[type]?.points || 0;
  return Math.round(base * (1 + Math.min(combo, COMBO_CAP) * COMBO_STEP) * (armsUp ? ARMS_UP_MULTIPLIER : 1));
}
