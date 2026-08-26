/**
 * Presentation constants for the Letter document PDF target.
 *
 * EVERY number the measurer or the renderer uses lives here. A magic number in
 * either of those files is a number the golden snapshots pin but nobody can
 * find, and page geometry is exactly where a silent drift mis-prints a child's
 * worksheet.
 *
 * Fonts are the bundled Roboto Condensed TTFs rather than pdfkit's base-14
 * faces: base-14 is WinAnsi-only (a non-ASCII glyph prints as a substitute —
 * spike finding), and an embedded font also rasterizes identically everywhere,
 * which is what makes the golden page snapshots portable. Only Regular and
 * SemiBold are bundled, so `bold` is SemiBold and there is no italic face —
 * emphasis comes from size and ink, never a synthesized slant.
 *
 * @module rendering/school/documents/documentPdfTheme
 */

/** US Letter at 72 units per inch, which is what pdfkit points are. */
const LETTER = { widthPt: 612, heightPt: 792 };

export const documentPdfTheme = Object.freeze({
  page: { ...LETTER, marginPt: 54 },

  ink: {
    text: '#000000',
    muted: '#555555',
    rule: '#8A8A8A',
    box: '#000000',
    bubble: '#000000',
  },

  fonts: {
    // Resolved against the renderer's fontDir (bundled backend/assets/fonts by
    // default). `name` is the pdfkit font alias the styles below refer to.
    regular: { name: 'school-doc-regular', file: 'roboto-condensed/RobotoCondensed-Regular.ttf' },
    bold: { name: 'school-doc-bold', file: 'roboto-condensed/RobotoCondensed-SemiBold.ttf' },
    // The dedicated machine-code face, the same one the thermal receipt's code
    // cell uses (`documentReceiptTheme.codeFontPath`). Scoped to printed access
    // codes and nothing else — the moment it sets prose, that rule is gone.
    // Registration is lazy in pdfkit, so a document that never prints a code
    // embeds nothing and stays byte-identical.
    code: { name: 'school-doc-code', file: 'kongtext/kongtext.ttf' },
  },

  /**
   * Semantic styles. `spacingClass` keys the spacing table below; leading is
   * the line pitch used by BOTH measurement and drawing, so the two can never
   * disagree about where line 4 sits.
   */
  styles: {
    heading: { font: 'bold', sizePt: 15, leadingPt: 19, ink: 'text', spacingClass: 'heading' },
    body: { font: 'regular', sizePt: 11, leadingPt: 14.5, ink: 'text', spacingClass: 'body' },
    question: { font: 'regular', sizePt: 11, leadingPt: 14.5, ink: 'text', spacingClass: 'question' },
    instruction: { font: 'regular', sizePt: 10, leadingPt: 13, ink: 'muted', spacingClass: 'instruction' },
  },

  /**
   * spacing[previousClass][nextClass] — the gap BETWEEN two fragments, looked
   * up rather than accumulated, so a heading followed by a question always sits
   * at one distance regardless of what came before.
   */
  spacing: {
    heading: { heading: 10, body: 6, question: 10, instruction: 6, asset: 10, action: 12 },
    body: { heading: 14, body: 8, question: 12, instruction: 8, asset: 12, action: 14 },
    question: { heading: 16, body: 12, question: 14, instruction: 12, asset: 14, action: 16 },
    instruction: { heading: 14, body: 8, question: 12, instruction: 8, asset: 12, action: 14 },
    asset: { heading: 14, body: 10, question: 12, instruction: 10, asset: 12, action: 14 },
    action: { heading: 16, body: 12, question: 14, instruction: 12, asset: 14, action: 12 },
  },

  header: {
    titleSizePt: 17,
    titleLeadingPt: 22,
    metaSizePt: 10,
    metaLeadingPt: 14,
    ruleGapPt: 7,
    ruleWidthPt: 0.8,
    gapBelowPt: 10,
    // Gap between the meta row (Name/Date) and the title when the document
    // asks for `header.metaFirst`. `workbookTheme` has always carried this;
    // its absence here made every `metaFirst` document measure a NaN header
    // height, which poisoned the fit comparison and reported EVERY block as
    // exceeding the page — the symptom that made worksheets unrenderable
    // under this theme. Same value workbookTheme uses at normal density.
    metaTitleGapPt: 9,
    blankFieldPt: 150,
    // Matches `measure.mjs`'s prior bare-literal default exactly — legacy
    // v1 rendering never sets `header.frame: 'double'` (that field is a v2
    // concept), so this is never actually read on this path; present for
    // shape completeness only (`workbookTheme.mjs`'s own copy is what a
    // frame:double v2 document actually reads).
    framePaddingPt: 7,
    spacingClass: 'heading',
  },

  footer: {
    sizePt: 8,
    gapAbovePt: 18,
  },

  question: {
    numberGutterPt: 24,
    numberSizePt: 11,
    innerGapPt: 6,
    spacingClass: 'question',
  },

  math: {
    fontSizePt: 13,
    indentPt: 10,
    padAbovePt: 2,
    padBelowPt: 2,
    spacingClass: 'body',
  },

  answerSpace: {
    rulePitchPt: 22,
    ruleWidthPt: 0.6,
    ruleInsetPt: 6,
    padAbovePt: 4,
    spacingClass: 'body',
  },

  /**
   * A bubble row is one reader column, so every bubble of an item MUST share a
   * single y — the choice text therefore sits UNDER its bubble (where it can
   * wrap freely) instead of beside it (where a long choice would force a second
   * row and split the item across two reader columns).
   */
  omr: {
    letters: 'ABCDEFGH',
    rowHeightPt: 22,
    bubbleRadiusPt: 6.5,
    bubbleStrokeWidthPt: 0.9,
    labelSizePt: 10,
    labelGapPt: 4,
    indentPt: 10,
    choiceSizePt: 10,
    choiceLeadingPt: 12.5,
    choiceGapPt: 3,
    /** Lines of choice text reserved when the probe has no bank to measure. */
    probeChoiceLines: 2,
    // Matches `measure.mjs`/`DocumentPdfRenderer.mjs`'s prior bare-literal
    // `+ 5` exactly — legacy v1 rendering never sets `omr_response.layout:
    // 'compact'` (that field is a v2 concept), so this is never actually
    // read on this path; present for shape completeness only.
    compactRowPadPt: 5,
    spacingClass: 'body',
  },

  action: {
    heightPt: 58,
    padPt: 9,
    borderWidthPt: 0.9,
    borderDash: [3, 3],
    labelSizePt: 11,
    codeSizePt: 9,
    codeAreaPt: 40,
    codeGapPt: 10,
    // 'M' recovers ~15% — enough for a sheet that gets folded and carried
    // around a house, without spending modules a 40pt square cannot spare.
    qrErrorCorrection: 'M',
    // The symbol's mandatory margin. A reader cannot find the finder patterns
    // without it, and the dashed action border sits right beside this box.
    qrQuietModules: 2,
    spacingClass: 'action',
  },

  asset: {
    placeholderHeightPt: 110,
    maxHeightPt: 260,
    captionSizePt: 9,
    captionLeadingPt: 12,
    captionGapPt: 5,
    spacingClass: 'asset',
  },

  answerKey: {
    titleSuffix: 'Answer Key',
  },

  /** Lines a paragraph may not be broken below, on either side of a page break. */
  widowOrphan: { minLinesBeforeBreak: 2, minLinesAfterBreak: 2 },
});

export default documentPdfTheme;
