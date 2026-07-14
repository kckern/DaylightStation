import React from 'react';

/**
 * FocusRangeLayer — draws the active practice range on the score: a translucent
 * tint over the range's steps plus a bracket at each end, so the range is visible
 * where it matters (on the music), not just as a bar readout (audit J5/M3). While
 * the user is selecting, a single `pending` bracket marks the tapped first measure.
 *
 * Geometry is passed in (same offset-space as the cursor / MeasureGradeLayer), so
 * this is pure/testable. Non-interactive (CSS pointer-events: none).
 *
 * @param {object} p
 * @param {Array<{index:number, firstStep:number, lastStep:number}>} [p.measures]
 * @param {Array<{x:number, top:number, bottom:number}>} [p.stepBoxes]
 * @param {{inMeasure:number, outMeasure:number}} [p.range] - committed range
 * @param {number} [p.pending] - measure index tapped as the range's first end
 */
function measureExtent(m, stepBoxes) {
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

export default function FocusRangeLayer({ measures = [], stepBoxes = [], range = null, pending = null }) {
  // Pending (mid-selection): one bracket on the tapped first measure.
  if (range == null && pending != null) {
    const m = measures[pending];
    const ext = m && measureExtent(m, stepBoxes);
    if (!ext) return null;
    return (
      <div
        className="piano-score-range-bracket piano-score-range-bracket--pending"
        style={{ left: ext.left - 4, top: ext.top, height: ext.bottom - ext.top }}
      />
    );
  }

  if (!range) return null;
  const inM = measures[range.inMeasure];
  const outM = measures[range.outMeasure];
  const inExt = inM && measureExtent(inM, stepBoxes);
  const outExt = outM && measureExtent(outM, stepBoxes);
  if (!inExt || !outExt) return null;

  const left = Math.min(inExt.left, outExt.left);
  const right = Math.max(inExt.right, outExt.right);
  const top = Math.min(inExt.top, outExt.top);
  const bottom = Math.max(inExt.bottom, outExt.bottom);

  return (
    <>
      <div
        className="piano-score-range-tint"
        style={{ left, top, width: Math.max(right - left, 8), height: bottom - top }}
      />
      <div className="piano-score-range-bracket" style={{ left: inExt.left - 4, top: inExt.top, height: inExt.bottom - inExt.top }} />
      <div className="piano-score-range-bracket" style={{ left: outExt.right + 1, top: outExt.top, height: outExt.bottom - outExt.top }} />
    </>
  );
}
