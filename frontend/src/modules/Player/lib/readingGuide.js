// Reading-guide position math for ContentScroller.
//
// The scroller's model maps playback linearly onto the text: the line being
// narrated at progress fraction p sits at y = p * narratableHeight in content
// coordinates, and the panel shows content from yOffset down. The guide marker
// therefore sits at (p * narratableHeight - yOffset) in panel coordinates.
//
// narratableHeight is the text block WITHOUT its bottom run-out padding — the
// padding exists so the last verse never touches the panel edge at the end of
// playback, but no narration happens inside it, so including it would make the
// marker run ahead of the voice by the full padding height at p=1.

/**
 * @param {object} args
 * @param {number} args.progressFraction currentTime / duration, 0..1
 * @param {number} args.narratableHeight text height in px, excluding run-out padding
 * @param {number} args.yOffset current scroll offset of the content in px
 * @param {number} args.panelHeight visible panel height in px
 * @param {number} [args.markerHeight] marker box height in px (keeps it on-panel)
 * @returns {number|null} top in px within the panel, or null when unplottable
 */
export function computeReadingGuideTop({
  progressFraction,
  narratableHeight,
  yOffset,
  panelHeight,
  markerHeight = 28
}) {
  if (!Number.isFinite(progressFraction)
    || !Number.isFinite(narratableHeight)
    || !Number.isFinite(panelHeight)) return null;
  if (narratableHeight <= 0 || panelHeight <= 0) return null;
  const p = Math.max(0, Math.min(1, progressFraction));
  const offset = Number.isFinite(yOffset) ? yOffset : 0;
  const raw = p * narratableHeight - offset;
  return Math.max(0, Math.min(Math.max(0, panelHeight - markerHeight), raw));
}

export default computeReadingGuideTop;
