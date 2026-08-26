/**
 * Presentation constants for the "workbook" print theme — a second, parallel
 * design system for school documents, sitting beside (never replacing)
 * `documentPdfTheme.mjs`. It exists to be more legible for younger or
 * accessibility-sensitive readers: Atkinson Hyperlegible instead of Roboto
 * Condensed, plus a real italic/bold-italic pair, plus size/density presets.
 *
 * INVARIANT: `documentPdfTheme.mjs` and its golden snapshots are untouched by
 * this file. Nothing here is imported by the legacy renderer path; it is
 * consumed only by tests and by later phases of the print design system.
 *
 * Structural contract mirrors `documentPdfTheme`: `page`, `ink`, `fonts`,
 * `styles`, `spacing` all exist with the same shape family (a style is
 * `{ font, size, leading, spacingClass }`; spacing is
 * `spacing[previousClass][nextClass]` gap lookup, never accumulated). Font
 * aliases are prefixed `workbook-` so both themes can register their TTFs on
 * the same pdfkit document without colliding with the legacy `school-doc-*`
 * aliases.
 *
 * @module rendering/school/documents/workbookTheme
 */

/** US Letter at 72 units per inch — same target as the legacy theme. */
const LETTER = { widthPt: 612, heightPt: 792 };

export const WORKBOOK_TYPE_SCALES = ['standard', 'young'];
export const WORKBOOK_DENSITIES = ['normal', 'compact'];

/**
 * Base style sizes/leading per type scale. `young` prints larger text with
 * proportionally roomier leading — early readers need both the glyphs and the
 * line pitch bigger, not just the glyphs.
 */
const SCALE_STYLES = {
  standard: {
    // `rich_text`'s Markdown parser emits the renderer-neutral `heading`
    // style for every ATX heading level. Keep that public block contract
    // alongside the more granular internal heading scales used by furniture.
    heading: { sizePt: 16, leadingPt: 20.5 },
    heading1: { sizePt: 20, leadingPt: 25 },
    heading2: { sizePt: 16, leadingPt: 20.5 },
    heading3: { sizePt: 13, leadingPt: 17 },
    body: { sizePt: 11, leadingPt: 14.5 },
    // Same glyph size/leading as `body` — `question` exists as a DISTINCT key
    // only so prose measured inside a question fragment carries its own
    // spacingClass (see STYLE_META below), mirroring documentPdfTheme's
    // identical body/question pairing.
    question: { sizePt: 11, leadingPt: 14.5 },
    label: { sizePt: 10, leadingPt: 13 },
    caption: { sizePt: 9, leadingPt: 12 },
    // Plain (non-italic) small copy — the `asset` block's alt/caption text
    // (measure.mjs's measureAssetNode always measures with styleKey
    // 'instruction', mirroring documentPdfTheme's identically-named style).
    // Distinct from `caption` (which is italic, used by `figure`) even
    // though the numbers happen to match `label` here.
    instruction: { sizePt: 10, leadingPt: 13 },
  },
  young: {
    heading: { sizePt: 19, leadingPt: 24.5 },
    heading1: { sizePt: 24, leadingPt: 30.5 },
    heading2: { sizePt: 19, leadingPt: 24.5 },
    heading3: { sizePt: 15.5, leadingPt: 20 },
    body: { sizePt: 13.5, leadingPt: 18 },
    question: { sizePt: 13.5, leadingPt: 18 },
    label: { sizePt: 12, leadingPt: 15.5 },
    caption: { sizePt: 10.5, leadingPt: 14 },
    instruction: { sizePt: 12, leadingPt: 15.5 },
  },
};

