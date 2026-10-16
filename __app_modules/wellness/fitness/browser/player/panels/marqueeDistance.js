/**
 * How far (px, negative = leftwards) the track-title marquee scrolls.
 *
 * A container with no width is hidden, not narrow: the sidebar collapses to
 * width 0 in fullscreen while the music keeps playing. Measuring it there made
 * the whole text width the "overflow", so after leaving fullscreen even a short
 * title slid entirely out of view. A hidden box gets no scroll; the caller
 * re-measures when it is shown again.
 */
export function marqueeScrollDistance(containerWidth, textWidth) {
  if (!(containerWidth > 0) || !(textWidth > 0)) return 0;
  const overflow = textWidth - containerWidth;
  return overflow > 0 ? -overflow : 0;
}
