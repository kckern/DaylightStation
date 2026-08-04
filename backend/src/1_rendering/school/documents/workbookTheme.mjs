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
    heading1: { sizePt: 20, leadingPt: 25 },
    heading2: { sizePt: 16, leadingPt: 20.5 },
    heading3: { sizePt: 13, leadingPt: 17 },
    body: { sizePt: 11, leadingPt: 14.5 },
    label: { sizePt: 10, leadingPt: 13 },
    caption: { sizePt: 9, leadingPt: 12 },
  },
  young: {
    heading1: { sizePt: 24, leadingPt: 30.5 },
    heading2: { sizePt: 19, leadingPt: 24.5 },
    heading3: { sizePt: 15.5, leadingPt: 20 },
    body: { sizePt: 13.5, leadingPt: 18 },
    label: { sizePt: 12, leadingPt: 15.5 },
    caption: { sizePt: 10.5, leadingPt: 14 },
  },
};

/** font/ink/spacingClass assignment per style — same for every scale. */
const STYLE_META = {
  heading1: { font: 'bold', ink: 'text', spacingClass: 'heading' },
  heading2: { font: 'bold', ink: 'text', spacingClass: 'heading' },
  heading3: { font: 'bold', ink: 'text', spacingClass: 'heading' },
  body: { font: 'regular', ink: 'text', spacingClass: 'body' },
  label: { font: 'bold', ink: 'text', spacingClass: 'body' },
  caption: { font: 'italic', ink: 'muted', spacingClass: 'instruction' },
};

/**
 * spacing[previousClass][nextClass] — the gap BETWEEN two fragments. `compact`
 * tightens every gap relative to `normal`; the ratio is deliberately uniform
 * so the two densities differ predictably rather than reshuffling rhythm.
 */
const NORMAL_SPACING = {
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

    // placeholder geometry — revisit when consumed (Tasks 5-6)
    /** Page furniture geometry for later phases (footer bands, continuation strips, gutters). */
    furniture: {
      footerBandPt: density === 'compact' ? 22 : 28,
      continuationStripPt: density === 'compact' ? 14 : 18,
      gutterPt: 0,
    },

    // placeholder geometry — revisit when consumed (Tasks 5-6)
    /** Glyph-circle badge geometry (e.g. numbered/lettered markers), for later phases. */
    badge: {
      diameterPt: typeScale === 'young' ? 20 : 16,
      strokeWidthPt: 1,
      font: 'bold',
      sizePt: typeScale === 'young' ? 11 : 9,
    },

    // placeholder geometry — revisit when consumed (Tasks 5-6)
    /** Inset box geometry (bordered callouts, answer boxes), for later phases. */
    box: {
      radiusPt: 4,
      paddingPt: density === 'compact' ? 6 : 9,
      borderWidthPt: 0.9,
    },
  };

  return deepFreeze(theme);
}

export default { createWorkbookTheme, WORKBOOK_TYPE_SCALES, WORKBOOK_DENSITIES };
