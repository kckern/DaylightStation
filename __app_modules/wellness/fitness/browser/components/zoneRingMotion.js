// Motion of the avatar zone ring: the meter arc and the dot that rides its tip.
//
// Angles are degrees clockwise from 3 o'clock, the way an SVG circle's stroke
// and a CSS rotate() both run. The bottom half (0..180) is always filled; the
// top half (180..360) is the meter, so a zone's progress p sits at 180 + p*180.
//
// A zone crossing is a LAP, never a reversal (owner, 2026-11-17). Up a zone,
// the dot carries on clockwise from 3 o'clock, down through 6 to 9, repainting
// the bottom half in the new colour behind it, then climbs to the new progress.
// Down a zone it runs the other way: back through 9, 6 and 3, repainting in the
// lower colour. The angle is unwrapped (it passes 360 going up, 0 going down)
// and folded back into 180..360 once the lap lands.
//
// Into Fire there is no lap: the dot goes away and the ring fills red.

import { ZONE_IDS } from '../shared/constants/fitness.js';

export const RING_TWEEN_MS = 300;
export const RING_LAP_MS = 380;

const FIRE = 'fire';

export const angleForProgress = (progress) => 180 + Math.min(Math.max(progress, 0), 1) * 180;

const rankOf = (zoneId) => (zoneId ? ZONE_IDS.indexOf(String(zoneId).toLowerCase()) : -1);

/**
 * Which way a zone change laps the ring: 1 clockwise (up), -1 counter-clockwise
 * (down), 0 no lap (unknown zone, first reading, or into Fire).
 */
export function lapDirection(fromZoneId, toZoneId) {
  const from = rankOf(fromZoneId);
  const to = rankOf(toZoneId);
  if (from < 0 || to < 0 || from === to) return 0;
  if (String(toZoneId).toLowerCase() === FIRE) return 0;
  return to > from ? 1 : -1;
}

/**
 * The arcs to draw at a (possibly unwrapped) dot angle.
 * @returns {{ current: [number, number]|null, previous: [number, number]|null }}
 *   [start, end] degrees; `current` in the zone's colour, `previous` in the
 *   colour of the zone being left (only during a lap).
 */
export function ringArcs(angle, lap = 0) {
  if (lap > 0) {
    if (angle <= 360) return { current: null, previous: [0, angle] };
    const swept = angle - 360;
    return { current: [0, swept], previous: swept < 180 ? [swept, 180] : null };
  }
  if (lap < 0) {
    if (angle >= 180) return { current: null, previous: [0, angle] };
    if (angle >= 0) return { current: [angle, 180], previous: [0, angle] };
    return { current: [0, 360 + angle], previous: null };
  }
  return { current: [0, Math.min(Math.max(angle, 0), 360)], previous: null };
}

export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
// A lap leaves at speed — the dot is already moving when the zone flips — so
// the bottom half is a brief in-between (~180ms), and it settles into the meter.
export const easeOut = (t) => 1 - (1 - t) ** 3;
