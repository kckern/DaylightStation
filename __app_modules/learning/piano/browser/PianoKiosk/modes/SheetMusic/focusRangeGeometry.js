// focusRangeGeometry.js — measure/range geometry for FocusRangeLayer.jsx (and
// RangeHandleLayer.jsx, which shares the measure-extent math for its drag
// handles), split out so Fast Refresh can hot-reload the layer on its own.

export function measureExtent(m, stepBoxes, measureRect = null) {
  if (measureRect && Number.isFinite(measureRect.left) && Number.isFinite(measureRect.right)) return measureRect;
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

/** Join OSMD barline bounds to a full-system notation envelope. */
export function buildEngravedMeasureRects(measures = [], bounds = [], staffBoxes = [], steps = [], stepBoxes = []) {
  const rects = measures.map((measure, index) => {
    const box = bounds[measure.index ?? index] || bounds[index];
    if (!box || !Number.isFinite(box.left) || !Number.isFinite(box.right) || box.right <= box.left) return null;
    const staff = staffBoxes.find((item) => box.top <= item.top + item.lineSpacing * 4 && box.bottom >= item.top);
    return { ...box, system: staff?.system ?? 0 };
  });
  const envelopes = new Map();
  for (const staff of staffBoxes) {
    const span = envelopes.get(staff.system) || { top: Infinity, bottom: -Infinity, pad: staff.lineSpacing || 10 };
    span.top = Math.min(span.top, staff.top);
    span.bottom = Math.max(span.bottom, staff.top + 4 * (staff.lineSpacing || 10));
    envelopes.set(staff.system, span);
  }
  rects.forEach((rect, index) => {
    if (!rect) return;
    const span = envelopes.get(rect.system) || { top: Infinity, bottom: -Infinity, pad: 10 };
    span.top = Math.min(span.top, rect.top);
    span.bottom = Math.max(span.bottom, rect.bottom);
    const measure = measures[index];
    for (let i = measure.firstStep; i <= measure.lastStep; i++) {
      for (const note of steps[i]?.notes || []) {
        if (Number.isFinite(note.top)) span.top = Math.min(span.top, note.top);
        if (Number.isFinite(note.bottom)) span.bottom = Math.max(span.bottom, note.bottom);
      }
      const cursor = stepBoxes[i];
      if (cursor) {
        span.top = Math.min(span.top, cursor.top);
        span.bottom = Math.max(span.bottom, cursor.bottom);
      }
    }
    envelopes.set(rect.system, span);
  });
  return rects.map((rect) => {
    if (!rect) return null;
    const span = envelopes.get(rect.system);
    return { ...rect, top: span.top - span.pad, bottom: span.bottom + span.pad };
  });
}

export function measureAtPosition(rects = [], x, y) {
  return rects.findIndex((rect) => rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
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

export function rangeBands(measures, stepBoxes, { inMeasure, outMeasure }, measureRects = []) {
  const inM = measures[inMeasure];
  const outM = measures[outMeasure];
  if (!inM || !outM) return [];
  if (measureRects.length && measures.slice(inMeasure, outMeasure + 1).every((_, offset) => measureRects[inMeasure + offset])) {
    const bands = [];
    for (let i = inMeasure; i <= outMeasure; i++) {
      const rect = measureRects[i];
      let band = bands[bands.length - 1];
      if (!band || rect.system !== band.system || rect.left < band.left) {
        band = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, system: rect.system };
        bands.push(band);
      } else {
        band.left = Math.min(band.left, rect.left);
        band.right = Math.max(band.right, rect.right);
        band.top = Math.min(band.top, rect.top);
        band.bottom = Math.max(band.bottom, rect.bottom);
      }
    }
    return bands.map(({ left, right, top, bottom }) => ({ left, right, top, bottom }));
  }
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

const NOTATION_PAD_PX = 12;

/**
 * Learn selection geometry keeps OSMD's exact barline edges, but avoids using
 * its full system-height hit rectangles as visible chrome. The latter include
 * inter-system whitespace and made short passages look vertically displaced.
 */
export function notationRangeBands(measures, stepBoxes, range, measureRects = []) {
  const bands = [];
  for (let measureIndex = range.inMeasure; measureIndex <= range.outMeasure; measureIndex++) {
    const measure = measures[measureIndex];
    if (!measure) continue;
    const boxes = [];
    for (let step = measure.firstStep; step <= measure.lastStep; step++) {
      if (stepBoxes[step]) boxes.push(stepBoxes[step]);
    }
    // A rest-only system has no selected notation to outline. Suppressing it is
    // preferable to resurrecting the oversized full-system envelope.
    if (!boxes.length) continue;

    const rect = measureRects[measureIndex];
    const hasBarlines = rect && Number.isFinite(rect.left) && Number.isFinite(rect.right) && rect.right > rect.left;
    const extent = {
      left: hasBarlines ? rect.left : Math.min(...boxes.map((box) => box.x)) - EDGE_FALLBACK_PX,
      right: hasBarlines ? rect.right : Math.max(...boxes.map((box) => box.x)) + EDGE_FALLBACK_PX,
      top: Math.min(...boxes.map((box) => box.top)),
      bottom: Math.max(...boxes.map((box) => box.bottom)),
      system: hasBarlines && rect.system != null ? rect.system : null,
    };
    const prior = bands[bands.length - 1];
    const verticalOverlap = prior && extent.top <= prior.bottom && extent.bottom >= prior.top;
    const sameSystem = prior && prior.system != null && extent.system != null
      ? prior.system === extent.system
      : verticalOverlap;
    if (!sameSystem) {
      bands.push(extent);
      continue;
    }
    prior.left = Math.min(prior.left, extent.left);
    prior.right = Math.max(prior.right, extent.right);
    prior.top = Math.min(prior.top, extent.top);
    prior.bottom = Math.max(prior.bottom, extent.bottom);
    if (prior.system == null) prior.system = extent.system;
  }
  return bands.map(({ left, right, top, bottom }) => ({
    left,
    right,
    top: top - NOTATION_PAD_PX,
    bottom: bottom + NOTATION_PAD_PX,
  }));
}
