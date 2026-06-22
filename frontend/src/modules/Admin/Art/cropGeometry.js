// Pure geometry for the crop editor: clamp a band and convert between handle
// pixel offsets (within the displayed image) and margin percentages of height.

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const r2 = (n) => Number(n.toFixed(2));

// Keep each margin in [0,90]; if they'd keep <10% of height, shrink `bottom`.
export function clampBand({ top, bottom }) {
  let t = clamp(Number(top) || 0, 0, 90);
  let b = clamp(Number(bottom) || 0, 0, 90);
  if (t + b > 90) b = 90 - t;
  return { top: r2(t), bottom: r2(b) };
}

// Handle pixel offsets (from the top / from the bottom of the displayed image) → %.
export function pxToBand({ topPx, bottomPx }, imageHeightPx) {
  const h = imageHeightPx || 1;
  return clampBand({ top: (topPx / h) * 100, bottom: (bottomPx / h) * 100 });
}

// % margins → handle pixel offsets within a displayed image of imageHeightPx.
export function bandToPx({ top, bottom }, imageHeightPx) {
  const h = imageHeightPx || 1;
  return { topPx: r2((top / 100) * h), bottomPx: r2((bottom / 100) * h) };
}

export default { clampBand, pxToBand, bandToPx };