/** font/ink/spacingClass assignment per style — same for every scale. */
const STYLE_META = {
  heading: { font: 'bold', ink: 'text', spacingClass: 'heading' },
  heading1: { font: 'bold', ink: 'text', spacingClass: 'heading' },
  heading2: { font: 'bold', ink: 'text', spacingClass: 'heading' },
  heading3: { font: 'bold', ink: 'text', spacingClass: 'heading' },
  body: { font: 'regular', ink: 'text', spacingClass: 'body' },
  // Prose inside a `question` block (measure.mjs's `questionFragment` passes
  // `bodyStyleKey: 'question'`) — without this key any v2 document containing
  // a `question` (the `quiz`/`worksheet` archetypes' whole point) throws
  // measuring against this theme. Required by `NORMAL_SPACING`'s own
  // `question` row/column below, which this theme already carried.
  question: { font: 'regular', ink: 'text', spacingClass: 'question' },
  label: { font: 'bold', ink: 'text', spacingClass: 'body' },
  caption: { font: 'italic', ink: 'muted', spacingClass: 'instruction' },
  // `measureAssetNode` (the `asset` block) always measures with styleKey
  // 'instruction' — without this key any v2 document carrying a plain
  // `asset` block (not `figure`, which uses `caption`) throws measuring
  // against this theme (spec §7 block×target matrix / F1).
  instruction: { font: 'regular', ink: 'muted', spacingClass: 'instruction' },
};

/**
 * spacing[previousClass][nextClass] — the gap BETWEEN two fragments. `compact`
 * tightens every gap relative to `normal`; the ratio is deliberately uniform
 * so the two densities differ predictably rather than reshuffling rhythm.
 */
const NORMAL_SPACING = {
  // The lesson card is a page-opening masthead, not a heading: it carries a
  // border, a rule and a pass bar, and the first question must not crowd it.
  // Its own row rather than a shared one — every other class pair predates
  // the card and none of them should move because it wants more air.
  lessonCard: { heading: 14, body: 12, question: 14, instruction: 12, asset: 14, action: 16 },
  heading: { heading: 10, body: 6, question: 10, instruction: 6, asset: 10, action: 12 },
  body: { heading: 14, body: 8, question: 12, instruction: 8, asset: 12, action: 14 },
  question: { heading: 16, body: 12, question: 14, instruction: 12, asset: 14, action: 16 },
  instruction: { heading: 14, body: 8, question: 12, instruction: 8, asset: 12, action: 14 },
  asset: { heading: 14, body: 10, question: 12, instruction: 10, asset: 12, action: 14 },
  action: { heading: 16, body: 12, question: 14, instruction: 12, asset: 14, action: 12 },
};

const COMPACT_RATIO = 0.7;

function scaleSpacing(table, ratio) {
  const scaled = {};
  for (const [prevClass, nextGaps] of Object.entries(table)) {
    scaled[prevClass] = {};
    for (const [nextClass, gapPt] of Object.entries(nextGaps)) {
      scaled[prevClass][nextClass] = Math.round(gapPt * ratio * 10) / 10;
    }
  }
  return scaled;
}

const DENSITY_SPACING = {
  normal: NORMAL_SPACING,
  compact: scaleSpacing(NORMAL_SPACING, COMPACT_RATIO),
};

/** Deep-freeze: theme objects are shared/cached, so nothing downstream may mutate them. */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Build the workbook theme for a given type scale / density preset.
 *
 * @param {Object} [opts]
 * @param {'standard'|'young'} [opts.typeScale='standard']
 * @param {'normal'|'compact'} [opts.density='normal']
 * @returns {Object} deeply-frozen theme, structurally compatible with documentPdfTheme
 */
