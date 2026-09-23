/** Largest integer font size in [min, max] whose measure fits (spec §6 Text fitting). Pure. */
export function fitFontSize({ measure, min, max }) {
  if (!measure(min).fits) return { px: min, clamped: true };
  let lo = min; let hi = max;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(mid).fits) lo = mid; else hi = mid - 1;
  }
  return { px: lo, clamped: false };
}
