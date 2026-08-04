/**
 * Page furniture for workbook-theme Letter documents: the page-x-of-y footer,
 * the continuation strip that re-identifies a page once it's out of order in
 * a binder, and the gutter margin reserved for three-hole punching.
 *
 * Letter-only — never called for `target: receipt`. A continuous receipt
 * roll has no pages to number, no binder to fall out of, and no holes to
 * punch; the legacy `DocumentReceiptRenderer` path does not import this
 * module.
 *
 * ## Reservation model
 *
 * Both bands live at the BOTTOM of the page, stacked just above the page's
 * ordinary bottom margin line — printable-area furniture carved OUT OF the
 * content flow, never drawn over it and never spilling into the physical
 * margin: the continuation strip sits directly above the footer band, which
 * sits flush with the page's usual bottom-margin line (`page.heightPt -
 * page.marginPt`, the same line the legacy footer already prints just below).
 *
 * `contentBox()` reserves `footerBandPt + continuationStripPt`
 * (`theme.furniture`) out of the page's usable height, so `measure.mjs` /
 * `layout.mjs` never place a fragment where furniture will paint.
 *
 * `layout.mjs`'s `placeFragments` takes ONE `pageHeightPt` for the whole
 * document — it has no notion of "this page is shorter than that page". The
 * continuation strip is only meaningful on pages 2+ (page 1 already carries
 * the real title/name header up top), but there is no way, with today's
 * layout engine, to reserve room for it on SOME pages and not others. So
 * `contentBox` reserves the strip's height on EVERY page, including page 1 —
 * where `drawFurniture` simply never paints it. This wastes a sliver of page
 * 1's flow room, but not the strip's PURPOSE: page 1 is already unambiguously
 * identifiable via its own header, so the reservation is symmetric in effect
 * (every page gives up the same room) even though it is asymmetric in paint
 * (only pages 2+ use it). A future layout engine with per-page heights could
 * recover that page-1 sliver; nothing here depends on it staying wasted.
 *
 * ## Gutter model
 *
 * `gutter` reserves horizontal room for a 3-hole punch. Non-duplex
 * documents (the default) punch a FIXED side (left) on every page. A duplex
 * worksheet is punched through a stack that gets flipped for the back side,
 * so the gutter must alternate — "mirror margins": odd pages (1, 3, 5…, the
 * recto/front side as bound) carry the gutter on the left; even pages (2, 4,
 * 6…, the verso/back side) carry it on the right — so the punched holes line
 * up through the stack once it's printed double-sided and bound.
 *
 * @module rendering/school/documents/furniture
 */

const BLANK_RULE = '_'.repeat(20);

/**
 * Resolve the gutter's left/right widths for one page.
 *
 * @param {Object} theme
 * @param {Object} opts
 * @param {boolean|number} opts.gutter - `true` to use the theme's default
 *   `furniture.gutterPt`, a number to override it in points, falsy to disable
 * @param {boolean} opts.duplex - alternate side by page parity
 * @param {number} opts.pageIndex - 0-based page index (page 1 = index 0)
 * @returns {{leftPt: number, rightPt: number}}
 */
function gutterSides(theme, { gutter, duplex, pageIndex }) {
  const widthPt = gutter === true ? (theme.furniture.gutterPt ?? 0)
    : typeof gutter === 'number' ? gutter
      : 0;
  if (!widthPt) return { leftPt: 0, rightPt: 0 };
  if (!duplex) return { leftPt: widthPt, rightPt: 0 };
  const isRecto = pageIndex % 2 === 0; // page 1, 3, 5… (0-based: 0, 2, 4…)
  return isRecto ? { leftPt: widthPt, rightPt: 0 } : { leftPt: 0, rightPt: widthPt };
}

/**
 * The adjusted content rectangle for a page under this theme's furniture
 * geometry — margins, footer-band + continuation-strip reservation, and
 * gutter offset. Consumed by measurement/placement (Task 8 threads this into
 * the real render pipeline); proven directly here by test.
 *
 * @param {Object} theme - a workbook-family theme (must carry `page` + `furniture`)
 * @param {Object} [opts]
 * @param {boolean|number} [opts.gutter=false] - see `gutterSides`
 * @param {boolean} [opts.duplex=false] - alternate gutter side by page parity
 * @param {number} [opts.pageIndex=0] - 0-based page index; only affects which
 *   side the gutter falls on under `duplex`
 * @returns {{pageHeightPt: number, marginPt: number, xPt: number, widthPt: number,
 *   contentLeftPt: number, contentRightPt: number, gutterPt: number}}
 *   `pageHeightPt`/`marginPt` feed straight into `layout.mjs`'s
 *   `placeFragments({pageHeightPt, marginPt})`; `contentLeftPt`/
 *   `contentRightPt` are the horizontal draw bounds for that page.
 */
