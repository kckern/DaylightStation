// The weapon ladder. The power meter (kills and firing time, engine.js) moves
// the shooter up it; heart-rate zone no longer picks the shot.
//
// A volley is one beat of the stream: every entry in `shots` leaves the cannon
// at once. dx = sideways offset from the cannon (scene units), vx = sideways
// speed (scene units per second).
export const SHOT_TIERS = Object.freeze({
  small: Object.freeze({ id: 'small', label: 'Single', damage: 1, halfWidth: 6, shots: Object.freeze([Object.freeze({ dx: 0, vx: 0 })]) }),
  double: Object.freeze({ id: 'double', label: 'Double', damage: 1, halfWidth: 6, shots: Object.freeze([Object.freeze({ dx: -14, vx: 0 }), Object.freeze({ dx: 14, vx: 0 })]) }),
  spread: Object.freeze({ id: 'spread', label: 'Spread', damage: 1, halfWidth: 6, shots: Object.freeze([Object.freeze({ dx: 0, vx: -150 }), Object.freeze({ dx: 0, vx: 0 }), Object.freeze({ dx: 0, vx: 150 })]) }),
});

/** Weapon level -> shot tier. The top level also charges bombs. */
export const WEAPON_LADDER = Object.freeze(['small', 'double', 'spread']);
export const TOP_WEAPON_LEVEL = WEAPON_LADDER.length - 1;
/** The ladder as the HUD shows it: the three streams, then the bomb a full meter buys at the top. */
export const WEAPON_STEPS = Object.freeze(['Single', 'Double', 'Spread', 'Bomb']);

export const weaponTier = (weapon) => WEAPON_LADDER[Math.min(TOP_WEAPON_LEVEL, Math.max(0, weapon?.level || 0))];
/** A bomb is ready: top of the ladder with a full meter. */
export const bombReady = (weapon) => (weapon?.level || 0) >= TOP_WEAPON_LEVEL && (weapon?.meter || 0) >= 1;
