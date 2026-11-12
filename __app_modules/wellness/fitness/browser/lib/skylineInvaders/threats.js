// Skyline Invaders threat table and movement. Pure: no DOM, no clocks, no
// randomness (the engine supplies each threat's random phase and direction).
import { box } from '../../../../../../__capabilities/gaming/portable/realtime/index.mjs';

// Scene units, y down. Same 1000 x 600 scene as Skyline Glider.
export const FIELD = Object.freeze({ width: 1000, height: 600, groundY: 540, marginX: 60, spawnY: -20, bomberY: 90 });

// fall / drift are scene units per second. Sprites are 11 x 8 grids; width and
// height are multiples of that grid so art and hitbox agree.
export const THREATS = Object.freeze({
  meteor: Object.freeze({ hp: 1, points: 10, width: 44, height: 32, fall: 70, baseDamage: 10 }),
  drone: Object.freeze({ hp: 1, points: 20, width: 44, height: 32, fall: 55, baseDamage: 10, zigzag: Object.freeze({ amplitude: 90, period_s: 2 }) }),
  pod: Object.freeze({ hp: 2, points: 30, width: 55, height: 40, fall: 35, baseDamage: 20, splitsInto: Object.freeze(['drone', 'drone']) }),
  bomber: Object.freeze({ hp: 4, points: 60, width: 66, height: 48, fall: 0, drift: 60, bombEvery_s: 4 }),
  bomb: Object.freeze({ hp: 1, points: 5, width: 16, height: 20, fall: 120, baseDamage: 15, countsAsKill: false }),
});
// What a level file may spawn. Bombs only ever come from a bomber.
export const LEVEL_THREAT_TYPES = Object.freeze(['meteor', 'drone', 'pod', 'bomber']);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const RANGE_X = FIELD.width - 2 * FIELD.marginX;

export const clampX = (x) => clamp(x, FIELD.marginX, FIELD.width - FIELD.marginX);
/** Normalized aim (0 = screen left) to a cannon x. An aim that is not a number centres the cannon. */
export const aimToX = (aim) => FIELD.marginX + (typeof aim === 'number' && Number.isFinite(aim) ? clamp(aim, 0, 1) : 0.5) * RANGE_X;
export const xToAim = (x) => clamp((x - FIELD.marginX) / RANGE_X, 0, 1);

export function threatBox(threat) {
  const spec = THREATS[threat.type];
  return box(threat.x - spec.width / 2, threat.x + spec.width / 2, threat.y - spec.height / 2, threat.y + spec.height / 2);
}

/**
 * One threat, dt seconds later. Returns a new object. A zigzag is a function
 * of the threat's age, so the path is the same at any frame rate. Bombs and
 * ground impact are the engine's job.
 */
export function moveThreat(threat, dt) {
  const spec = THREATS[threat.type];
  const age = threat.age + dt;
  if (spec.drift) {
    const raw = threat.x + threat.dir * spec.drift * dt;
    const x = clampX(raw);
    return { ...threat, x, dir: raw !== x ? -threat.dir : threat.dir, age };
  }
  const x = spec.zigzag
    ? clampX(threat.originX + spec.zigzag.amplitude * Math.sin((2 * Math.PI * age) / spec.zigzag.period_s + threat.phase))
    : threat.x;
  return { ...threat, x, y: threat.y + spec.fall * dt, age };
}
