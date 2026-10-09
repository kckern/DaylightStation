// frontend/src/modules/Surround/entrance.js
//
// THE ENRICHMENT MOMENT — one gesture, one set of numbers.
//
// The surround's data arrives about a second after the video does (the host's
// 1 Hz poll), and until it does the player is a bare, full-bleed picture. The
// arrival is therefore a real event on screen, and design wave 5 asks it to LOOK
// like one: the video shrinks out of the whole frame and into its box while the
// rail slides in from its side, the band rises from below and the plate settles
// down onto the picture. Four moves, one gesture.
//
// WHY THESE LIVE IN JS AND NOT ONLY IN THE STYLESHEET
// --------------------------------------------------
// Three things have to agree about how long the entrance takes: the CSS
// transitions, the rAF safety net that guarantees the chrome becomes visible in
// a background tab, and the window during which the stage un-clips itself so the
// over-sized video is not cut off mid-shrink. Wave 2 shipped two of those with
// the duration written out twice. The frame now publishes these as custom
// properties on its root and the stylesheet reads them (with literal fallbacks,
// so the module still animates if it is ever rendered without the JS), which
// makes this file the single source.
//
// `--enter-ease` stays in the SCSS: it is a design decision with no JS consumer.
//
// Fix round 1 (docs truth-fix): two OTHER duration literals live in the
// stylesheets and are deliberately NOT published from here, unlike everything
// above. `220ms` (SurroundFrame.scss, the reduced-motion opacity ramp) and
// `120ms` (SegmentMap.scss, the playhead/fill glide) are both design-only CSS
// numbers with no JS consumer to keep in sync — nothing outside the stylesheet
// times against them, so there is no drift for a shared constant to prevent.

/** The chrome's own transition: rail, band, plate. */
export const ENTER_MS = 420;

/**
 * The video's shrink. Longer than the chrome's, deliberately: the picture is the
 * biggest thing moving, and a big move on the same clock as a small one reads as
 * faster than it is. It also means the video is still settling as the last piece
 * of chrome lands, which is what binds the four moves into one gesture instead of
 * four events.
 */
export const ENTER_MEDIA_MS = 520;

/**
 * The stagger. Rail and video start together — the rail is what makes the video's
 * new box exist, so they are the same beat — then the band, then the plate onto
 * the settled picture.
 */
export const ENTER_DELAY = Object.freeze({
  media: 0,
  rail: 0,
  footer: 110,
  header: 200,
});

/** When the last moving thing stops. ~620ms — inside the 450–650ms the design asks for. */
export const ENTER_TOTAL_MS = Math.max(
  ENTER_DELAY.media + ENTER_MEDIA_MS,
  ENTER_DELAY.rail + ENTER_MS,
  ENTER_DELAY.footer + ENTER_MS,
  ENTER_DELAY.header + ENTER_MS,
);

/**
 * The stage drops its `overflow: hidden` for this long. It has to outlast the
 * shrink — the video is larger than the stage for the whole of it — and it is a
 * class flip rather than a transition, so it may not end mid-move. One frame of
 * margin past the last transition is enough and no more.
 */
export const ENTER_UNCLIP_MS = ENTER_TOTAL_MS + 120;

/**
 * The custom properties the stylesheet reads. Published on the frame root so the
 * SCSS never restates a number this file owns.
 */
export function entranceVars() {
  return {
    '--enter-ms': `${ENTER_MS}ms`,
    '--enter-media-ms': `${ENTER_MEDIA_MS}ms`,
    '--enter-delay-media': `${ENTER_DELAY.media}ms`,
    '--enter-delay-rail': `${ENTER_DELAY.rail}ms`,
    '--enter-delay-footer': `${ENTER_DELAY.footer}ms`,
    '--enter-delay-header': `${ENTER_DELAY.header}ms`,
  };
}

/**
 * The pre-shrink transform for the media box, derived from two measured rects.
 *
 * UNIFORM SCALE, NOT A BOX ANIMATION. 16:9 is the quality floor of the whole
 * feature and it has to hold at EVERY frame of the entrance, not just at the
 * ends. A width/height animation asks the browser to interpolate two independent
 * lengths and stay on the ratio all the way — which it does not promise, and
 * which relayouts the playing video sixty times a second on top. One uniform
 * `scale()` cannot leave the ratio even in principle: it multiplies both axes by
 * the same number. It also runs on the compositor, so a playing video is not
 * re-laid-out at all while it moves.
 *
 * The pre-state is the video as it looked UN-enriched: contained in the whole
 * frame, centred. `Math.min` of the two ratios is exactly `object-fit: contain`.
 *
 * @returns {{scale:number,dx:number,dy:number}|null} null when there is nothing
 *   to shrink from (the box already fills the frame, or nothing is measurable).
 */
export function shrinkFrom(frameRect, mediaRect) {
  const fw = Number(frameRect?.width) || 0;
  const fh = Number(frameRect?.height) || 0;
  const mw = Number(mediaRect?.width) || 0;
  const mh = Number(mediaRect?.height) || 0;
  if (!(fw > 0 && fh > 0 && mw > 0 && mh > 0)) return null;
  const scale = Math.min(fw / mw, fh / mh);
  // A scale of 1 is not an entrance, it is a flicker. Below 1 would GROW the
  // video out of a frame it already overflows, which is never what happened.
  if (!(scale > 1.02)) return null;
  return {
    scale: Math.round(scale * 1000) / 1000,
    dx: Math.round((frameRect.x + fw / 2) - (mediaRect.x + mw / 2)),
    dy: Math.round((frameRect.y + fh / 2) - (mediaRect.y + mh / 2)),
  };
}
