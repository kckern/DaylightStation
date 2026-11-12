import { trustedZoneId, weaponPower } from '../skylineGlider/weaponPower.js';

// spread = horizontal speed (scene units/s) of each shot in the volley.
// The nuke shot does no damage of its own: its blast does (engine.js).
export const SHOT_TIERS = Object.freeze({
  small: Object.freeze({ id: 'small', damage: 1, halfWidth: 6, spread: Object.freeze([0]) }),
  big: Object.freeze({ id: 'big', damage: 2, halfWidth: 16, spread: Object.freeze([0]) }),
  spread: Object.freeze({ id: 'spread', damage: 1, halfWidth: 6, spread: Object.freeze([-150, 0, 150]) }),
  nuke: Object.freeze({ id: 'nuke', damage: 0, halfWidth: 10, spread: Object.freeze([0]) }),
});
const BY_POWER = ['small', 'big', 'spread', 'nuke'];

/** The shooter's tier, plus whether a trusted zone backs it (for the HUD note). */
export function shotTier(profile, now = Date.now()) {
  const zoneId = trustedZoneId(profile, now);
  return { tier: BY_POWER[weaponPower(profile, now) - 1], zoneId, trusted: zoneId !== null };
}
