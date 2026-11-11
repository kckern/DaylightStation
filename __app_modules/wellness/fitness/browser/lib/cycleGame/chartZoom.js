// Continuous zoom-out "camera" math for the race distance chart. Pure, no DOM.
//
// The chart used to grow its window in stepped 2× doublings (a `nextZoomLevel`
// integer level → window = base·2^L). Those doublings rug-pulled every lane to
// half height once per threshold crossing (audit UX 2.6/2.7). The window now
// grows CONTINUOUSLY with the data via `continuousWindow`, so past points drift
// smoothly instead of snapping. (Distance races don't zoom Y at all — the Y
// window is pinned to the goal — and time races show the whole race on X; only
// a distance race's time axis and a time race's distance axis use this.)

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

/**
 * Evenly spaced chart gridlines and axis labels, including both ends
 * (DistanceChart: 5 gridlines, a label on every other one) (no float noise past ~1e-12).
 * @param {number} min first tick
 * @param {number} max last tick (may be below min; order is kept)
 * @param {number} count number of ticks, floored; 1 gives [min]
 * @returns {number[]} ticks; [] when count < 1 or any input is non-finite
 */
export function evenTicks(min, max, count) {
  const n = Math.floor(count);
  if (!Number.isFinite(n) || n < 1 || !Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (n === 1) return [min];
  const step = (max - min) / (n - 1);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? max : Math.round((min + i * step) * 1e9) / 1e9));
}

/**
 * Smallest "round" value >= v: 1, 2, 2.5 or 5 times a power of ten. Snapping a
 * chart window's ceiling to this makes its end and midpoint labels round
 * (512 m -> 1000 m labelled 0 / 500 m / 1.0 km).
 * @param {number} v
 * @returns {number} 0 for a non-finite or non-positive input
 */
export function niceCeil(v) {
  if (!Number.isFinite(v) || v <= 0) return 0;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  // Compare in units of `base` with a small tolerance so 1000 stays 1000.
  const m = v / base;
  const step = [1, 2, 2.5, 5, 10].find((k) => m <= k + 1e-9);
  return Math.round(step * base * 1e9) / 1e9;
}

/**
 * Smallest round time window (seconds) >= s, for an x axis labelled at 0, s/2, s:
 * whole minutes up to 10 min, then 5-minute steps up to an hour, then 30-minute
 * steps. A distance race's open-ended time axis uses this so its labels read
 * 0:00 / 2:00 / 4:00 rather than 0:00 / 2:04 / 4:07.
 * @param {number} s
 * @returns {number} 0 for a non-finite or non-positive input
 */
export function niceCeilTime(s) {
  if (!Number.isFinite(s) || s <= 0) return 0;
  const unit = s <= 600 ? 60 : (s <= 3600 ? 300 : 1800);
  return Math.ceil(s / unit - 1e-9) * unit;
}

export default { continuousWindow, evenTicks, niceCeil, niceCeilTime };
