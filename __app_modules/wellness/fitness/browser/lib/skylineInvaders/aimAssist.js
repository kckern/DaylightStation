// Aim without a live pose: a slow drift toward the most urgent threat while
// the camera has lost the player, and stick/keyboard aim. Pure; dt in seconds,
// aim in 0..1 (0 = screen left).
import { xToAim } from './threats.js';

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Move `aim` toward the column of the threat nearest the ground, `rate` of the screen per second. */
export function driftAim(aim, threats, dt, { rate = 0.1 } = {}) {
  // A bomb is not worth chasing: it lands before a slow drift arrives.
  const target = [...(threats || [])].filter((threat) => threat.type !== 'bomb').sort((a, b) => b.y - a.y || a.id - b.id)[0];
  if (!target) return aim;
  const goal = xToAim(target.x);
  const stride = rate * dt;
  return Math.abs(goal - aim) <= stride ? goal : aim + Math.sign(goal - aim) * stride;
}

/** Gamepad / keyboard aim: `axis` in -1..1, `speed` of the screen per second. */
export const manualAim = (aim, axis, dt, { speed = 0.6 } = {}) => clamp01(aim + axis * speed * dt);
