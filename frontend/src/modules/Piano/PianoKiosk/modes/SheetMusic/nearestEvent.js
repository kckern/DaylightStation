/**
 * nearestEvent — nearest melody event to a tap at renderer-local (x, y). Y is
 * down-weighted (x dominates within a system). With `maxDist`, taps farther than
 * that (weighted px, at scale 1) from every event return -1.
 *
 * Every live caller is a SEEK tap and passes no maxDist: tap-anywhere-to-seek is
 * intentional. The guided loop selection that needed a radius is retired — wave-3
 * F reversed audit L3, hit-testing an armed endpoint tap by measure column
 * (measureAtPoint) instead, so only a dead margin is refused. The parameter stays
 * because "nearest, but not absurdly far" is the harder half to get right and is
 * worth keeping proven for the next caller that needs it.
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

export default nearestEvent;