export function createWorkbookTheme({ typeScale = 'standard', density = 'normal' } = {}) {
  if (!WORKBOOK_TYPE_SCALES.includes(typeScale)) {
    throw new Error(`createWorkbookTheme: unknown typeScale '${typeScale}' (expected one of ${WORKBOOK_TYPE_SCALES.join(', ')})`);
  }
  if (!WORKBOOK_DENSITIES.includes(density)) {
    throw new Error(`createWorkbookTheme: unknown density '${density}' (expected one of ${WORKBOOK_DENSITIES.join(', ')})`);
  }

  const scaleStyles = SCALE_STYLES[typeScale];
  const styles = {};
  for (const [key, meta] of Object.entries(STYLE_META)) {
    styles[key] = { ...meta, ...scaleStyles[key] };
  }

  const theme = {
    page: { ...LETTER, marginPt: 54 },

    ink: {
      text: '#000000',
      muted: '#555555',
      rule: '#8A8A8A',
      box: '#000000',
      bubble: '#000000',
    },

    fonts: {
      // Resolved against the renderer's fontDir (bundled backend/assets/fonts).
      // `name` is the pdfkit font alias; prefixed `workbook-` so both this and
      // the legacy `school-doc-*` aliases can register on one pdfkit document.
      regular: { name: 'workbook-regular', file: 'atkinson-hyperlegible/AtkinsonHyperlegible-Regular.ttf' },
      bold: { name: 'workbook-bold', file: 'atkinson-hyperlegible/AtkinsonHyperlegible-Bold.ttf' },
      italic: { name: 'workbook-italic', file: 'atkinson-hyperlegible/AtkinsonHyperlegible-Italic.ttf' },
      boldItalic: { name: 'workbook-boldItalic', file: 'atkinson-hyperlegible/AtkinsonHyperlegible-BoldItalic.ttf' },
    },

    styles,

    spacing: DENSITY_SPACING[density],

    /**
     * The title/name/date banner every rendered document needs on page one
     * (`measure.mjs`'s `headerFragment` reads this unconditionally, for every
     * theme). Sized off this theme's own `heading1`/`label` styles rather than
     * duplicated numbers, so `young`/`compact` scale it the same way they scale
     * everything else. It is the ONLY place a document's name line is
     * printed — pages 2+ carry no banner of their own, only the footer band
     * (`furniture.mjs`), which re-identifies a stray page by the OMR card
     * number rather than a second blank "Name:" rule.
     */
    header: {
      titleSizePt: styles.heading1.sizePt,
      titleLeadingPt: styles.heading1.leadingPt,
      metaSizePt: styles.label.sizePt,
      metaLeadingPt: styles.label.leadingPt,
      metaTitleGapPt: density === 'compact' ? 6 : 9,
      ruleGapPt: density === 'compact' ? 5 : 7,
      ruleWidthPt: 0.8,
      gapBelowPt: density === 'compact' ? 7 : 10,
      blankFieldPt: 150,
      spacingClass: 'heading',
    },

    /** `page x of y` footer. Task 6 extends this with duplex-aware placement. */
    footer: {
      sizePt: styles.caption.sizePt,
      gapAbovePt: density === 'compact' ? 13 : 18,
      bottomInsetPt: 14,
    },

    /**
     * Layout-quality bounds that aren't part of the fixed spacing table
     * (`spacing[prevClass][nextClass]`) because they only govern GROWTH — how
     * far `distributeAnswerSpace` (layout.mjs) may stretch a single
     * `fillAfter` gap before leaving the remainder as blank trailing space
     * instead. Only fit policy `fill` ever reaches this; every other policy
     * leaves the last page ungrown anyway. Scaled by density like everything
     * else in this theme.
     */
    pagination: {
      maxFillGrowthPt: density === 'compact' ? 22 : 32,
    },

    /**
     * Legacy (v1) key title suffix — `titleSuffix` — plus, additively, the
     * v2 teacher-key render mode's geometry (Task 6, spec §4.1/§12.1): a
     * dense, single-column "<label> <answer>" appendix built by
     * `RenderPrintDocument` and drawn via `measureAnswerKeyNode`/
     * `drawAnswerKey`. The section's own "Answer key — <title> (variant N)"
     * heading is drawn by the ordinary `headerFragment` banner (the mini key
     * document's own `title`), not by this node — so there is no
     * title-specific token here, only the entry-list geometry.
     * `lineStyleKey` deliberately points at `caption` rather than `body` — a
     * teacher's answer page should read as reference material, not primary
     * content. `rowGapPt` is intentionally far tighter than any
     * `spacing[...]` gap this theme defines elsewhere — "dense end-of-doc
     * key", not one answer per paragraph. `spacingClass: 'instruction'`
     * matches `caption`'s own family (STYLE_META above), so the fragment
     * this node becomes gaps against its neighbors the same way any other
     * muted/reference text on the page already does.
     */
    answerKey: {
      titleSuffix: 'Answer Key',
      lineStyleKey: 'caption',
      rowGapPt: density === 'compact' ? 2 : 4,
      spacingClass: 'instruction',
    },

    /**
     * Display-math sizing (measure.mjs's `measureMathNode`, the `math` block
     * and inline `$...$` promoted out of `rich_text`) — same shape family as
     * `documentPdfTheme.math`. `fontSizePt` scales with `typeScale` (young
     * readers need the equation as legible as the prose around it);
     * `padAbovePt`/`padBelowPt` tighten under `compact`, matching every
     * other density-sensitive gap in this theme.
     */
    math: {
      fontSizePt: typeScale === 'young' ? 15 : 13,
      indentPt: 10,
      padAbovePt: density === 'compact' ? 1 : 2,
      padBelowPt: density === 'compact' ? 1 : 2,
      spacingClass: 'body',
    },

    /**
     * The QR/scan action box (`scan_action`/`media_action` blocks, and the
     * envelope `source` sugar that expands to one) — same shape family as
     * `documentPdfTheme.action`. `labelSizePt`/`codeSizePt` reuse the
     * already-scaled `label`/`caption` styles rather than duplicating the
     * typeScale ramp; `heightPt`/`padPt` tighten under `compact`.
     */
    action: {
      heightPt: density === 'compact' ? 50 : 58,
      padPt: density === 'compact' ? 7 : 9,
      borderWidthPt: 0.9,
      borderDash: [3, 3],
      labelSizePt: styles.label.sizePt,
      codeSizePt: styles.caption.sizePt,
      codeAreaPt: 40,
      codeGapPt: density === 'compact' ? 8 : 10,
      // 'M' recovers ~15% — same rationale as documentPdfTheme.action.
      qrErrorCorrection: 'M',
      qrQuietModules: 2,
      spacingClass: 'action',
    },

    /**
     * A bubble row (`omr_response`, legacy per spec §5.6 but still a
     * registered, renderable block) — same shape family as
     * `documentPdfTheme.omr`. `rowHeightPt`/`bubbleRadiusPt` scale with
     * `typeScale` (bigger targets for young hands); `labelSizePt`/
     * `choiceSizePt`/`choiceLeadingPt` reuse the already-scaled `label`/
     * `body` styles.
     */
    omr: {
      letters: 'ABCDEFGH',
      rowHeightPt: typeScale === 'young' ? 26 : 22,
      bubbleRadiusPt: typeScale === 'young' ? 8 : 6.5,
      bubbleStrokeWidthPt: 0.9,
      labelSizePt: styles.label.sizePt,
      labelGapPt: 4,
      compactLabelWidthPt: 18,
      indentPt: 10,
      choiceSizePt: styles.body.sizePt,
      choiceLeadingPt: styles.body.leadingPt,
      choiceGapPt: density === 'compact' ? 2 : 3,
      // Padding on each row of a `layout: compact` omr response. `measure.mjs`
      // reads this for EVERY compact row; it existed only on
      // `documentPdfTheme` — where its own comment notes it is never read,
      // because compact layout is a v2 concept and v2 renders with THIS
      // theme. Its absence measured every compact question as NaN, which made
      // the fit stage reject every block as exceeding the page: worksheets
      // could not render at all.
      compactRowPadPt: 5,
      /** Lines of choice text reserved when the probe has no bank to measure. */
      probeChoiceLines: 2,
      /**
       * Gap between a multi_select row's instruction caption ("Choose up to
       * N." / "Mark all that apply.", spec §5.5) and the checkbox row below
       * it. Never read for an ordinary multiple_choice/probe row (no
       * instruction line exists there), so this token has no effect on the
       * legacy circle-row geometry above.
       */
      instructionGapPt: density === 'compact' ? 1 : 3,
      spacingClass: 'body',
    },

    /**
     * `innerGapPt` is read for EVERY multi-node atomic fragment — a `question`,
     * but equally a `figure` (image/caption/credit) or an `inset` (title/
     * children) — so it has to exist even before a `question` block is wired
     * to this theme. `numberGutterPt`/`numberSizePt` are here for the same
     * structural-completeness reason; nothing in Task 5 exercises them.
     */
    question: {
      numberGutterPt: 24,
      numberSizePt: styles.label.sizePt,
      innerGapPt: density === 'compact' ? 5 : 6,
      spacingClass: 'question',
    },

    /**
     * Page furniture geometry, consumed by `furniture.mjs` (Task 6):
     * `footerBandPt` is reserved out of the bottom of the content flow on
     * every page (`contentBox`); `gutterPt` is the default 3-hole-punch
     * allowance (0.25in) used when a caller passes `gutter: true` rather than
     * an explicit width. It does not vary by density/scale — hole spacing is
     * a physical constant of the punch, not a typographic one.
     */
    furniture: {
      footerBandPt: density === 'compact' ? 22 : 28,
      gutterPt: 18,
    },

    // placeholder geometry — revisit when consumed (Tasks 5-6)
    /**
     * Glyph badge geometry (e.g. numbered/lettered markers). `square` (Task 4,
     * spec §5.5) is `multi_select`'s checkbox variant — drawn instead of the
     * circle for a multi_select `omr_response` row (DocumentPdfRenderer's
     * `drawOmrRow`), sized to roughly the same footprint as `theme.omr`'s
     * circle (`bubbleRadiusPt * 2`) so the two variants read as the same
     * "mark this" affordance at a glance.
     */
    badge: {
      diameterPt: typeScale === 'young' ? 20 : 16,
      strokeWidthPt: 1,
      font: 'bold',
      sizePt: typeScale === 'young' ? 11 : 9,
      square: {
        sizePt: typeScale === 'young' ? 16 : 13,
        strokeWidthPt: 0.9,
      },
    },

    /**
     * Card header strip (Print Design Phase C, Task 4, spec §5.2): the
     * physical card ID a student bubbles into OMR columns 1-7, printed as
     * large letter-spaced digits directly below the document header banner
     * — "Card 4 8 2 9 3 0 6 — questions 18-30". Drawn only when a caller
     * supplies render-context `card` (`{cardId, startRow, endRow,
     * firstUse}`, spec §5.3's allocation record); absent that option this
     * group is simply never read (same default-preserving posture as
     * `header.scoreBox`/`totalPoints`). `digitSizePt`/`trackingPt` scale
     * with `typeScale` like every other glyph token in this theme — a card
     * ID is read-and-bubbled by the SAME child who reads the body text, so
     * it gets the same young-reader legibility bump; `bandHeightPt` is this
     * group's "both densities/scales" band-height token.
     */
    card: {
      // A routing/reference number, never a second title. Keep it clearly
      // readable for transcription without letting seven digits dominate
      // the lesson heading above it.
      digitSizePt: typeScale === 'young' ? 20 : 16,
      trackingPt: typeScale === 'young' ? 6 : 4,
      labelSizePt: styles.label.sizePt,
      labelGapPt: density === 'compact' ? 8 : 10,
      boxPaddingXPt: 9,
      boxPaddingYPt: 4,
      reuseLabelSizePt: styles.caption.sizePt,
      reuseLabelLeadingPt: styles.caption.leadingPt,
      metaSizePt: styles.caption.sizePt,
      metaGapPt: density === 'compact' ? 8 : 10,
      bandHeightPt: Math.max(typeScale === 'young' ? 20 : 16, styles.label.sizePt) + 8,
      instructionGapPt: density === 'compact' ? 2 : 4,
      spacingClass: 'heading',
    },

    /** Inset box geometry (bordered callouts, answer boxes). Consumed by Task 5's `inset` block. */
    box: {
      radiusPt: 4,
      paddingPt: density === 'compact' ? 6 : 9,
      borderWidthPt: 0.9,
      innerGapPt: density === 'compact' ? 5 : 6,
      spacingClass: 'body',
    },

    /** Vertical breathing room between the subject mark and progress rail. */
    lessonCard: {
      progressGapPt: 10,
      spacingClass: 'lessonCard',
    },

    /** Lines a flowable fragment may not be broken below, on either side of a page break. */
    widowOrphan: { minLinesBeforeBreak: 2, minLinesAfterBreak: 2 },

    /** Figure image sizing/caption geometry — the same shape family as `documentPdfTheme.asset`. */
    asset: {
      placeholderHeightPt: 110,
      maxHeightPt: 260,
      captionGapPt: density === 'compact' ? 4 : 6,
      spacingClass: 'asset',
    },

    /** Passage-specific geometry: the optional line-number gutter and keep-with-next minima. */
    passage: {
      lineNumberGutterPt: 20,
      minLinesBeforeBreak: 2,
      minLinesAfterBreak: 2,
    },

    /** List marker column (bullet dot / number / checklist square) — fixed-width, never sized to content. */
    list: {
      markerColumnPt: 20,
      itemGapPt: density === 'compact' ? 2 : 3,
      bulletCharacter: '•',
      checklistSizePt: 9,
      checklistStrokeWidthPt: 0.9,
      spacingClass: 'body',
    },

    /**
     * Ruled lines for an `answer_space` node — `DocumentPdfRenderer`'s
     * `drawAnswerSpace` destructures this unconditionally (no optional
     * chaining), so any document with an `answer_space` block — virtually
     * every worksheet/quiz — needs it to draw at all. Same shape/field names
     * as `documentPdfTheme.answerSpace`.
     */
    answerSpace: {
      rulePitchPt: density === 'compact' ? 18 : 22,
      ruleWidthPt: 0.6,
      ruleInsetPt: 6,
      padAbovePt: density === 'compact' ? 3 : 4,
      spacingClass: 'body',
    },

    /** A bare rule across the content width. */
    divider: {
      ruleWidthPt: 0.8,
      paddingAbovePt: density === 'compact' ? 4 : 6,
      paddingBelowPt: density === 'compact' ? 4 : 6,
      spacingClass: 'body',
    },

    /** An elastic blank fragment — same {minPt,maxPt} growth mechanics as `answer_space`, no ink. */
    spacer: {
      spacingClass: 'body',
    },

    /**
     * `wordbank` (spec §6.2): a boxed, seeded-shuffled term set, printed as a
     * WRAPPING FLOW of terms (not a bulleted list) in `label` style. `theme.box`
     * supplies the border/padding/radius chrome; these two tokens are the
     * flow-specific geometry `theme.box` has no reason to carry (an inset's
     * children stack vertically, they never flow left-to-right).
     */
    wordbank: {
      termGapPt: density === 'compact' ? 8 : 10,
      rowGapPt: density === 'compact' ? 4 : 6,
      spacingClass: 'body',
    },

    /**
     * `matching` (spec §6.2): the block-internal two-column write-the-letter
     * grid — see `measure.mjs`'s `measureMatchingNode`. `ruleWidthPt` is the
     * short blank line before each left-column number (where the student
     * writes the matching letter); `numberColPt`/`letterColPt` are FIXED
     * marker-column widths, same "never sized to content" posture as
     * `theme.list.markerColumnPt`.
     */
    matching: {
      columnGapPt: 24,
      ruleWidthPt: density === 'compact' ? 16 : 20,
      ruleGapPt: 4,
      numberColPt: 18,
      numberGapPt: 4,
      letterColPt: 18,
      letterGapPt: 4,
      rowGapPt: density === 'compact' ? 4 : 6,
      spacingClass: 'body',
    },

    /**
     * `cloze`'s inline blank atoms (spec §6.3): three author-chosen width
     * classes, NEVER sized to the answer text (an answer-length leak is a
     * pedagogical bug per spec). Scales with `typeScale` like every other
     * glyph-adjacent token — a young reader's blank needs to be as legible/
     * writeable as the prose around it.
     */
    blank: {
      s: typeScale === 'young' ? 46 : 40,
      m: typeScale === 'young' ? 80 : 70,
      l: typeScale === 'young' ? 125 : 110,
    },

    /**
     * `short_answer`'s sugar (spec §4.2, §6.2: prompt + `answer_space`) needs
     * a default line count when the block omits `lines` — `blocks.mjs` bounds
     * it 1..10 when present but never requires it.
     */
    shortAnswer: {
      defaultLines: 3,
    },

    /**
     * `essay`'s sugar (spec §4.2, §6.2): ruled lines (same shape as
     * `shortAnswer`) OR, when the block says `box: true`, an OPEN box — a
     * bordered rectangle with no ruled lines at all, styled via `theme.box`
     * but reserving a fixed height token of its own (an inset's box sizes to
     * its children; an essay's open box has none, so it needs a height to be
     * instead of zero).
     */
    essay: {
      defaultLines: 10,
      boxHeightPt: density === 'compact' ? 130 : 160,
    },
  };

  return deepFreeze(theme);
}

export default { createWorkbookTheme, WORKBOOK_TYPE_SCALES, WORKBOOK_DENSITIES };
