// Continuous zoom-out "camera" math for the race distance chart. Pure, no DOM.
//
// The chart used to grow its window in stepped 2× doublings (a `nextZoomLevel`
// integer level → window = base·2^L). Those doublings rug-pulled every lane to
// half height once per threshold crossing (audit UX 2.6/2.7). The window now
// grows CONTINUOUSLY with the data via `continuousWindow`, so past points drift
// smoothly instead of snapping. (Distance races don't zoom Y at all — the Y
// window is pinned to the goal; only the time axis, and a time race's distance
// axis, use this.)

// continuousWindow: the visible span that keeps `dataMax` at `fillFrac` of the
// window, never smaller than `base`. Because data (elapsed time / leader
// distance) is monotonic, the returned span is monotonic too — the camera only
// ever zooms OUT, in tiny per-tick increments, never in 2× jumps.
export function continuousWindow(dataMax, { base = 150, fillFrac = 0.85 } = {}) {
  const d = Number.isFinite(dataMax) && dataMax > 0 ? dataMax : 0;
  const b = Number.isFinite(base) && base > 0 ? base : 1;
  const frac = fillFrac > 0 && fillFrac <= 1 ? fillFrac : 0.85;
  return Math.max(b, d / frac);
}

// gridUnit: gridline spacing in data units = baseUnit·2^k, the smallest k whose
// on-screen spacing (pxSpan · unit/windowSpan) >= minPx. Coarsens as the window
// grows so lines never crowd below minPx (a "bottom cap" — drops the dense level).
export function gridUnit(windowSpan, pxSpan, baseUnit = 250, minPx = 32) {
  const span = Number(windowSpan) > 0 ? Number(windowSpan) : baseUnit;
  let k = 0, guard = 0;
  while (((baseUnit * 2 ** k) / span) * pxSpan < minPx && guard < 32) { k += 1; guard += 1; }
  return baseUnit * 2 ** k;
}

// gridValues: ascending data values [0, unit, 2·unit, … <= windowSpan] at the
// decimated unit — used for both the X (time) and Y (distance) gridlines.
export function gridValues(windowSpan, baseUnit, pxSpan, minPx = 32) {
  const span = Number(windowSpan) > 0 ? Number(windowSpan) : baseUnit;
  const unit = gridUnit(span, pxSpan, baseUnit, minPx);
  const out = [];
  for (let v = 0; v <= span + 1e-6 && out.length < 256; v += unit) out.push(Math.round(v));
  return out;
}

// pickAxisTicks: down-sample a sorted gridline-value array to at most `maxCount`
// LABELS, always keeping the first and last so the axis is anchored at both ends.
// Used to place 2-3 readable HTML axis labels on the gridlines (audit UX 2.1).
export function pickAxisTicks(values, maxCount = 3) {
  const vals = Array.isArray(values) ? values.filter((v) => Number.isFinite(v)) : [];
  const dedupe = (arr) => arr.filter((v, i) => arr.indexOf(v) === i);
  if (vals.length <= maxCount) return dedupe(vals);
  const n = Math.max(2, maxCount);
  const step = (vals.length - 1) / (n - 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push(vals[Math.round(i * step)]);
  return dedupe(out);
}

export default { continuousWindow, gridUnit, gridValues, pickAxisTicks };