export function contentBox(theme, { gutter = false, duplex = false, pageIndex = 0 } = {}) {
  if (!theme?.page || !theme?.furniture) {
    throw new Error('contentBox: theme must carry page + furniture tokens');
  }
  const { page, furniture } = theme;
  const { leftPt, rightPt } = gutterSides(theme, { gutter, duplex, pageIndex });
  const reservedBottomPt = furniture.footerBandPt + furniture.continuationStripPt;

  const contentLeftPt = page.marginPt + leftPt;
  const contentRightPt = page.widthPt - page.marginPt - rightPt;

  return {
    // A uniformly shorter page keeps marginPt symmetric top/bottom while
    // carving the furniture band out of the bottom of the flow area — see
    // the module doc for why this is reserved on every page, not just 2+.
    pageHeightPt: page.heightPt - reservedBottomPt,
    marginPt: page.marginPt,
    xPt: contentLeftPt,
    widthPt: contentRightPt - contentLeftPt,
    contentLeftPt,
    contentRightPt,
    gutterPt: leftPt + rightPt,
  };
}

function setFont(doc, theme, fontKey, sizePt, inkKey = 'text') {
  return doc.font(theme.fonts[fontKey].name).fontSize(sizePt).fillColor(theme.ink[inkKey]);
}

/** The "page x of y" band — drawn on every page. */
function drawFooterBand(doc, theme, {
  xPt, widthPt, topPt, page, pageCount,
}) {
  const { footer, furniture } = theme;
  setFont(doc, theme, 'regular', footer.sizePt, 'muted');
  const textYPt = topPt + Math.max((furniture.footerBandPt - footer.sizePt) / 2, 0);
  doc.text(`Page ${page} of ${pageCount}`, xPt, textYPt, {
    width: widthPt, align: 'center', lineBreak: false,
  });
}

/** The continuation strip: title on the left, "Name: ___" on the right. */
function drawContinuationStrip(doc, theme, {
  xPt, widthPt, topPt, title, nameLine,
}) {
  const { styles, furniture } = theme;
  const label = styles.label;
  const textYPt = topPt + Math.max((furniture.continuationStripPt - label.sizePt) / 2, 0);
  const nameColumnPt = Math.min(widthPt * 0.4, 160);
  const titleColumnPt = widthPt - nameColumnPt;

  setFont(doc, theme, 'bold', label.sizePt, 'text');
  doc.text(title ?? '', xPt, textYPt, { width: titleColumnPt, lineBreak: false });

  setFont(doc, theme, 'regular', label.sizePt, 'muted');
  doc.text(`Name: ${nameLine || BLANK_RULE}`, xPt + titleColumnPt, textYPt, {
    width: nameColumnPt, align: 'right', lineBreak: false,
  });
}

/**
 * Draw one page's furniture: the page-x-of-y footer (every page), the
 * continuation strip (pages 2+), both gutter-adjusted horizontally.
 *
 * Called once per page, after that page's own fragments are drawn — furniture
 * never participates in fragment placement, it paints the band `contentBox`
 * already reserved.
 *
 * @param {Object} doc - a pdfkit document (or anything exposing the same
 *   `.font/.fontSize/.fillColor/.text` chainable surface)
 * @param {Object} opts
 * @param {Object} opts.theme - workbook-family theme (`page`, `furniture`, `footer`, `styles`)
 * @param {number} opts.page - 1-based page number being drawn
 * @param {number} opts.pageCount - total pages in the document
 * @param {string} [opts.title=''] - document title, printed in the continuation strip
 * @param {string|null} [opts.nameLine=null] - pre-filled learner name for the
 *   strip's "Name:" field (same semantics as the page-1 header's
 *   `studentName`); null/undefined prints a blank rule
 * @param {boolean} [opts.duplex=false] - alternate gutter side by page parity
 * @param {boolean|number} [opts.gutter=false] - gutter width; see `contentBox`
 */
export function drawFurniture(doc, {
  theme, page, pageCount, title = '', nameLine = null, duplex = false, gutter = false,
}) {
  if (!theme?.page || !theme?.furniture) {
    throw new Error('drawFurniture: theme must carry page + furniture tokens');
  }
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(`drawFurniture: page must be a positive integer, got ${page}`);
  }
  if (!Number.isInteger(pageCount) || pageCount < page) {
    throw new Error(`drawFurniture: pageCount (${pageCount}) must be an integer >= page (${page})`);
  }

  const pageIndex = page - 1;
  const { xPt: contentLeftPt, widthPt: contentWidthPt } = contentBox(theme, { gutter, duplex, pageIndex });
  const { furniture, page: pageTheme } = theme;
  const marginLineYPt = pageTheme.heightPt - pageTheme.marginPt;
  const stripTopPt = marginLineYPt - furniture.footerBandPt - furniture.continuationStripPt;
  const footerTopPt = stripTopPt + furniture.continuationStripPt;

  // Reserved on every page (see contentBox), drawn only on pages 2+: page 1
  // shows the real title/name header instead.
  if (page >= 2) {
    drawContinuationStrip(doc, theme, {
      xPt: contentLeftPt, widthPt: contentWidthPt, topPt: stripTopPt, title, nameLine,
    });
  }
  drawFooterBand(doc, theme, {
    xPt: contentLeftPt, widthPt: contentWidthPt, topPt: footerTopPt, page, pageCount,
  });
}

export default { drawFurniture, contentBox };
