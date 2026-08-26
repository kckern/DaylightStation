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
    /**
     * THE BOLD FACE, which was never registered.
     *
     * Only the Regular was ever handed to `registerFont`, so every `bold ...px
     * "Roboto Condensed"` in this theme — the header, the lesson title, the
     * rail, the taxonomy — resolved to the one weight available. The hierarchy
     * this file carefully describes in its comments was not actually printing.
     * The SemiBold has been sitting in `assets/fonts/roboto-condensed/` unused.
     */
    boldFontPath: 'roboto-condensed/RobotoCondensed-SemiBold.ttf',
    /**
     * The panel code is not prose — it is a value a child TYPES into a machine,
     * and it deserves to look like one. Kongtext is a fixed-width arcade face:
     * every digit the same width, unmistakably "input", and its heavy square
     * pixels survive 58mm thermal better than a proportional face at the same
     * size.
     *
     * This is the one deliberate exception to Roboto Condensed being the only
     * face on the page. It is scoped to the code cell and nothing else — the
     * moment it appears anywhere prose is set, that rule is gone.
     *
     * codeman38 / zone38.net; bundled under the licence in
     * `backend/assets/fonts/kongtext/LICENSE.txt`, which permits bundling in
     * free and commercial projects and forbids only resale as a font
     * collection.
     */
    codeFamily: 'Kongtext',
    codeFontPath: 'kongtext/kongtext.ttf',
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
    /** The catch-up rail's label. Small and bold — it names the card, it is
     *  not competing with the title. */
    rail: 'bold 20px "Roboto Condensed"',
    eyebrow: 'bold 20px "Roboto Condensed"',
    // Was 18px — the printed copy showed this (the lesson description) as
    // one of the two hardest lines to read on thermal stock.
    description: 'italic 21px "Roboto Condensed"',
    summary: 'bold 28px "Roboto Condensed"',
    code: '22px "Roboto Condensed"',
    // The six-digit panel code under a QR: bigger and bolder than the fallback
    // token, because it is read off paper and typed on a wall panel by a child.
    // Kongtext is already fixed-width and heavy; it needs no bold, and asking
    // for one node-canvas cannot synthesise from a single-weight face is how
    // you silently get a substituted system font instead.
    //
    // 18px is the CEILING, not a taste call: Kongtext advances exactly 1em per
    // glyph, so a six-digit code measures 6x the size — 108px inside a 132px
    // cell. At 20px it is 120px and the digits touch the border; at 24px they
    // print straight through it.
    panelCode: '18px "Kongtext"',
    /** The unit line above a lesson title. NOT bold — it introduces the title,
     *  it does not compete with it; the marker block is what makes it distinct. */
    unitLabel: '20px "Roboto Condensed"',
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
    /** Inverted bar sat on top of a card to mark it as something other than
     *  ordinary today-work — currently catch-up (a lesson from a day that has
     *  already passed). Emphasis comes from the inversion, not a second
     *  typeface: on 58mm thermal a solid black bar is the one treatment that
     *  survives, and Roboto Condensed stays the only face on the page. */
    railHeight: 34,
    railPadX: 12,
    padding: 12,
    borderWidth: 3,
    codeAreaPx: 132,
    labelGap: 10,
    codeGap: 8,
    /** Height of the panel-code cell that hangs under the QR box, sharing its
     *  bottom border so the two read as one stacked control rather than a
     *  number adrift beneath a picture. */
    codeCellHeight: 36,
    /** The unit line above the lesson title, and its leading marker block. A
     *  solid square rather than a chevron glyph: at 203dpi a filled rectangle
     *  is the one small mark that always survives, where a thin glyph can drop
     *  a stroke and read as dirt. */
    unitLineHeight: 26,
    unitMarkerSize: 12,
    unitMarkerGap: 10,
    /** Progress bars inside a lesson card: a label/position row, then the bar. */
    progressLabelHeight: 24,
    progressBarHeight: 12,
    progressRowGap: 8,
    /**
     * Above this many items the per-item ticks are dropped and the bar is drawn
     * plain. The result receipt puts ONE TICK PER ITEM so the filled edge lands
     * exactly on the `completed`-th tick — correct, and unreadable at 366
     * lessons, where each tick would be a third of a pixel. A bar with no ticks
     * still reads "how far along"; a bar with 366 of them reads as a smudge.
     */
    progressTickMax: 40,
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
    /** Line height for the lesson-card title (`fonts.lessonTitle`, 30px). A
     *  wrapped title is ONE name, not two sentences: at 36 the two halves of
     *  "Rhythm Improvisation with / Chords" read as separate lines. Tighter
     *  than the body leading on purpose. */
    titleLineHeight: 32,
    /** Line heights for the two (now independently wrappable) taxonomy rows. */
    taxonomyTopLineHeight: 26,
    taxonomyBottomLineHeight: 28,
    /** Gap between the wrapped top-line block and the wrapped bottom-line block. */
    taxonomyGap: 6,
    /** The Unit line's small hanging indent past the breadcrumb's left edge. */
    taxonomyBottomIndent: 12,
    /** The Lesson line begins separately and one step deeper than its Unit. */
    taxonomyLessonIndent: 30,
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
    // The review inset, drawn INSIDE the score panel beneath a hairline.
    reviewPadX: 16,
    reviewGap: 14,
    reviewHeadingHeight: 30,
    reviewLineHeight: 26,
    reviewRowGap: 6,
    reviewPadBottom: 14,
    scorePanelPad: 12,
    scorePanelGap: 18,
    headlineLineHeight: 42,
    titleLineHeight: 32,
    boxSize: 31,
    boxGap: 8,
    boxLineWidth: 3,
    // Per-question check/X are drawn as vector strokes, never a font glyph
    // (Roboto Condensed has no U+2713 — a font swap or container rebuild
    // must never be able to turn a CORRECT row back into tofu). `markInset`
    // is a fixed px, not a ratio of the box, because `boxSize` only shrinks
    // when more than ~14 items would otherwise overflow the panel width —
    // well past the `scoreMode: 'items'` ceiling of 10 this path draws for.
    markStrokeWidth: 3,
    markInset: 7,
    progressHeight: 14,
    progressGap: 5,
    // The aggregate-score BOX count. Despite the name it no longer has
    // anything to do with the progress bars below the panel: those draw one
    // tick per lesson (`segments === total`), because a tick that stands for
    // "a tenth of the way" cannot line up with a fill computed as
    // `completed / total`.
    progressSegments: 10,
    // Narrowest gap, in canvas px, at which progress ticks are still
    // countable. The track is 530px, so this permits a unit of ~88 lessons
    // before the ticks are dropped entirely — far past any real course, and
    // dropping them is the honest failure (see the renderer's own note).
    progressMinTickGap: 6,
    // The in-progress hatch: stripe pitch and stroke, in canvas px, chosen by
    // rendering four densities side by side. 3-on-6 is 50% ink — a fine even
    // texture that reads as "part way" against both the solid fill and the
    // empty track. A sparser hatch (3-on-12) reads as a row of tick marks
    // instead, and a heavier one (5-on-8) starts to look solid. The pitch is
    // also an order of magnitude tighter than the segment ticks (~75px on a
    // 7-unit course), so the two can never be mistaken for each other.
    progressHatchPitch: 6,
    progressHatchWidth: 3,
  },
});

export default documentReceiptTheme;
