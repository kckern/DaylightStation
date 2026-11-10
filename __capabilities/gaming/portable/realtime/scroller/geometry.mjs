/** Axis-aligned boxes, y down. Pure; no clocks, no randomness. */
export function box(x0, x1, y0, y1) {
  return Object.freeze({ x0, x1, y0, y1 });
}

function axisOverlaps(aLo, aHi, bLo, bHi, mode) {
  return mode === 'closed' ? aLo <= bHi && aHi >= bLo : aLo < bHi && aHi > bLo;
}

/** Per-axis edge mode: 'open' (touching does not overlap) or 'closed' (it does). */
export function overlaps(a, b, { x = 'open', y = 'open' } = {}) {
  return axisOverlaps(a.x0, a.x1, b.x0, b.x1, x) && axisOverlaps(a.y0, a.y1, b.y0, b.y1, y);
}

/** Boxes the sweep touches, in input order; `at` is where along x the contact starts. */
export function sweepHits(boxes, sweep, { x = 'closed', y = 'closed', include = () => true } = {}) {
  const hits = [];
  boxes.forEach((b, index) => {
    if (include(b, index) && overlaps(sweep, b, { x, y })) {
      hits.push({ index, at: Math.max(sweep.x0, b.x0) });
    }
  });
  return hits;
}
