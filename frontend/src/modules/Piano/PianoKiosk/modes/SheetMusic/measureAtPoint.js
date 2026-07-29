/**
 * measureAtPoint — armed-tap hit-testing (wave-3 F): any x within a system
 * resolves to the nearest measure's column; only dead margins (outside every
 * system's vertical band) reject. Unlike the retired two-tap flow there is no
 * near-a-note radius — endpoint picking is a coarse gesture, so a tap in the
 * whitespace after the last note of a system still commits that measure instead
 * of being silently swallowed.
 *
 * Coordinates are renderer-local (the same space `events[].x/top/bottom` live
 * in). `slack` widens each system's band so a tap just above/below the staves
 * still counts; scale it with the engrave zoom at the call site.
 *
 * @param {object} p
 * @param {Array}  p.events    - [{ x, top, bottom }] per melody step, in step order
 * @param {Array}  p.measures  - [{ index, firstStep, lastStep }]
 * @param {number} p.x
 * @param {number} p.y
 * @param {number} [p.slack=40]
 * @returns {number} measure INDEX, or -1 for a dead margin / no geometry
 */
export function measureAtPoint({ events = [], measures = [], x, y, slack = 40 }) {
  let bestI = -1;
  let bestD = Infinity;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (y < e.top - slack || y > e.bottom + slack) continue; // other system / margin
    const d = Math.abs(x - e.x);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  if (bestI < 0) return -1;
  const m = measures.findIndex((mm) => bestI >= mm.firstStep && bestI <= mm.lastStep);
  return m < 0 ? -1 : m;
}

export default measureAtPoint;
