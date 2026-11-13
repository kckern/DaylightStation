// Lanes: the aim range cut into equal columns. Threats spawn on lane centres
// and the cannon sits on one, so a gesture picks a lane instead of a pixel.
// Pure.
import { FIELD, THREATS, aimToX, xToAim } from './threats.js';
import { INVADERS_TUNABLES } from './tunables.js';

export const LANES = INVADERS_TUNABLES.lanes;
export const LANE_WIDTH = (FIELD.width - 2 * FIELD.marginX) / LANES;

const clampLane = (lane) => Math.min(LANES - 1, Math.max(0, Math.round(Number(lane) || 0)));

/** The aim (0..1) at the centre of a lane. */
export const laneAim = (lane) => (clampLane(lane) + 0.5) / LANES;
/** The scene x at the centre of a lane. */
export const laneX = (lane) => aimToX(laneAim(lane));
/** The lane an aim falls in. An aim that is not a number is the middle. */
export const laneOfAim = (aim) => Math.min(LANES - 1, Math.max(0, Math.floor((Number.isFinite(aim) ? Math.min(1, Math.max(0, aim)) : 0.5) * LANES)));
export const laneOfX = (x) => laneOfAim(xToAim(x));

/**
 * The cannon's lane for a raw aim. With no lane yet it is the lane the aim is
 * in. After that the cannon stays put until the aim is `hysteresis` of a lane
 * past the edge of its own lane, so an aim resting on a boundary cannot make
 * it flicker, and a small throw of the arms does not move it.
 */
export function snapLane(aim, current = null, { hysteresis = INVADERS_TUNABLES.laneHysteresis } = {}) {
  const raw = laneOfAim(aim);
  if (current == null || !Number.isFinite(aim)) return current == null ? raw : clampLane(current);
  const lane = clampLane(current);
  const slack = hysteresis / LANES;
  if (aim >= lane / LANES - slack && aim <= (lane + 1) / LANES + slack) return lane;
  return raw;
}

/**
 * The threat a shot leaving straight up from `x` meets first: the lowest one
 * whose box the shot's width overlaps. null when the column is clear.
 */
export function nextTarget(threats, x, halfWidth = 6) {
  let best = null;
  for (const threat of threats || []) {
    const spec = THREATS[threat.type];
    if (!spec || Math.abs(threat.x - x) > spec.width / 2 + halfWidth) continue;
    if (!best || threat.y > best.y || (threat.y === best.y && threat.id < best.id)) best = threat;
  }
  return best;
}

/**
 * What a volley fired from `x` was closest to: the threat (bombs aside)
 * nearest in x, the lower one on a tie. `miss` is signed scene units, + =
 * the threat was to the right of the cannon.
 */
export function nearestThreat(threats, x) {
  let best = null;
  for (const threat of threats || []) {
    if (threat.type === 'bomb') continue;
    const d = Math.abs(threat.x - x);
    const bd = best ? Math.abs(best.x - x) : Infinity;
    if (d < bd || (d === bd && threat.y > best.y)) best = threat;
  }
  return best ? { id: best.id, type: best.type, x: best.x, y: best.y, miss: best.x - x } : null;
}
