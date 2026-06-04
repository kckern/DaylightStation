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

export default { nextZoomLevel };
