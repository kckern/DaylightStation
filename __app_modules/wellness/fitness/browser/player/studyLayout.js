/**
 * Study-mode video sizing.
 *
 * Workout mode sizes video from WIDTH first (viewport minus sidebar, at 16:9) and gives
 * the footer whatever height is left over — which on a 16:9 display is nearly nothing.
 * Study mode inverts that: reserve the footer band first, clamp video height to what
 * remains, then derive width. The sidebar is not reserved at all (there is no workout to
 * monitor), so the video gets the full width budget.
 */
const DEFAULT_FOOTER_RATIO = 0.2;

export function computeStudyDims({ totalW, totalH, footerRatio }) {
  const w = Number.isFinite(totalW) && totalW > 0 ? totalW : 0;
  const h = Number.isFinite(totalH) && totalH > 0 ? totalH : 0;
  if (w === 0 || h === 0) return { videoW: 0, videoH: 0, footerHeight: 0 };

  const ratio = Number.isFinite(footerRatio) && footerRatio > 0 && footerRatio < 1
    ? footerRatio
    : DEFAULT_FOOTER_RATIO;

  const footerHeight = Math.round(h * ratio);
  let videoH = h - footerHeight;
  let videoW = Math.round(videoH * 16 / 9);

  // Narrow viewport: width binds instead, so re-derive height from it.
  if (videoW > w) {
    videoW = w;
    videoH = Math.round(videoW * 9 / 16);
  }

  return { videoW: Math.max(0, videoW), videoH: Math.max(0, Math.round(videoH)), footerHeight };
}

export default computeStudyDims;
