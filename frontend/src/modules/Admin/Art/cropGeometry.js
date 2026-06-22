// Pure geometry for the crop editor: clamp a band and convert between handle
// pixel offsets (within the displayed image) and margin percentages of height.

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const r2 = (n) => Number(n.toFixed(2));

// Clamp two opposing margins to [0,90] keeping ≥10% between them (shrink the second).
export function clampPair(a, b) {
  const x = clamp(Number(a) || 0, 0, 90);
  let y = clamp(Number(b) || 0, 0, 90);
  if (x + y > 90) y = 90 - x;
  return [r2(x), r2(y)];
}

// Keep each margin in [0,90]; if they'd keep <10% of height, shrink `bottom`.
export function clampBand({ top, bottom }) {
  const [t, b] = clampPair(top, bottom);
  return { top: t, bottom: b };
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

export default { clampBand, clampPair, pxToBand, bandToPx };
