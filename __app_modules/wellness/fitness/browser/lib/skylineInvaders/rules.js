// Per-level balance knobs with their defaults. Shared by the engine (which
// plays by them) and the level validator (which checks a level's overrides).
export const BOOST_KINDS = Object.freeze(['rapid', 'shield', 'twin']);

const NUKE_DEFAULTS = Object.freeze({ radius: 160, damage: 3 });
const BOOST_DEFAULTS = Object.freeze({
  fill_s: 20,              // seconds of full-effort pedalling to fill the meter
  duration_s: 8,           // how long an activated boost lasts
  min_rpm: 40,             // cadence at or below this fills nothing
  full_rpm: 90,            // cadence at or above this fills at the full rate
  rapid_interval_s: 0.25,  // seconds between auto-fired shots during rapid fire
  rotation: BOOST_KINDS,
});

/** Nuke blast radius (scene units) and damage for a level. */
export const nukeRules = (level) => ({ ...NUKE_DEFAULTS, ...(level?.nuke || {}) });
/** Partner boost rules for a level. */
export const boostRules = (level) => ({ ...BOOST_DEFAULTS, ...(level?.boost || {}) });
