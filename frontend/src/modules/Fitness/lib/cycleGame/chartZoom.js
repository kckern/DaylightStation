// Stepped zoom-out "camera" math for the race distance chart. Pure, no DOM.
//
// The chart shows a window T = xBaseS·2^L (time) and D = yBaseM·2^L (distance).
// nextZoomLevel returns the smallest level L >= prevLevel that keeps BOTH the
// leader's distance and the elapsed time under `threshold` of their windows — so
// the window doubles in 2x steps as the data approaches the edges, and never
// re-tightens mid-race (monotonic).
export function nextZoomLevel(prevLevel, { leaderDistanceM = 0, elapsedS = 0, xBaseS = 30, yBaseM = 250, threshold = 0.9 } = {}) {
  let L = Math.max(0, Math.floor(Number.isFinite(prevLevel) ? prevLevel : 0));
  const fits = (lvl) => {
    const T = xBaseS * 2 ** lvl;
    const D = yBaseM * 2 ** lvl;
    return elapsedS < threshold * T && leaderDistanceM < threshold * D;
  };
  let guard = 0;
  while (!fits(L) && guard < 32) { L += 1; guard += 1; }
  return L;
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

export default { nextZoomLevel, gridUnit, gridValues };
