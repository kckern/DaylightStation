/**
 * previewFrame
 * ------------
 * Geometry for the admin preview surface.
 *
 * Every dimension in the Player / ContentScroller chain is `rem` against an
 * unmodified 16px root, so how large type LOOKS depends only on how many CSS
 * pixels wide its box is. `ScreenRenderer` gives `.screen-root` a fixed px box
 * straight from the screen's declared `resolution` and never scales it, so a
 * faithful preview has to do the same: lay out at the screen's exact CSS-pixel
 * resolution, then `zoom` that box down to fit the preview surface.
 *
 * The preview used to hardcode 1920x1080 @ zoom 0.5 — the right visual size but
 * the wrong layout size, which rendered every rem-sized glyph 2x small against a
 * 960x540 screen and 1.5x small against a 1280-wide one.
 */

/** Width of the visible preview surface, in real CSS px. */
export const PREVIEW_WIDTH = 960;

/**
 * Build the CSS custom properties that drive AdminPreviewPlayer.scss.
 *
 * @param {{width: number, height: number}|null|undefined} resolution
 * @returns {Object<string,string>|null} null when the screen declares no usable resolution
 */
export function previewFrameVars(resolution) {
  const w = resolution?.width;
  const h = resolution?.height;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;

  const scale = PREVIEW_WIDTH / w;
  return {
    '--preview-width': `${PREVIEW_WIDTH}px`,
    '--preview-screen-width': `${w}px`,
    '--preview-screen-height': `${h}px`,
    '--preview-scale': String(scale),
    '--preview-box-height': `${Math.round(h * scale)}px`,
  };
}
