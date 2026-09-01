/**
 * Page furniture for workbook-theme Letter documents: the page-x-of-y footer
 * and the gutter margin reserved for three-hole punching.
 *
 * Letter furniture — meaningless for a continuous receipt roll (no pages to
 * number, no binder to fall out of, no holes to punch). The LEGACY receipt
 * path (`DocumentReceiptRenderer`) never imports this module, so a v1
 * `target: [receipt]` document is genuinely never furnished. v2 is a
 * different story: `RenderPrintDocument`'s `#renderV2` is PDF/Letter-always
 * in Phase A (no receipt renderer wired for v2 yet, spec §13) — it calls
 * `contentBox`/`drawFurniture` unconditionally, regardless of what the
 * document's own `target` array says, so a v2 document declaring
 * `target: [receipt]` still gets a fully furnished Letter PDF today. That
 * mismatch is real (surfaced as a render warning by `RenderPrintDocument`,
 * not silently swallowed here); this module still never NEEDS to know
 * about `target` itself.
 *
 * ## Reservation model
 *
 * The footer band is the ONLY bottom furniture, and the only thing reserved
 * out of the content flow. It sits flush with the page's usual bottom-margin
 * line (`page.heightPt - page.marginPt`, the same line the legacy footer
 * already prints just below) — printable-area furniture carved OUT OF the
 * flow, never drawn over content and never spilling into the physical margin.
 *
 * `contentBox()` reserves `furniture.footerBandPt` out of the page's usable
 * height, so `measure.mjs` / `layout.mjs` never place a fragment where
 * furniture will paint. Uniform on every page, which is all `layout.mjs`'s
 * single `pageHeightPt` can express anyway.
 *
 * ## Re-identifying a stray page
 *
 * A page that falls out of its stack is matched back by the physical OMR
 * answer-card identity the render is attached to: when a card is supplied,
 * the footer repeats its identicon, Student No., owned row range, and page
 * position on EVERY page, page 1 included. With no card attached the footer
 * stays a plain `Page X of Y`. (An earlier design printed a blank `Name: ____` continuation
 * strip on pages 2+ instead; nobody ever wrote a name on it, and the card
 * number is what the grading pipeline actually keys on.)
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
import { answerSheetIdenticon } from '#domains/school/documents/answerSheetIdentity.mjs';

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
 * geometry — margins, footer-band reservation, and gutter offset. Consumed by
 * measurement/placement (Task 8 threads this into the real render pipeline);
 * proven directly here by test.
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
  const reservedBottomPt = furniture.footerBandPt;

  const contentLeftPt = page.marginPt + leftPt;
  const contentRightPt = page.widthPt - page.marginPt - rightPt;

  return {
    // A uniformly shorter page keeps marginPt symmetric top/bottom while
    // carving the footer band out of the bottom of the flow area.
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

/**
 * The answer-sheet identity/page-position band drawn on every page.
 */
function drawFooterBand(doc, theme, {
  xPt, widthPt, page, pageCount, card,
}) {
  const { footer } = theme;
  setFont(doc, theme, 'regular', footer.sizePt, 'muted');
  const textYPt = theme.page.heightPt - footer.bottomInsetPt - footer.sizePt;
  const text = card
    ? `Student No. ${card.cardId} · Rows ${card.startRow}–${card.endRow} · Page ${page} of ${pageCount}`
    : `Page ${page} of ${pageCount}`;
  if (card) {
    const identicon = answerSheetIdenticon(String(card.cardId), card.identiconVersion);
    const cellPt = 2.2;
    const iconPt = identicon.size * cellPt;
    const iconXPt = xPt + 2;
    const iconYPt = textYPt - Math.max(0, (iconPt - footer.sizePt) / 2);
    doc.save().fillColor(theme.ink.text);
    identicon.cells.forEach((filled, index) => {
      if (!filled) return;
      doc.rect(
        iconXPt + (index % identicon.size) * cellPt,
        iconYPt + Math.floor(index / identicon.size) * cellPt,
        cellPt,
        cellPt,
      ).fill();
    });
    doc.restore();
  }
  doc.text(text, xPt, textYPt, {
    width: widthPt, align: 'center', lineBreak: false,
  });
}

/**
 * Draw one page's footer — page position plus complete answer-sheet identity
 * when this render is card-attached — gutter-adjusted horizontally.
 *
 * Called once per page, after that page's own fragments are drawn — furniture
 * never participates in fragment placement, it paints the band `contentBox`
 * already reserved.
 *
 * @param {Object} doc - a pdfkit document (or anything exposing the same
 *   `.font/.fontSize/.fillColor/.text` chainable surface)
 * @param {Object} opts
 * @param {Object} opts.theme - workbook-family theme (`page`, `furniture`, `footer`)
 * @param {number} opts.page - 1-based page number being drawn
 * @param {number} opts.pageCount - total pages in the document
 * @param {string|number|null} [opts.cardId=null] - the physical OMR card/student
 *   number this render is attached to; appended to the footer so a page that
 *   gets separated from its stack can be matched back by number. Null for a
 *   render with no card context — the footer stays a plain "Page X of Y".
 * @param {boolean} [opts.duplex=false] - alternate gutter side by page parity
 * @param {boolean|number} [opts.gutter=false] - gutter width; see `contentBox`
 */
export function drawFurniture(doc, {
  theme, page, pageCount, card = null, cardId = null, duplex = false, gutter = false,
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

  drawFooterBand(doc, theme, {
    xPt: contentLeftPt,
    widthPt: contentWidthPt,
    page,
    pageCount,
    card: card ?? (cardId == null ? null : { cardId, startRow: '?', endRow: '?' }),
  });
}

export default { drawFurniture, contentBox };
