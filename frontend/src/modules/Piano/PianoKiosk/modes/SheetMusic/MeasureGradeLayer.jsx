import React from 'react';

/**
 * MeasureGradeLayer — translucent red/yellow/green wash over each graded measure
 * for Sheet Music "Polish" mode. Pure/presentational: given the measure spans,
 * per-step geometry boxes, and a grades map, it draws one absolutely-positioned
 * rect per graded measure spanning that measure's steps at their vertical extent.
 *
 * Geometry is passed in (never read from OSMD) so the layer is fully testable:
 * `stepBoxes[i] = { x, top, bottom }` is the cursor box for step `i` (same
 * offset-space as the cursor / NoteHighlightLayer). Non-interactive (CSS
 * `pointer-events: none`); left/top/width/height are set inline.
 *
 * @param {object} p
 * @param {Array<{index:number, firstStep:number, lastStep:number}>} [p.measures]
 * @param {Array<{x:number, top:number, bottom:number}>} [p.stepBoxes]
 * @param {Object<number,{grade:'green'|'yellow'|'red'}>} [p.grades]
 */
export default function MeasureGradeLayer({ measures = [], stepBoxes = [], grades = {} }) {
  const rects = [];
  for (const m of measures) {
    const g = grades[m.index];
    if (!g?.grade) continue; // ungraded measure — no wash
    const first = stepBoxes[m.firstStep];
    const last = stepBoxes[m.lastStep];
    if (!first || !last) continue; // geometry not reported (mid re-engrave) — skip

    let top = Infinity;
    let bottom = -Infinity;
    for (let i = m.firstStep; i <= m.lastStep; i++) {
      const b = stepBoxes[i];
      if (!b) continue;
      if (b.top < top) top = b.top;
      if (b.bottom > bottom) bottom = b.bottom;
    }
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;

    const left = first.x;
    const width = Math.max(last.x - first.x, 8); // single-step measure → a small band
    rects.push(
      <div
        key={m.index}
        className={`piano-score-measure-grade piano-score-measure-grade--${g.grade}`}
        style={{ left, top, width, height: bottom - top }}
      />,
    );
  }
  return <>{rects}</>;
}
