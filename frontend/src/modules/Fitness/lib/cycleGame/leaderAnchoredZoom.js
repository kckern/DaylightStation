// Leader-anchored spatial zoom for the race panels (piston chart + camera).
//
// The 1st-place rider is pinned near the right edge; a rider `g` metres behind sits
// at `rightPct − g·k`, where k is "width-fraction per metre" (the zoom). k is HELD
// between rezooms, so as gaps change riders physically slide within the frame —
// falling behind drifts you left, gaining pulls you right. The LAST-place rider is
// the zoom anchor: its home is `homePct`; when it drifts out of the hysteresis band
// [lowPct, highPct] the view rezooms (k recomputed) to put it back at homePct.
// A fixed-metre grid at the current k makes the scale legible (density = zoom level).

export const ZOOM_DEFAULTS = {
  rightPct: 0.88, // 1st place pinned here (padding for the avatar to the right)
  homePct: 0.25,  // last place's resting position after a rezoom
  lowPct: 0.15,   // last place drifts left past this (gap grew) → zoom out
  highPct: 0.33,  // last place pushes right past this (gap shrank) → zoom in
  minGapM: 8,     // clamp so a near-zero field gap doesn't blow k up to infinity
  maxLines: 80    // interval-doubling cap: coarsen gridM until span fits in this many lines
};

// Round to a "nice" 1/2/5 ×10ⁿ value (grid intervals, so the scale reads cleanly).
export function niceRound(x) {
  if (!(x > 0) || !isFinite(x)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / p;
  const n = f <= 1.5 ? 1 : f <= 3.5 ? 2 : f <= 7.5 ? 5 : 10;
  return n * p;
}

// Decide k for this tick. Recompute (rezoom) only when last place leaves the band;
// otherwise hold prevK so the leader stays pinned and riders slide within the frame.
export function stepZoom(prevK, leaderDistM, lastDistM, cfg = {}) {
  const { rightPct, homePct, lowPct, highPct, minGapM } = { ...ZOOM_DEFAULTS, ...cfg };
  const gap = Math.max(0, (leaderDistM || 0) - (lastDistM || 0));
  const fresh = (rightPct - homePct) / Math.max(gap, minGapM); // puts last place at homePct
  if (!(prevK > 0) || !isFinite(prevK)) return fresh;          // first tick / invalid
  const lastX = rightPct - gap * prevK;                        // where last place sits now
  if (lastX < lowPct || lastX > highPct) return fresh;          // out of band → rezoom
  return prevK;                                                 // in band → hold the zoom
}

// x in [0,1] for a rider at distM, leader pinned at rightPct.
export function xForDist(distM, leaderDistM, kFrac, cfg = {}) {
  const { rightPct } = { ...ZOOM_DEFAULTS, ...cfg };
  return rightPct - ((leaderDistM || 0) - (distM || 0)) * kFrac;
}

// Choose a nice metre interval so a grid cell is ~targetFrac of the width. Steps up
// as you zoom out, so the grid stays legible while its density reads the zoom level.
export function pickGridMeters(kFrac, targetFrac = 0.085) {
  if (!(kFrac > 0) || !isFinite(kFrac)) return 10;
  return niceRound(targetFrac / kFrac);
}

// Visible world-metre grid lines (keyed by metre value so they reconcile/glide as
// the leader advances). Returns [{ m, x }] with x in [~0, rightPct].
export function gridLines(leaderDistM, kFrac, gridM, cfg = {}) {
  const { rightPct, maxLines = 80 } = { ...ZOOM_DEFAULTS, ...cfg };
  if (!(kFrac > 0) || !(gridM > 0) || !isFinite(kFrac)) return [];
  const leftMeters = rightPct / kFrac;            // metres from the leader-pin to x=0
  // Coarsen the interval (x2 multiples of gridM) until the whole span fits in maxLines —
  // covers the full road instead of truncating one edge.
  let step = gridM;
  while (leftMeters / step > maxLines) step *= 2;
  const startM = Math.ceil(((leaderDistM || 0) - leftMeters) / step) * step;
  const lines = [];
  for (let m = startM; m <= (leaderDistM || 0) + step; m += step) {
    const x = rightPct - ((leaderDistM || 0) - m) * kFrac;
    if (x >= -0.02 && x <= rightPct + 0.02) lines.push({ m: Math.round(m), x });
  }
  return lines;
}
