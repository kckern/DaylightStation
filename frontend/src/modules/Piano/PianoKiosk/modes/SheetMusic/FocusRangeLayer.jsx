import React from 'react';

/**
 * FocusRangeLayer — draws the active practice range on the score as a translucent
 * tint band per engraved system, so the range is visible where it matters (on the
 * music), not just as a bar readout (audit J5/M3).
 *
 * The range's ENDS are not drawn here: since wave-3 F they are the draggable
 * handles of {@link RangeHandleLayer}, which is both the boundary visual and the
 * way to move it — two things drawing one boundary would only disagree. The
 * retired two-tap flow's `pending` bracket is gone with the same wave: an endpoint
 * commits a real one-measure range, so there is never a half-marked range.
 *
 * `marks` are section boundaries (measure indices) shown as thin ticks while the
 * user is choosing an endpoint — the parent passes `[]` the rest of the time, so
 * the landmarks a commit SNAPS to appear exactly when they are actionable.
 *
 * Geometry is passed in (same offset-space as the cursor / MeasureGradeLayer), so
 * this is pure/testable. Non-interactive (CSS pointer-events: none).
 *
 * @param {object} p
 * @param {Array<{index:number, firstStep:number, lastStep:number}>} [p.measures]
 * @param {Array<{x:number, top:number, bottom:number}>} [p.stepBoxes]
 * @param {{inMeasure:number, outMeasure:number}} [p.range] - committed range
 * @param {number[]} [p.marks] - measure indices to tick (section boundaries)
 */
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
 */
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
  return bands;
}

export default function FocusRangeLayer({ measures = [], stepBoxes = [], range = null, marks = [] }) {
  // Section ticks are independent of the range: they are the landmarks a commit
  // snaps to, so they must be drawable while an endpoint is being chosen on a
  // score that has no range yet.
  const ticks = marks.map((m) => {
    const ext = measures[m] && measureExtent(measures[m], stepBoxes);
    return ext ? (
      <div
        key={`mark-${m}`}
        className="piano-score-section-mark"
        style={{ left: ext.left - 2, top: ext.top, height: ext.bottom - ext.top }}
      />
    ) : null;
  }).filter(Boolean);

  const inM = range && measures[range.inMeasure];
  const outM = range && measures[range.outMeasure];
  const inExt = inM && measureExtent(inM, stepBoxes);
  const outExt = outM && measureExtent(outM, stepBoxes);
  if (!inExt || !outExt) return ticks.length ? <>{ticks}</> : null;

  return (
    <>
      {rangeBands(measures, stepBoxes, range).map((band, i) => (
        <div
          key={i}
          className="piano-score-range-tint"
          style={{ left: band.left, top: band.top, width: Math.max(band.right - band.left, 8), height: band.bottom - band.top }}
        />
      ))}
      {ticks}
    </>
  );
}
