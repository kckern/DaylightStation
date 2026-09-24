/**
 * cumulativeGuard — a cumulative series (rings, beats, rotations) can only grow.
 *
 * If one ever dips, something upstream moved data without its running counter
 * (the 2026-09-23 split: 88 → 1 on one child, 1 → 89 on another). Flatten the
 * dip so the saved file and every chart stay monotonic, and report it so the
 * cause shows up in the log store instead of as a falling chart line.
 */
const CUMULATIVE_KEY = /(:rings_total|:heart_beats|:rotations|^global:rings_total)$/;

/**
 * @param {Object<string, Array>} series - live-keyed timeline series (mutated)
 * @returns {Array<{ key: string, tick: number, drop: number }>} first dip per key
 */
export function flattenCumulativeRegressions(series) {
  const found = [];
  if (!series || typeof series !== 'object') return found;
  for (const key of Object.keys(series)) {
    if (!CUMULATIVE_KEY.test(key)) continue;
    const arr = series[key];
    if (!Array.isArray(arr)) continue;
    let max = null;
    let reported = false;
    for (let i = 0; i < arr.length; i += 1) {
      const v = arr[i];
      if (!Number.isFinite(v)) continue;
      if (max != null && v < max) {
        if (!reported) {
          found.push({ key, tick: i, drop: Math.round((max - v) * 10) / 10 });
          reported = true;
        }
        arr[i] = max;
      } else {
        max = v;
      }
    }
  }
  return found;
}

export default flattenCumulativeRegressions;
