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

/**
 * How a round ended against the level's pass threshold.
 * Stars: 1 = pass, 2 = base HP >= 75%, 3 = no base damage.
 */
export function levelOutcome(state, level) {
  const baseHpPct = Math.round((100 * state.base.hp) / state.base.maxHp);
  const passed = state.kills >= level.pass.kills && baseHpPct >= (level.pass.base_hp_min ?? 0);
  const stars = !passed ? 0 : state.base.hp >= state.base.maxHp ? 3 : baseHpPct >= 75 ? 2 : 1;
  return { passed, stars, kills: state.kills, score: state.score, bestCombo: state.bestCombo || 0, baseHpPct };
}

// PLAN DEFAULT (the spec names rings but not the amount): 10 per star, the same
// 30-ring ceiling as a Skyline Glider flight.
export const invadersBonus = (stars) => ({ 1: 10, 2: 20, 3: 30 })[stars] || 0;
