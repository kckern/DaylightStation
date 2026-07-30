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
    header: 'bold 44px "Roboto Condensed"',
    body: '24px "Roboto Condensed"',
    label: 'bold 26px "Roboto Condensed"',
    code: '22px "Roboto Condensed"',
  },

  /** The standard header: a full-bleed black band with the title knocked out. */
  header: {
    lineHeight: 52,
    padY: 20,
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
    padding: 14,
    borderWidth: 3,
    codeAreaPx: 150,
    labelGap: 10,
    codeGap: 8,
    /** Subject shelf icon drawn left of the label (58mm tape, so keep it bold). */
    iconPx: 56,
    iconGap: 12,
  },
});

export default documentReceiptTheme;
