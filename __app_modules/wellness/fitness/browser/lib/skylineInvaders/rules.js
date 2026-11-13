// Per-level balance knobs with their defaults. Shared by the engine (which
// plays by them) and the level validator (which checks a level's overrides).
import { INVADERS_TUNABLES } from './tunables.js';

export const BOOST_KINDS = Object.freeze(['rapid', 'shield', 'twin']);

const NUKE_DEFAULTS = Object.freeze({ radius: 160, damage: 3 });
const BOOST_DEFAULTS = Object.freeze({
  fill_s: 20,              // seconds of full-effort pedalling to fill the meter
  duration_s: 8,           // how long an activated boost lasts
  min_rpm: 40,             // cadence at or below this fills nothing
  full_rpm: 90,            // cadence at or above this fills at the full rate
  rapid_interval_s: 0.125, // seconds between volleys during rapid fire (the stream's own rate is fire.stream_interval_s)
  rotation: BOOST_KINDS,
});

// The fire model: mat steps buy fuel, fuel runs a stream, kills and firing time
// fill the power meter. Defaults are the tunables; a level may override any.
const FIRE_DEFAULTS = Object.freeze({
  fuel_per_step_s: INVADERS_TUNABLES.fuelPerStepS,
  fuel_cap_s: INVADERS_TUNABLES.fuelCapS,
  stream_interval_s: INVADERS_TUNABLES.streamIntervalS,
  power_per_kill: INVADERS_TUNABLES.powerPerKill,
  power_per_firing_s: INVADERS_TUNABLES.powerPerFiringS,
  idle_drop_s: INVADERS_TUNABLES.weaponIdleDropS,
});
export const FIRE_KEYS = Object.freeze(Object.keys(FIRE_DEFAULTS));

/** Fuel, stream and power-meter rules for a level. */
export const fireRules = (level) => ({ ...FIRE_DEFAULTS, ...(level?.fire || {}) });
/** Bomb blast radius (scene units) and damage for a level. The level key is still `nuke`. */
export const nukeRules = (level) => ({ ...NUKE_DEFAULTS, ...(level?.nuke || {}) });
/** Partner boost rules for a level. */
export const boostRules = (level) => ({ ...BOOST_DEFAULTS, ...(level?.boost || {}) });
