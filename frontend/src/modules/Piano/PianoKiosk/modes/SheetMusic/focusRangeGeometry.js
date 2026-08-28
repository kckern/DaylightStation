// focusRangeGeometry.js — measure/range geometry for FocusRangeLayer.jsx (and
// RangeHandleLayer.jsx, which shares the measure-extent math for its drag
// handles), split out so Fast Refresh can hot-reload the layer on its own.

export function measureExtent(m, stepBoxes) {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (let i = m.firstStep; i <= m.lastStep; i++) {
    const b = stepBoxes[i];
    if (!b) continue;
    if (b.x < left) left = b.x;
    if (b.x > right) right = b.x;
    if (b.top < top) top = b.top;
    if (b.bottom > bottom) bottom = b.bottom;
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { left, right, top, bottom };
}

/**
 * Band rectangles for a measure range, one per engraved system. A step whose x
 * is LOWER than its predecessor starts a new system (wrapped-flow line break);
 * horizontal flow never resets x, so it always yields a single band. Covers
 * every step in the range — not just the endpoint measures (audit L4).
 *
 * The band's OUTER edges reach past the first and last notes, to roughly where
 * the barline sits. Step boxes carry a note's CENTRE, so anchoring the band on
 * them cut the endpoint noteheads in half — the range appeared to slice through
 * the very notes it was asking you to play. Each outer edge now stops midway to
 * the neighbouring note outside the range, which is where the barline falls when
 * notes are evenly spaced and is always at least clear of the notehead itself.
 * With no neighbour to measure against (the music starts or ends there) it falls
 * back to half the range's own median gap.
 */
const EDGE_FALLBACK_PX = 12;

function halfGapTo(stepBoxes, from, to) {
  const a = stepBoxes[from];
  const b = stepBoxes[to];
  // A neighbour on ANOTHER system is not adjacent in space, only in time — its x
  // runs backwards, so measuring to it would pull the edge the wrong way.
  if (!a || !b) return null;
  const gap = Math.abs(b.x - a.x);
  return gap > 0 ? gap / 2 : null;
}

export function rangeBands(measures, stepBoxes, { inMeasure, outMeasure }) {
  const inM = measures[inMeasure];
  const outM = measures[outMeasure];
  if (!inM || !outM) return [];
  const bands = [];
  let cur = null;
  let prevX = -Infinity;
  for (let i = inM.firstStep; i <= outM.lastStep; i++) {
    const b = stepBoxes[i];
    if (!b) continue;
    if (!cur || b.x < prevX) {
      cur = { left: b.x, right: b.x, top: b.top, bottom: b.bottom };
      bands.push(cur);
    } else {
      if (b.x < cur.left) cur.left = b.x;
      if (b.x > cur.right) cur.right = b.x;
      if (b.top < cur.top) cur.top = b.top;
      if (b.bottom > cur.bottom) cur.bottom = b.bottom;
    }
    prevX = b.x;
  }
  if (!bands.length) return bands;

  // Push the outer edges out to the barline. Inner edges of a wrapped range are
  // system breaks, not boundaries of the range, so they are left alone.
  const lo = inM.firstStep;
  const hi = outM.lastStep;
  const first = bands[0];
  const last = bands[bands.length - 1];
  const leftPad = (stepBoxes[lo - 1] && stepBoxes[lo - 1].x < stepBoxes[lo]?.x)
    ? halfGapTo(stepBoxes, lo, lo - 1)
    : null;
  const rightPad = (stepBoxes[hi + 1] && stepBoxes[hi + 1].x > stepBoxes[hi]?.x)
    ? halfGapTo(stepBoxes, hi, hi + 1)
    : null;
  first.left -= leftPad ?? EDGE_FALLBACK_PX;
  last.right += rightPad ?? EDGE_FALLBACK_PX;
  return bands;
}

