/**
 * Presentation constants for the thermal receipt document target.
 *
 * Pixels, not points: a receipt is a raster the printer feeds by the millimetre,
 * so everything here is sized for 58mm tape at 203dpi (the same 580px column
 * the fitness and gratitude receipts use). Black on white only — thermal paper
 * has no greys that survive a week in a backpack.
 *
 * @module rendering/school/documents/documentReceiptTheme
 */

export const documentReceiptTheme = Object.freeze({
  canvas: { width: 580 },

  layout: {
    margin: 25,
    blockGap: 18,
    /** Tear the tape at the first block boundary past this length. */
    maxSegmentPx: 1400,
    cutGap: 26,
  },

  fonts: {
    family: 'Roboto Condensed',
    fontPath: 'roboto-condensed/RobotoCondensed-Regular.ttf',
    heading: 'bold 34px "Roboto Condensed"',
    header: 'bold 34px "Roboto Condensed"',
    body: '24px "Roboto Condensed"',
    label: 'bold 26px "Roboto Condensed"',
    // The lesson card's own title (e.g. "The United States") — bigger than
    // the generic `label` used for plain scan-action boxes so it stays the
    // clear high point of the card now that the taxonomy/description sizes
    // below have grown too (printed-copy feedback: keep the hierarchy, just
    // close the gap between the smallest and largest sizes).
    lessonTitle: 'bold 30px "Roboto Condensed"',
    eyebrow: 'bold 20px "Roboto Condensed"',
    // Was 18px — the printed copy showed this (the lesson description) as
    // one of the two hardest lines to read on thermal stock.
    description: 'italic 21px "Roboto Condensed"',
    summary: 'bold 28px "Roboto Condensed"',
    code: '22px "Roboto Condensed"',
    breadcrumb: '18px "Roboto Condensed"',
    breadcrumbStrong: 'bold 20px "Roboto Condensed"',
    identityLabel: 'bold 18px "Roboto Condensed"',
    identityValue: '20px "Roboto Condensed"',
    // The lesson card's Subject›Course / Unit taxonomy. Fixed sizes, not a
    // shrink-to-fit range: with vertical room to spare on 58mm tape, a long
    // breadcrumb should WRAP to more lines at a readable size rather than
    // compress onto one line the way `fittedFont` used to (design feedback —
    // the breadcrumb was the smallest, and hardest to read, text on the
    // receipt). `taxonomyTop` was the worst offender (down to 13px); it and
    // `taxonomyBottom` now match the general legibility bar the description
    // and label sizes sit at.
    taxonomyTop: '21px "Roboto Condensed"',
    taxonomyBottom: 'bold 23px "Roboto Condensed"',
  },

  /** The standard header: a full-bleed black band with the title knocked out. */
  header: {
    lineHeight: 40,
    padY: 12,
  },

  text: {
    headingLineHeight: 40,
    bodyLineHeight: 30,
    codeLineHeight: 26,
  },

  colors: {
    background: '#FFFFFF',
    text: '#000000',
    border: '#000000',
    headerText: '#FFFFFF',
  },

  math: {
    /** Em size for the MathJax render, then converted to tape pixels. */
    fontSizePt: 14,
    pxPerPt: 2.2,
    /** Rasterize at this multiple of the drawn size, then scale down. */
    rasterScale: 2,
    padY: 10,
  },

  action: {
    padding: 12,
    borderWidth: 3,
    codeAreaPx: 132,
    labelGap: 10,
    codeGap: 8,
    /** Subject shelf icon drawn left of the label (58mm tape, so keep it bold). */
    iconPx: 56,
    /** Taxonomy gutter icon (globe etc.) — sized to sit beside ONE line of
     *  breadcrumb text, not the whole two-row taxonomy block; see
     *  `taxonomyOp`/`drawTaxonomy`. */
    subjectIconPx: 28,
    iconGap: 12,
    lessonTextGap: 14,
    eyebrowLineHeight: 24,
    // Was 22 — grown alongside `fonts.description` (18px -> 21px).
    descriptionLineHeight: 26,
    /** Line height for the lesson-card title (`fonts.lessonTitle`, 30px). */
    titleLineHeight: 36,
    /** Line heights for the two (now independently wrappable) taxonomy rows. */
    taxonomyTopLineHeight: 26,
    taxonomyBottomLineHeight: 28,
    /** Gap between the wrapped top-line block and the wrapped bottom-line block. */
    taxonomyGap: 6,
    /** The Unit line's small hanging indent past the breadcrumb's left edge. */
    taxonomyBottomIndent: 12,
    /** Space between each row-group inside the lesson card (eyebrow -> taxonomy
     *  -> title -> description). Larger type needs room to breathe; this is the
     *  "spend the vertical space" fix — 58mm tape has height to spare, so the
     *  rows should not be packed to the point of touching. */
    rowGap: 10,
  },

  result: {
    padY: 8,
    iconPx: 42,
    identityHeight: 68,
    scorePanelHeight: 136,
    scorePanelPad: 12,
    scorePanelGap: 18,
    headlineLineHeight: 42,
    titleLineHeight: 32,
    boxSize: 31,
    boxGap: 8,
    boxLineWidth: 3,
    progressHeight: 14,
    progressGap: 5,
    progressSegments: 10,
  },
});

export default documentReceiptTheme;
