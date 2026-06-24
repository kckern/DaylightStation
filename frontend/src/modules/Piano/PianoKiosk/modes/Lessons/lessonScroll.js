//
// Pure scroll-position math for the Lessons follow-along teleprompter. The
// component measures geometry from the DOM and delegates the "where should the
// container scroll to?" decision here so it can be unit-tested without a live
// layout engine (jsdom reports 0-size boxes).

/** Clamp a desired scrollLeft into the valid [0, maxScroll] range. */
export function clampScrollLeft(desired, maxScroll) {
  const max = maxScroll > 0 ? maxScroll : 0;
  if (desired < 0) return 0;
  if (desired > max) return max;
  return desired;
}

/**
 * Target scrollLeft so the active notehead rests `restFraction` of the viewport
 * width from the left edge (teleprompter lookahead).
 *
 * @param {object} g
 * @param {number} g.noteLeft      - note's left edge in CONTENT coordinates (px from content start)
 * @param {number} g.viewportWidth - scroll container's clientWidth
 * @param {number} g.contentWidth  - scroll container's scrollWidth
 * @param {number} g.restFraction  - 0..1, where the note should sit (e.g. 0.10)
 * @returns {number} clamped scrollLeft
 */
export function computeTargetScrollLeft({ noteLeft, viewportWidth, contentWidth, restFraction }) {
  if (!viewportWidth || viewportWidth <= 0) return 0;
  const restPx = viewportWidth * restFraction;
  const desired = noteLeft - restPx;
  const maxScroll = contentWidth - viewportWidth;
  return clampScrollLeft(desired, maxScroll);
}
