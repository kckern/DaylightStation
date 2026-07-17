/**
 * nearestEvent — nearest melody event to a tap at renderer-local (x, y). Y is
 * down-weighted (x dominates within a system). With `maxDist`, taps farther than
 * that (weighted px, at scale 1) from every event return -1 — used by the guided
 * loop selection so a stray margin tap can't silently commit a far-away measure
 * (audit L3). Seek taps pass no maxDist: tap-anywhere-to-seek is intentional.
 */
export function nearestEvent(events, x, y, maxDist = Infinity) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const midY = (e.top + e.bottom) / 2;
    const d = Math.hypot(x - e.x, (y - midY) * 0.45);
    if (d < bestD) { bestD = d; best = i; }
  }
  return bestD <= maxDist ? best : -1;
}

/** Max weighted distance (px at scale 1) a SELECTION tap may be from a note. */
export const SELECT_MAX_DIST = 90;

export default nearestEvent;
