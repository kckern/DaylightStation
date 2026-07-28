/**
 * The bridge between a rendered School PDF and what a scanner would see.
 *
 * `opticalScan.mjs` measures pixels and `qrDecode.mjs` decodes them; neither
 * knows anything about School. This module joins their output to the renderer's
 * claims — the form map and the code map — and reports the AGREEMENT between
 * the two as numbers a test can assert on and a person can read.
 *
 * TOLERANCES, AND WHY THEY ARE THESE NUMBERS
 *   Measured at 300dpi against the real OMR fixture, the printed rim's fitted
 *   centre sits within 0.001pt of the recorded centre for all 24 bubbles, and
 *   the fitted radius reads about 0.02pt under the recorded 6.5pt. The radius
 *   figure is a MEASUREMENT artefact, not a rendering one: it halves with each
 *   doubling of raster density (0.055pt at 150dpi, 0.021pt at 300dpi, 0.005pt
 *   at 600dpi), which is the signature of antialiasing across a curved rim
 *   rather than of ink in the wrong place.
 *
 *   So the two tolerances are set an order of magnitude above what is actually
 *   observed and still far below anything that could mis-grade:
 *     - centre 0.05pt — 0.8% of a bubble radius, ~0.2 device pixels at 300dpi,
 *       and 50x the worst deviation seen. The 3pt sabotage is 60x over it.
 *     - radius 0.08pt — 1.2% of a bubble radius, ~4x the antialiasing bias.
 *   Neither is "whatever passes": both were chosen after measuring, and the
 *   suite reports the worst observed deviation so a drift toward the limit is
 *   visible long before it fails.
 *
 * @module tests/_lib/school/opticalHarness
 */
import { rasterizePdfPages } from './rasterize.mjs';
import { toPageImage, detectCircles } from './opticalScan.mjs';
import { decodeQrFromPage } from './qrDecode.mjs';

/**
 * Raster density for optical measurement. 300dpi puts ~27 pixels across a
 * bubble radius and ~6.7 across a QR module, and costs about 0.4s a page.
 */
export const OPTICAL_DPI = 300;

/** A recorded centre may sit this far from the printed rim's fitted centre. */
export const CENTRE_TOLERANCE_PT = 0.05;

/** A recorded radius may differ from the printed rim's fitted radius by this much. */
export const RADIUS_TOLERANCE_PT = 0.08;

/** Beyond this RMS residual the thing measured was not a circle. */
export const CIRCLE_RESIDUAL_TOLERANCE_PT = 0.05;

/** Rasterize a rendered document once, at optical density. */
export async function rasterizeForOptics(pdf, name = 'optical') {
  const pages = rasterizePdfPages(pdf, { dpi: OPTICAL_DPI, name });
  return Promise.all(pages.map((png) => toPageImage(png, OPTICAL_DPI)));
}

/**
 * Compare every mark in a form map against the circle actually printed for it.
 *
 * Matching is nearest-circle-on-the-same-page, which is safe here because the
 * tolerance being asserted is two orders of magnitude below the ~117pt gap
 * between neighbouring bubbles: a mark can only be nearest to its own rim
 * unless the drift is already catastrophic, and then `deviationPt` says so.
 *
 * @param {Array<Object>} pageImages - from `rasterizeForOptics`
 * @param {{marks: Array<Object>}} formMap
 * @returns {{
 *   matches: Array<{mark: Object, circle: Object, deviationPt: number, radiusDeviationPt: number}>,
 *   worstDeviationPt: number, worstRadiusDeviationPt: number, worstResidualPt: number,
 *   perPage: Array<{page: number, detected: number, recorded: number}>,
 * }}
 */
export function measurePrintedMarks(pageImages, formMap) {
  if (!formMap || !Array.isArray(formMap.marks) || formMap.marks.length === 0) {
    throw new Error('measurePrintedMarks needs a form map with marks; this document produced none');
  }
  const circlesByPage = pageImages.map((page) => detectCircles(page));

  const matches = [];
  for (const mark of formMap.marks) {
    const circles = circlesByPage[(mark.page ?? 1) - 1] ?? [];
    let best = null;
    for (const circle of circles) {
      const deviationPt = Math.hypot(circle.xPt - mark.xPt, circle.yPt - mark.yPt);
      if (!best || deviationPt < best.deviationPt) best = { circle, deviationPt };
    }
    if (!best) {
      throw new Error(
        `no printed circle at all on page ${mark.page} for ${mark.itemId}/${mark.choice}. `
        + 'The form map records a bubble the page does not carry.',
      );
    }
    matches.push({
      mark,
      circle: best.circle,
      deviationPt: best.deviationPt,
      radiusDeviationPt: Math.abs(best.circle.rPt - mark.rPt),
    });
  }

  const perPage = circlesByPage.map((circles, index) => ({
    page: index + 1,
    detected: circles.length,
    recorded: formMap.marks.filter((m) => (m.page ?? 1) === index + 1).length,
  }));

  return {
    matches,
    perPage,
    worstDeviationPt: Math.max(...matches.map((m) => m.deviationPt)),
    worstRadiusDeviationPt: Math.max(...matches.map((m) => m.radiusDeviationPt)),
    worstResidualPt: Math.max(...matches.map((m) => m.circle.residualPt)),
  };
}

/**
 * Decode every symbol printed on every page.
 * @returns {Array<{page: number, symbols: Array<Object>}>}
 */
export function decodePrintedCodes(pageImages) {
  return pageImages.map((page, index) => ({ page: index + 1, symbols: decodeQrFromPage(page) }));
}

/**
 * Assert-shaped summary of recorded-vs-printed agreement, for the tests and for
 * the sabotage suite (which needs the same check to go red under a mutation).
 *
 * @returns {string[]} one message per disagreement; empty means the ink agrees
 */
export function checkPrintedMarks(pageImages, formMap) {
  const measured = measurePrintedMarks(pageImages, formMap);
  const failures = [];
  for (const { page, detected, recorded } of measured.perPage) {
    if (detected !== recorded) {
      failures.push(`page ${page}: ${detected} printed circles but ${recorded} recorded marks`);
    }
  }
  for (const match of measured.matches) {
    const { mark } = match;
    if (match.deviationPt > CENTRE_TOLERANCE_PT) {
      failures.push(
        `${mark.itemId}/${mark.choice}: recorded centre (${mark.xPt.toFixed(3)}, ${mark.yPt.toFixed(3)}) `
        + `but the ink is at (${match.circle.xPt.toFixed(3)}, ${match.circle.yPt.toFixed(3)}) — `
        + `${match.deviationPt.toFixed(4)}pt away, limit ${CENTRE_TOLERANCE_PT}pt`,
      );
    }
    if (match.radiusDeviationPt > RADIUS_TOLERANCE_PT) {
      failures.push(
        `${mark.itemId}/${mark.choice}: recorded radius ${mark.rPt}pt but the printed rim measures `
        + `${match.circle.rPt.toFixed(4)}pt — ${match.radiusDeviationPt.toFixed(4)}pt out, limit ${RADIUS_TOLERANCE_PT}pt`,
      );
    }
    if (match.circle.residualPt > CIRCLE_RESIDUAL_TOLERANCE_PT) {
      failures.push(
        `${mark.itemId}/${mark.choice}: the printed rim is not a circle `
        + `(fit residual ${match.circle.residualPt.toFixed(4)}pt)`,
      );
    }
  }
  return { failures, measured };
}

export default {
  OPTICAL_DPI, rasterizeForOptics, measurePrintedMarks, decodePrintedCodes, checkPrintedMarks,
};
