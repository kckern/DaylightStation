/**
 * Block measurers — validated blocks in, layout fragments out.
 *
 * This is the "measure" half of the measure-then-place design: it turns each
 * block into the geometry `layout.mjs` places, using a real PDFDocument purely
 * as a font-metrics oracle. That document is NEVER written anywhere; nothing
 * here produces bytes.
 *
 * Two invariants make the golden snapshots meaningful:
 *
 * 1. **Measurement is the drawing plan.** Lines are wrapped here, word by word,
 *    with each word's x offset recorded — the draw pass replays those numbers
 *    instead of re-wrapping with pdfkit's own layout. Measure and draw cannot
 *    disagree about where line 4 sits, because there is only one calculation.
 * 2. **A question is one atomic fragment.** Its stem, math, bubbles and answer
 *    space are nodes with offsets inside that fragment, so a page break can
 *    never land between a question and the space to answer it.
 *
 * INLINE MATH IS DEFERRED (v1). A `$...$` span inside `rich_text` is promoted to
 * its own display-math fragment rather than measured as an inline run: getting
 * an inline baseline subtly wrong shifts every following glyph on the line, and
 * the worksheet corpus is display-dominant. Nothing prints a literal `$`.
 *
 * @module rendering/school/documents/measure
 */

import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

import { placeFragments } from './layout.mjs';
import { documentPdfTheme } from './documentPdfTheme.mjs';
import { texToSvg as mathJaxTexToSvg } from './mathSvg.mjs';

/** Bundled font assets, resolved against this module — never the process cwd. */
const DEFAULT_FONT_DIR = fileURLToPath(new URL('../../../../assets/fonts', import.meta.url));

/** Markdown subset: ATX headings, blank-line paragraphs, `-`/`*` bullets. */
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const BULLET_PREFIX = '•  ';
/**
 * Inline spans: **bold**, `code`, $math$ — in one pass so nesting can't reorder
 * them. `**bold**` is tried before the single-star italic alternative at every
 * position, so `**x**` can never be misread as italic-of-`*x*` (see v2 note below).
 */
const INLINE_SPAN_PLAIN = /\*\*(?<bold>[^*]+)\*\*|`(?<code>[^`]+)`|\$(?<math>[^$\n]+)\$/g;
/**
 * v2: adds `*italic*` to the grammar, gated behind `{italic: true}` so v1
 * callers (and every existing golden) parse exactly as before — this pattern
 * is never used unless a caller opts in.
 */
const INLINE_SPAN_ITALIC = /\*\*(?<bold>[^*]+)\*\*|\*(?<italic>[^*\n]+)\*|`(?<code>[^`]+)`|\$(?<math>[^$\n]+)\$/g;
/**
 * Cloze's own inline grammar (spec §6.3): identical bold/code/math handling to
 * `inlineRuns` (math kept LITERAL, same rationale — a cloze passage is ONE
 * wrapped node, so promoting math out of it would orphan it from its own
 * blanks), plus `{{n}}` blank markers as a new alternative. A SEPARATE pair of
 * patterns rather than extending `INLINE_SPAN_PLAIN`/`INLINE_SPAN_ITALIC` in
 * place: those two are relied on, unmodified, by every non-cloze caller
 * (`segmentParagraph`, `inlineRuns`), and this module's own doctrine is that
 * measurement is the drawing plan — changing a shared pattern's alternation
 * order/group set is exactly the kind of edit that could silently reshuffle
 * which branch wins for existing text.
 */
const CLOZE_SPAN_PLAIN = /\*\*(?<bold>[^*]+)\*\*|`(?<code>[^`]+)`|\$(?<math>[^$\n]+)\$|\{\{(?<blank>\d+)\}\}/g;
const CLOZE_SPAN_ITALIC = /\*\*(?<bold>[^*]+)\*\*|\*(?<italic>[^*\n]+)\*|`(?<code>[^`]+)`|\$(?<math>[^$\n]+)\$|\{\{(?<blank>\d+)\}\}/g;

/** A block type with no Letter renderer — refuse rather than print a blank space. */
export class UnsupportedBlockError extends Error {
  constructor(type, path) {
    super(`${path}: block type '${type}' has no Letter renderer`);
    this.name = 'UnsupportedBlockError';
    this.path = path;
    this.blockType = type;
  }
}

/** A block that could not be measured (bad TeX, unresolvable geometry), with its path. */
export class BlockMeasureError extends Error {
  constructor(message, path, cause) {
    super(`${path}: ${message}`);
    this.name = 'BlockMeasureError';
    this.path = path;
    this.cause = cause;
  }
}

/**
 * A bubble row whose choice text cannot be resolved from the question bank.
 * Printing bare bubbles would hand a child a sheet they cannot answer and a
 * grader a sheet that scans but means nothing, so the render refuses.
 */
export class MissingChoicesError extends Error {
  constructor(message, path, itemId) {
    super(`${path}: ${message}`);
    this.name = 'MissingChoicesError';
    this.path = path;
    this.itemId = itemId;
  }
}

/**
 * An `asset` block whose ref no resolver could turn into artwork. A bordered
 * empty rectangle on a worksheet is a silent failure — the diagram the question
 * depends on is simply gone — so this fails at measure time, where the publish
 * gate sees it.
 */
export class UnresolvedAssetError extends Error {
  constructor(ref, path) {
    super(`${path}: asset '${ref}' could not be resolved to artwork`);
    this.name = 'UnresolvedAssetError';
    this.path = path;
    this.ref = ref;
  }
}

/**
 * Register the theme's TTFs on a pdfkit document under their theme alias.
 * Shared by the measurement document and the output document so both resolve
 * `theme.fonts.bold` to the same face.
 */
export function registerDocumentFonts(doc, { theme = documentPdfTheme, fontDir = DEFAULT_FONT_DIR } = {}) {
  for (const font of Object.values(theme.fonts)) {
    doc.registerFont(font.name, `${fontDir}/${font.file}`);
  }
  return doc;
}

/**
 * A PDFDocument used only for `widthOfString`. It is never ended, never
 * streamed, and never written to disk.
 */
export function createMeasurementDocument({ theme = documentPdfTheme, fontDir = DEFAULT_FONT_DIR } = {}) {
  const doc = new PDFDocument({ size: 'letter', margin: theme.page.marginPt, autoFirstPage: false });
  return registerDocumentFonts(doc, { theme, fontDir });
}

const stringWidth = (doc, theme, fontKey, sizePt, text) =>
  doc.font(theme.fonts[fontKey].name).fontSize(sizePt).widthOfString(text);

/**
 * Typographic quotes. A worksheet is typeset, not code: it must never show a
 * straight quote or apostrophe. This runs at the rendering boundary — on every
 * paragraph of rich text and on every choice label read from a bank — so the
 * guarantee holds no matter which pipeline produced the document, including a
 * hand-authored one that never passed through `issueWorksheet`.
 *
 * A quote opens after start-of-string, whitespace or an opening bracket and
 * closes otherwise, which makes `don't` an apostrophe without having to know
 * it is a contraction.
 */
export function curlyQuotes(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    .replace(/"([^"]*)"/g, '\u201c$1\u201d')
    .replace(/(^|[\s([{<\u2014\u2013-])'/g, '$1\u2018')
    .replace(/'/g, '\u2019')
    .replace(/(^|[\s([{<\u2014\u2013-])"/g, '$1\u201c')
    .replace(/"/g, '\u201d');
}

/** Paragraph descriptors from a constrained-Markdown source. */
function splitParagraphs(md) {
  const paragraphs = [];
  for (const chunk of curlyQuotes(String(md)).split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    let buffer = [];
    const flush = () => {
      if (buffer.length) paragraphs.push({ style: 'body', text: buffer.join(' ') });
      buffer = [];
    };
    for (const line of lines) {
      const heading = HEADING.exec(line);
      const bullet = BULLET.exec(line);
      if (heading) { flush(); paragraphs.push({ style: 'heading', text: heading[2] }); continue; }
      if (bullet) { flush(); paragraphs.push({ style: 'body', text: BULLET_PREFIX + bullet[1] }); continue; }
      buffer.push(line);
    }
    flush();
  }
  return paragraphs;
}

/**
 * Split one paragraph into alternating text/math segments.
 *
 * @param {string} text
 * @param {Object} [opts]
 * @param {boolean} [opts.italic=false] - recognise `*italic*` spans. OFF by
 *   default so every v1 caller (and its goldens) parses exactly as before; a
 *   lone `*` is then left as literal text, same as today.
 * @returns {Array<{ kind: 'text', runs: Array<{text:string, font:string}> } | { kind: 'math', tex: string }>}
 */
function segmentParagraph(text, { italic = false } = {}) {
  const segments = [];
  let runs = [];
  const pushText = (raw, font) => { if (raw) runs.push({ text: raw, font }); };
  const flushText = () => {
    if (runs.some((r) => r.text.trim())) segments.push({ kind: 'text', runs });
    runs = [];
  };

  const pattern = italic ? INLINE_SPAN_ITALIC : INLINE_SPAN_PLAIN;
  pattern.lastIndex = 0;
  let cursor = 0;
  let match = pattern.exec(text);
  while (match) {
    pushText(text.slice(cursor, match.index), 'regular');
    const { bold, italic: italicText, code, math } = match.groups;
    if (bold !== undefined) pushText(bold, 'bold');
    else if (italicText !== undefined) pushText(italicText, 'italic');
    else if (code !== undefined) pushText(code, 'regular');
    else { flushText(); segments.push({ kind: 'math', tex: math }); }
    cursor = match.index + match[0].length;
    match = pattern.exec(text);
  }
  pushText(text.slice(cursor), 'regular');
  flushText();
  return segments;
}

/**
 * Inline runs for a plain (non-paragraph-split) string: bold/italic/code
 * spans, `$...$` kept LITERAL (never promoted to a math node). Used by
 * content blocks whose text is not the `rich_text` markdown grammar —
 * passage bodies/citations, figure captions/credits — where a stray `$`
 * should just print rather than reflow the block around a display-math node.
 *
 * @param {string} text
 * @param {Object} [opts]
 * @param {boolean} [opts.italic=false] - see segmentParagraph
 * @param {'regular'|'italic'} [opts.baseFont='regular'] - font for
 *   unmarked text; callers measuring an already-italic style (captions,
 *   citations) pass 'italic' so plain text in that run matches its style
 *   without needing every word wrapped in `*asterisks*`. Bold spans inside an
 *   italic base use the bold-italic face rather than losing the slant.
 * @returns {Array<{text: string, font: string}>}
 */
function inlineRuns(text, { italic = false, baseFont = 'regular' } = {}) {
  const boldFont = baseFont === 'italic' ? 'boldItalic' : 'bold';
  const pattern = italic ? INLINE_SPAN_ITALIC : INLINE_SPAN_PLAIN;
  pattern.lastIndex = 0;
  const runs = [];
  const push = (raw, font) => { if (raw) runs.push({ text: raw, font }); };
  let cursor = 0;
  let match = pattern.exec(text);
  while (match) {
    push(text.slice(cursor, match.index), baseFont);
    const { bold, italic: italicText, code } = match.groups;
    if (bold !== undefined) push(bold, boldFont);
    else if (italicText !== undefined) push(italicText, 'italic');
    else if (code !== undefined) push(code, baseFont);
    else push(match[0], baseFont); // math group: kept literal, including the `$`s
    cursor = match.index + match[0].length;
    match = pattern.exec(text);
  }
  push(text.slice(cursor), baseFont);
  return runs;
}

/**
 * Inline items for a `cloze` block's `text` (spec §6.3): same bold/code/math
 * handling as `inlineRuns` (math kept literal — see the `CLOZE_SPAN_*` doc
 * comment), plus `{{n}}` blank markers turned into `{kind:'blank', n, widthPt}`
 * items instead of text pieces. `widthPt` comes from the NEW `theme.blank`
 * size tokens, keyed by the matching entry in `blanksByN` — never sized to
 * the answer text (spec: "never sized to the answer — answer-length leaks are
 * a pedagogical bug"). A marker with no matching `blanksByN` entry (cannot
 * happen past `blocks.mjs` validation, which requires one `blanks[]` entry per
 * `{{n}}`) falls back to the 'm' width class rather than crashing measurement.
 *
 * @returns {Array<{text:string, font:string}|{kind:'blank', n:number, widthPt:number}>}
 *   fed straight into `tokenizeRuns`/`wrapRuns`, which special-case the
 *   `kind:'blank'` shape as one unbreakable word.
 */
function clozeInlineItems(text, blanksByN, theme, { italic = false } = {}) {
  const pattern = italic ? CLOZE_SPAN_ITALIC : CLOZE_SPAN_PLAIN;
  pattern.lastIndex = 0;
  const items = [];
  const push = (raw, font) => { if (raw) items.push({ text: raw, font }); };
  let cursor = 0;
  let match = pattern.exec(text);
  while (match) {
    push(text.slice(cursor, match.index), 'regular');
    const {
      bold, italic: italicText, code, math, blank,
    } = match.groups;
    if (bold !== undefined) push(bold, 'bold');
    else if (italicText !== undefined) push(italicText, 'italic');
    else if (code !== undefined) push(code, 'regular');
    else if (math !== undefined) push(match[0], 'regular'); // kept literal, including the `$`s
    else {
      const n = Number(blank);
      const widthKey = blanksByN.get(n)?.width ?? 'm';
      items.push({ kind: 'blank', n, widthPt: theme.blank[widthKey] });
    }
    cursor = match.index + match[0].length;
    match = pattern.exec(text);
  }
  push(text.slice(cursor), 'regular');
  return items;
}

/**
 * Split styled runs into words. A word may span runs: `**simplest form**.` puts
 * the closing period in a different run from `form` with no whitespace between
 * them, and they must stay one word — otherwise the period drifts a space away
 * from the word it belongs to, and can even wrap to the next line alone.
 *
 * @returns {Array<{ pieces: Array<{text: string, font: string}> }>}
 */
function tokenizeRuns(runs) {
  const words = [];
  let current = null;
  for (const run of runs) {
    // A cloze blank atom (measure.mjs's `clozeInlineItems`) is its OWN word —
    // it never merges with adjacent text the way run-spanning pieces do above,
    // because it carries no font/text to tokenize by whitespace at all.
    if (run.kind === 'blank') {
      current = null;
      words.push({ pieces: [{ kind: 'blank', n: run.n, widthPt: run.widthPt }] });
      continue;
    }
    if (run.kind === 'math') {
      current = null;
      words.push({ pieces: [{ kind: 'math', ...run }] });
      continue;
    }
    for (const part of run.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { current = null; continue; }
      if (!current) { current = { pieces: [] }; words.push(current); }
      current.pieces.push({ text: part, font: run.font });
    }
  }
  return words;
}

/**
 * The constrained-Markdown grammar, flattened for targets that do not style
 * inline runs (the thermal receipt). ONE grammar for both targets: a second
 * parser would eventually disagree with this one about what a `##` means.
 *
 * @param {string} md
 * @param {Object} [opts]
 * @param {boolean} [opts.italic=false] - recognise `*italic*` spans (v2). OFF
 *   by default: every v1 caller keeps parsing `*text*` as literal asterisks,
 *   byte-identical to before this option existed.
 * @returns {Array<{style: string, kind: 'text', text: string} | {style: string, kind: 'math', tex: string}>}
 */
export function parseRichText(md, { italic = false } = {}) {
  return splitParagraphs(md).flatMap((paragraph) =>
    segmentParagraph(paragraph.text, { italic }).map((segment) => (segment.kind === 'math'
      ? { style: paragraph.style, kind: 'math', tex: segment.tex }
      : { style: paragraph.style, kind: 'text', text: segment.runs.map((run) => run.text).join('') })));
}

/**
 * Greedy word wrap across styled runs.
 *
 * Advance rule (identical in the draw pass): each piece is drawn at its recorded
 * x, and after a whole word x advances by a space measured in that word's last
 * font. Sharing one rule is what keeps measurement honest.
 */
function wrapRuns(doc, theme, runs, { widthPt, sizePt, leadingPt }) {
  const words = tokenizeRuns(runs);

  const lines = [];
  let current = [];
  let xPt = 0;
  const flush = () => {
    if (!current.length) return;
    const last = current[current.length - 1];
    lines.push({ runs: current, widthPt: last.xPt + last.widthPt, heightPt: leadingPt });
    current = [];
    xPt = 0;
  };

  for (const word of words) {
    // A blank piece (cloze atom) already carries its final widthPt from
    // `theme.blank` — it is never measured via `stringWidth` (it has no
    // `.text`/`.font`, only `n`/`widthPt`), which is what makes it a
    // fixed-width atom rather than one sized to its own content.
    const pieces = word.pieces.map((piece) => (piece.kind === 'blank' || piece.kind === 'math'
      ? { ...piece, sizePt }
      : { ...piece, sizePt, widthPt: stringWidth(doc, theme, piece.font, sizePt, piece.text) }));
    const wordWidth = pieces.reduce((total, piece) => total + piece.widthPt, 0);
    // `?? 'regular'`: a word made ENTIRELY of a blank piece has no `.font` to
    // measure the trailing space in — every other word still measures the
    // space in its actual last font, unchanged.
    const spaceWidth = stringWidth(doc, theme, pieces[pieces.length - 1].font ?? 'regular', sizePt, ' ');
    // A word that overruns on its own is placed alone: breaking inside a word
    // would silently alter what the child reads.
    if (current.length && xPt + wordWidth > widthPt) flush();
    for (const piece of pieces) {
      current.push({ ...piece, xPt });
      xPt += piece.widthPt;
    }
    xPt += spaceWidth;
  }
  flush();
  return lines;
}

function measureTextLines(doc, theme, runs, { widthPt, styleKey }) {
  const style = theme.styles[styleKey];
  const lines = wrapRuns(doc, theme, runs, {
    widthPt, sizePt: style.sizePt, leadingPt: style.leadingPt,
  });
  return { style, styleKey, lines, heightPt: lines.length * style.leadingPt };
}

function measureMathNode(ctx, tex, { display, widthPt, path }) {
  let svg;
  try {
    svg = ctx.texToSvg(tex, { display, fontSizePt: ctx.theme.math.fontSizePt, ink: ctx.theme.ink.text });
  } catch (err) {
    throw new BlockMeasureError(err?.message ?? String(err), path, err);
  }
  const availablePt = widthPt - ctx.theme.math.indentPt;
  const scale = svg.widthPt > availablePt && svg.widthPt > 0 ? availablePt / svg.widthPt : 1;
  const drawWidthPt = svg.widthPt * scale;
  const drawHeightPt = svg.heightPt * scale;
  return {
    kind: 'math',
    svgString: svg.svgString,
    scale,
    drawWidthPt,
    drawHeightPt,
    indentPt: ctx.theme.math.indentPt,
    widthPt,
    heightPt: drawHeightPt + ctx.theme.math.padAbovePt + ctx.theme.math.padBelowPt,
    padAbovePt: ctx.theme.math.padAbovePt,
  };
}

/**
 * An asset is measured at the size its resolver reports.
 *
 * With a resolver that cannot produce artwork, this throws: an empty bordered
 * rectangle where the diagram should be is a silent failure — the child is
 * asked about a picture that is not on the page. With NO resolver at all it
 * reserves probe geometry, for the same reason bubble rows do (the publish gate
 * has no asset resolver wired); the draw pass refuses an unresolved node.
 */
function measureAssetNode(ctx, block, { widthPt, path }) {
  const { theme } = ctx;
  const resolved = ctx.resolveAsset ? ctx.resolveAsset(block.ref) : null;
  if (ctx.resolveAsset && !resolved?.svg) throw new UnresolvedAssetError(block.ref, path);

  const caption = measureTextLines(ctx.doc, theme, [{ text: block.alt, font: 'regular' }], {
    widthPt, styleKey: 'instruction',
  });
  const naturalWidth = resolved?.widthPt > 0 ? resolved.widthPt : widthPt;
  const naturalHeight = resolved?.heightPt > 0 ? resolved.heightPt : theme.asset.placeholderHeightPt;
  const scale = Math.min(widthPt / naturalWidth, theme.asset.maxHeightPt / naturalHeight, 1);
  const drawWidthPt = naturalWidth * scale;
  const drawHeightPt = naturalHeight * scale;

  return {
    kind: 'asset',
    resolved: Boolean(resolved?.svg),
    svg: resolved?.svg ?? null,
    ref: block.ref,
    drawWidthPt,
    drawHeightPt,
    caption,
    widthPt,
    heightPt: drawHeightPt + theme.asset.captionGapPt + caption.heightPt,
  };
}

/**
 * `resolveChoices` has two legal return shapes:
 *  - a bare `string[]` of labels — the ORIGINAL contract, still what every
 *    non-multi_select caller (and `measure.test.mjs`'s own stub, a legacy
 *    suite this task must not touch) returns. Treated exactly as before:
 *    multiple_choice, circles, no instruction line.
 *  - `{labels, multiSelect: true, maxSelect?}` — multi_select's richer shape
 *    (spec §5.5): square checkboxes instead of circles, plus an instruction
 *    caption. `createChoiceResolver` (DocumentPdfRenderer.mjs) is the only
 *    production caller of the second shape, and only for a bank item whose
 *    own `type` is `'multi_select'` — every other item keeps returning the
 *    bare array, so ordinary multiple_choice rendering is untouched.
 */
function normalizeChoiceResolution(resolved) {
  if (!resolved) return { labels: null, multiSelect: false, maxSelect: undefined };
  if (Array.isArray(resolved)) return { labels: resolved, multiSelect: false, maxSelect: undefined };
  return { labels: resolved.labels, multiSelect: resolved.multiSelect === true, maxSelect: resolved.maxSelect };
}

/**
 * A bubble row: one cell per choice, all bubbles on ONE baseline, the choice
 * text wrapped underneath its own bubble.
 *
 * Choice TEXT is never duplicated into the document — it lives in the question
 * bank, which is also what the grader scores against, so paper and grader
 * cannot drift. `resolveChoices` is how the bank reaches the page.
 *
 * With no resolver (the publish-time probe, which has no banks wired) the row
 * is measured in probe mode: bubbles plus a conservative reservation for the
 * choice text, enough to fail a page that could not fit the real thing. Probe
 * mode NEVER produces a printable row — the draw pass refuses a cell with no
 * label.
 */
function measureOmrNode(ctx, block, { widthPt, path }) {
  const { theme, doc } = ctx;
  const availablePt = widthPt - theme.omr.indentPt;
  const compact = block.layout === 'compact';
  const resolved = ctx.resolveChoices
    ? ctx.resolveChoices(block.itemId, { choices: block.choices, path })
    : null;
  const { labels, multiSelect, maxSelect } = normalizeChoiceResolution(resolved);
  const choiceRuns = (label) => segmentParagraph(label, { italic: false }).flatMap((segment) => {
    if (segment.kind === 'text') return segment.runs;
    const svg = ctx.texToSvg(segment.tex, {
      display: false, fontSizePt: theme.omr.choiceSizePt, ink: theme.ink.text,
    });
    return [{ kind: 'math', svgString: svg.svgString, widthPt: svg.widthPt, heightPt: svg.heightPt }];
  });
  const mathOnly = (label) => /^\$([^$]+)\$$/u.exec(label.trim());
  const choiceWidth = (label) => {
    const runs = choiceRuns(label);
    return runs.reduce((sum, run) => sum + (run.kind === 'math'
      ? run.widthPt
      : stringWidth(doc, theme, run.font, theme.omr.choiceSizePt, run.text)), 0);
  };
  let columnCount = block.choices;
  if (compact) {
    const maxLabelPt = labels
      ? Math.max(...labels.map((label) => choiceWidth(String(label))))
      : availablePt;
    columnCount = Math.min(5, block.choices);
    while (columnCount > 2 && maxLabelPt > availablePt / columnCount - theme.omr.compactLabelWidthPt - 2) columnCount -= 1;
  }
  const cellWidthPt = availablePt / columnCount;

  const cells = [];
  for (let index = 0; index < block.choices; index += 1) {
    const label = labels ? String(labels[index]) : null;
    cells.push({
      choice: theme.omr.letters[index],
      label,
      lines: label
        ? wrapRuns(doc, theme, choiceRuns(label), {
          widthPt: compact ? cellWidthPt - theme.omr.compactLabelWidthPt - 2 : cellWidthPt,
          sizePt: theme.omr.choiceSizePt, leadingPt: theme.omr.choiceLeadingPt,
        })
        : [],
    });
  }

  const compactRows = Math.ceil(block.choices / columnCount);
  // `compactRowPadPt` (theme-driven, not a bare literal): a compact omr row's
  // choices sit on one baseline per row with a fixed pad below the tallest
  // wrapped label — pure whitespace around already-sized choice text, so
  // `workbookTheme`'s `compact` density tightens it exactly like every other
  // inter-element gap. `drawOmrRow` (DocumentPdfRenderer.mjs) computes this
  // SAME `rowLeading` independently (it draws from `node.layout`/`node.cells`,
  // not from this returned node's height) and MUST read the identical token —
  // a measure/draw disagreement here is exactly the "fit decision drawn
  // differently" class of bug this codebase's own doctrine forbids.
  // Compact choices are a grid, not a fixed-height table. Each visual row
  // gets only the height its own wrapped labels need; using the tallest label
  // in the whole question for every row left a conspicuous empty band below a
  // later all-one-line row before the final option(s).
  const compactRowHeights = compact
    ? Array.from({ length: compactRows }, (_, row) => {
      const rowCells = cells.slice(row * columnCount, (row + 1) * columnCount);
      const lineCount = labels
        ? Math.max(...rowCells.map((cell) => cell.lines.length))
        : theme.omr.probeChoiceLines;
      return lineCount * theme.omr.choiceLeadingPt + theme.omr.compactRowPadPt;
    })
    : null;
  const textLines = labels
    ? Math.max(...cells.map((cell) => cell.lines.length))
    : theme.omr.probeChoiceLines;
  const compactHeight = compact
    ? compactRowHeights.reduce((sum, height) => sum + height, 0)
    : theme.omr.rowHeightPt + theme.omr.choiceGapPt + textLines * theme.omr.choiceLeadingPt;

  // multi_select's instruction caption (spec §5.3's row-mapped disposition
  // text): "Choose up to N." when the bank item caps the selection,
  // otherwise "Mark all that apply." — never present for an ordinary
  // multiple_choice/probe row, so `instruction` stays null and the height
  // formula below is byte-identical to before this feature existed.
  const instructionText = multiSelect
    ? (maxSelect ? `Choose up to ${maxSelect}.` : 'Mark all that apply.')
    : null;
  const instruction = instructionText
    ? measureTextLines(doc, theme, [{ text: instructionText, font: 'italic' }], { widthPt, styleKey: 'caption' })
    : null;

  return {
    kind: 'omr',
    itemId: block.itemId,
    choices: block.choices,
    cells,
    cellWidthPt,
    labelled: Boolean(labels),
    multiSelect,
    layout: compact ? 'compact' : 'row',
    columnCount,
    compactRowHeights,
    instruction,
    // The instruction belongs to this answer row, not to the preceding
    // prompt. Tuck it slightly into the prompt's trailing leading so
    // "Mark all that apply" reads as a compact qualifier, rather than a
    // separate paragraph with a conspicuous empty band above it.
    // Treat the qualifier as the prompt's second line.  A full inter-node
    // gap makes a short "Mark all that apply" caption look detached from its
    // question and wastes vertical space on dense worksheets.
    ...(instruction ? { gapBeforePt: -5 } : {}),
    widthPt,
    heightPt: (instruction ? instruction.heightPt + theme.omr.instructionGapPt : 0)
      + compactHeight,
  };
}

/**
 * Token VALUES arrive from the caller (IDocumentRenderer's `opts.tokens`, keyed
 * by action) or from the document data. The renderer only draws them; nothing
 * here mints, signs, or derives a code.
 */
function actionCodeText(block, tokens) {
  // Never the internal action id as a printed caption (design audit #10): a
  // proof render with no tokens used to put 'recovery' / 'media_action' in
  // grey mono on a child's worksheet. No real code -> no caption; the QR
  // still encodes the placeholder for proofing.
  return tokens?.[block.action] ?? block.code ?? block.token ?? '';
}

/**
 * A `passage`/`source` citation line, formatted `Title, by Author (Locator)`.
 * Every part is optional except title, which `blocks.mjs` already requires
 * whenever `source` is present at all.
 */
function citationLine(source) {
  if (!source) return null;
  const parts = [source.title];
  if (source.author) parts.push(`by ${source.author}`);
  const base = parts.join(', ');
  return source.locator ? `${base} (${source.locator})` : base;
}

/**
 * `passage` → 1-2 `text` nodes: the (optional) body and the (optional)
 * citation. `measureBlocks`' generic node→fragment pipeline then gives each
 * its OWN flowable fragment, exactly like a `rich_text` heading/body pair —
 * which is what makes the body independently breakable across pages while
 * still respecting its own widow/orphan minima (spec §7's "keeps ≥2 lines
 * with its first following question").
 *
 * v1 SCOPE: passage prose is wrapped as ONE continuous paragraph — internal
 * blank lines collapse to a single space rather than becoming visible stanza
 * breaks — and inline `$...$` is kept literal (see `inlineRuns`), so a line
 * number always lines up 1:1 with a wrapped output line. Multi-paragraph
 * reading passages and inline math within one are both out of v1 scope.
 */
function measurePassageNodes(ctx, block, { widthPt, path }) {
  const { theme, doc } = ctx;
  const mode = block.mode ?? 'reprint';
  const citation = citationLine(block.source);

  const buildCitationNode = () => {
    const runs = inlineRuns(citation, { italic: ctx.italic, baseFont: 'italic' });
    return { kind: 'text', ...measureTextLines(doc, theme, runs, { widthPt, styleKey: 'caption' }), widthPt };
  };

  if (mode === 'cite') {
    // A passage told to print ONLY its citation with nothing to cite is an
    // authoring bug, not a blank line to print silently.
    if (!citation) throw new BlockMeasureError('passage mode "cite" needs a source citation', path);
    return [buildCitationNode()];
  }

  const lineNumbers = block.lineNumbers === true;
  const gutterPt = lineNumbers ? theme.passage.lineNumberGutterPt : 0;
  const normalized = String(block.text).trim().replace(/\s+/g, ' ');
  const runs = inlineRuns(normalized, { italic: ctx.italic });
  const measured = measureTextLines(doc, theme, runs, { widthPt: widthPt - gutterPt, styleKey: 'body' });
  // Baked onto each LINE (not derived from array position at draw time) so a
  // page split — which slices this array — carries correct numbers on both
  // halves for free.
  if (lineNumbers) measured.lines.forEach((line, index) => { line.lineNumber = index + 1; });

  const nodes = [{
    kind: 'text',
    ...measured,
    widthPt: widthPt - gutterPt,
    gutterPt,
    lineNumbers,
    minLinesBeforeBreak: theme.passage.minLinesBeforeBreak,
    minLinesAfterBreak: theme.passage.minLinesAfterBreak,
  }];
  if (citation) nodes.push(buildCitationNode());
  return nodes;
}

/**
 * `figure` → asset + caption (+ optional credit) nodes. Returned as an ARRAY
 * so `measureNodes` can also produce them for a figure nested one level inside
 * an `inset`; the top-level `figure` block instead goes through
 * `figureFragment`, which stacks these into ONE atomic fragment so the image
 * can never separate from its caption.
 */
function buildFigureNodes(ctx, block, { widthPt, path }) {
  const { theme, doc } = ctx;
  const resolved = ctx.resolveAsset ? ctx.resolveAsset(block.asset) : null;
  if (ctx.resolveAsset && !resolved?.svg) throw new UnresolvedAssetError(block.asset, path);
  const naturalWidth = resolved?.widthPt > 0 ? resolved.widthPt : widthPt;
  const naturalHeight = resolved?.heightPt > 0 ? resolved.heightPt : theme.asset.placeholderHeightPt;
  const scale = Math.min(widthPt / naturalWidth, theme.asset.maxHeightPt / naturalHeight, 1);

  const imageNode = {
    kind: 'asset',
    resolved: Boolean(resolved?.svg),
    svg: resolved?.svg ?? null,
    ref: block.asset,
    drawWidthPt: naturalWidth * scale,
    drawHeightPt: naturalHeight * scale,
    // No baked-in caption (unlike the legacy `asset` block): the caption is
    // its OWN sibling node below, so it can carry a credit line beside it.
    caption: null,
    widthPt,
    heightPt: naturalHeight * scale,
  };
  const captionNode = {
    kind: 'text',
    ...measureTextLines(doc, theme, inlineRuns(block.caption, { italic: ctx.italic, baseFont: 'italic' }), {
      widthPt, styleKey: 'caption',
    }),
    widthPt,
  };
  const nodes = [imageNode, captionNode];
  if (block.credit) {
    nodes.push({
      kind: 'text',
      ...measureTextLines(doc, theme, inlineRuns(block.credit, { italic: ctx.italic, baseFont: 'italic' }), {
        widthPt, styleKey: 'caption',
      }),
      widthPt,
    });
  }
  return nodes;
}

/**
 * `list` → ONE `list` node: bullet/numbered/checklist items in a fixed-width
 * marker column (never sized to content — same "don't leak the answer"
 * philosophy as spec §6.3's cloze blanks). Checklist items carry NO marker
 * text at all; the draw pass strokes an empty square, the same vector-primitive
 * approach the OMR row uses for its bubbles, rather than trusting a Unicode
 * box-glyph to exist in the embedded font.
 */
function measureListNode(ctx, block, { widthPt }) {
  const { theme, doc } = ctx;
  const { list } = theme;
  const bodyStyle = theme.styles.body;
  const bodyWidthPt = widthPt - list.markerColumnPt;
  const items = block.items.map((text, index) => {
    const runs = inlineRuns(text, { italic: ctx.italic });
    const lines = wrapRuns(doc, theme, runs, {
      widthPt: bodyWidthPt, sizePt: bodyStyle.sizePt, leadingPt: bodyStyle.leadingPt,
    });
    const marker = block.style === 'checklist' ? null
      : block.style === 'numbered' ? `${index + 1}.`
        : list.bulletCharacter;
    return { marker, lines, heightPt: Math.max(lines.length, 1) * bodyStyle.leadingPt };
  });
  const heightPt = stackNodes(items, list.itemGapPt);
  return {
    kind: 'list', style: block.style, markerColumnPt: list.markerColumnPt, items, widthPt, heightPt,
  };
}

/**
 * `wordbank` → ONE `wordbank` node: a boxed (theme.box border/padding/radius),
 * seeded-shuffled term set (spec §6.2), printed as a WRAPPING FLOW of terms —
 * not a bulleted list — in `label` style. Terms print in the order given:
 * shuffling is an UPSTREAM concern (Task 5 orders `block.terms` before this
 * ever runs), so measurement here is order-agnostic by construction — it just
 * lays out whatever order it is handed.
 */
function measureWordbankNode(ctx, block, { widthPt }) {
  const { theme, doc } = ctx;
  const { box, wordbank } = theme;
  const style = theme.styles.label;
  const innerWidthPt = widthPt - 2 * box.paddingPt;

  const rows = [];
  let current = [];
  let xPt = 0;
  for (const term of block.terms) {
    const termWidthPt = stringWidth(doc, theme, style.font, style.sizePt, term);
    if (current.length && xPt + termWidthPt > innerWidthPt) {
      rows.push(current);
      current = [];
      xPt = 0;
    }
    current.push({ text: term, xPt, widthPt: termWidthPt });
    xPt += termWidthPt + wordbank.termGapPt;
  }
  if (current.length) rows.push(current);

  const rowHeightPt = style.leadingPt;
  const innerHeightPt = rows.length * rowHeightPt + Math.max(rows.length - 1, 0) * wordbank.rowGapPt;

  return {
    kind: 'wordbank',
    rows,
    rowHeightPt,
    rowGapPt: wordbank.rowGapPt,
    paddingPt: box.paddingPt,
    radiusPt: box.radiusPt,
    borderWidthPt: box.borderWidthPt,
    widthPt,
    heightPt: innerHeightPt + 2 * box.paddingPt,
  };
}

/**
 * `matching` → ONE `matching` node: a block-internal two-column layout, NOT
 * the generic (Phase-A-cut) columns container — the two columns exist only
 * inside this one atomic fragment, never as a general document layout
 * primitive. Left items are numbered 1..n, each preceded by a short blank
 * rule the student writes the matching letter into; right items are lettered
 * A..n. `matching` is never row-mapped (spec §6.2), so there is no bubble
 * geometry here at all — just two wrapped text columns with their own marker
 * gutters. Order is as given (see `measureWordbankNode`'s identical note on
 * upstream shuffling).
 */
function measureMatchingNode(ctx, block, { widthPt }) {
  const { theme, doc } = ctx;
  const { matching } = theme;
  const bodyStyle = theme.styles.body;
  const leftMarkerPt = matching.ruleWidthPt + matching.ruleGapPt + matching.numberColPt + matching.numberGapPt;
  const rightMarkerPt = matching.letterColPt + matching.letterGapPt;
  const halfWidthPt = (widthPt - matching.columnGapPt) / 2;
  const leftBodyWidthPt = halfWidthPt - leftMarkerPt;
  const rightBodyWidthPt = halfWidthPt - rightMarkerPt;

  const wrapPlain = (text, colWidthPt) => wrapRuns(doc, theme, [{ text, font: 'regular' }], {
    widthPt: colWidthPt, sizePt: bodyStyle.sizePt, leadingPt: bodyStyle.leadingPt,
  });

  const leftItems = block.left.map((text, index) => {
    const lines = wrapPlain(text, leftBodyWidthPt);
    return {
      number: index + 1, lines, heightPt: Math.max(lines.length, 1) * bodyStyle.leadingPt,
    };
  });
  const rightItems = block.right.map((text, index) => {
    const lines = wrapPlain(text, rightBodyWidthPt);
    return {
      letter: String.fromCharCode(65 + index), lines, heightPt: Math.max(lines.length, 1) * bodyStyle.leadingPt,
    };
  });

  const rowCount = Math.max(leftItems.length, rightItems.length);
  let cursor = 0;
  for (let index = 0; index < rowCount; index += 1) {
    const leftHeightPt = leftItems[index]?.heightPt ?? 0;
    const rightHeightPt = rightItems[index]?.heightPt ?? 0;
    const rowHeightPt = Math.max(leftHeightPt, rightHeightPt, bodyStyle.leadingPt);
    if (leftItems[index]) leftItems[index].offsetYPt = cursor;
    if (rightItems[index]) rightItems[index].offsetYPt = cursor;
    cursor += rowHeightPt + (index < rowCount - 1 ? matching.rowGapPt : 0);
  }

  return {
    kind: 'matching',
    left: leftItems,
    right: rightItems,
    leftMarkerPt,
    rightMarkerPt,
    ruleWidthPt: matching.ruleWidthPt,
    numberColPt: matching.numberColPt,
    letterColPt: matching.letterColPt,
    halfWidthPt,
    columnGapPt: matching.columnGapPt,
    widthPt,
    heightPt: cursor,
  };
}

/**
 * `answer_key` (teacher render mode only — see the `measureNodes` case
 * comment above): a dense, single-column "<label>  <answer>" list, printed
 * at `theme.answerKey.lineStyleKey` ('caption' — italic, muted, smaller than
 * body) — the style this theme reserves for meta/reference text, never
 * primary content. The section's own HEADING ("Answer key — <title>
 * (variant N)") is NOT drawn by this node — `RenderPrintDocument` sets it as
 * the mini key-document's `title` instead, so it reuses the existing
 * `headerFragment` banner (bold title + rule) rather than duplicating that
 * mechanism here. `block.entries` already carries fully-formatted
 * `{label, text}` strings (RenderPrintDocument resolved every answer against
 * the bank before this ever runs — see this module's own doctrine,
 * "Answer-key separation": rendering draws what it is handed, it does not
 * know what a bank item is). Row gaps are deliberately tight
 * (`theme.answerKey.rowGapPt`, far below any `theme.spacing[...]` value) —
 * "dense end-of-doc key" (spec §5.4-analog), not one answer per paragraph.
 */
function measureAnswerKeyNode(ctx, block, { widthPt }) {
  const { theme, doc } = ctx;
  const { answerKey } = theme;

  let cursor = 0;
  const entries = block.entries.map((entry) => {
    const runs = entry.label
      ? [{ text: `${entry.label} `, font: 'bold' }, { text: entry.text, font: 'regular' }]
      : [{ text: entry.text, font: 'regular' }];
    const measured = measureTextLines(doc, theme, runs, { widthPt, styleKey: answerKey.lineStyleKey });
    const offsetYPt = cursor;
    cursor += measured.heightPt + answerKey.rowGapPt;
    return { lines: measured.lines, offsetYPt };
  });

  return {
    kind: 'answerKey',
    entries,
    widthPt,
    heightPt: entries.length ? cursor - answerKey.rowGapPt : 0,
  };
}

/**
 * `inset` → ONE `box` node wrapping its children's nodes, padded and
 * radius'd from `theme.box`. Children are measured with `measureNodes`
 * directly (not `measureBlocks`) — `blocks.mjs` already forbids nesting
 * another `inset`, so this one call is the whole recursion, matching the
 * spec's "one level deep, no recursion".
 *
 * v1 SCOPE: a nested `answer_space`/`spacer` does not participate in a page's
 * elastic growth — its ruled lines print at their `minPt` height. Insets are
 * tips/definitions/"remember" boxes in the spec's own framing, where a fixed
 * write-space is the common case; growing space inside a box that itself
 * doesn't grow is deferred rather than forced into today's per-fragment model.
 */
function measureBoxNode(ctx, block, { widthPt, path }) {
  const { theme } = ctx;
  const { box } = theme;
  const innerWidthPt = widthPt - 2 * box.paddingPt;
  const childNodes = block.blocks.flatMap((child, index) =>
    measureNodes(ctx, child, { widthPt: innerWidthPt, path: `${path}.blocks[${index}]` }));

  let nodes = childNodes;
  if (block.title) {
    const titleNode = {
      kind: 'text',
      ...measureTextLines(ctx.doc, theme, [{ text: block.title, font: 'bold' }], {
        widthPt: innerWidthPt, styleKey: 'label',
      }),
      widthPt: innerWidthPt,
    };
    nodes = [titleNode, ...childNodes];
  }
  const innerHeightPt = stackNodes(nodes, box.innerGapPt);

  return {
    kind: 'box',
    childNodes: nodes,
    paddingPt: box.paddingPt,
    radiusPt: box.radiusPt,
    borderWidthPt: box.borderWidthPt,
    widthPt,
    heightPt: innerHeightPt + 2 * box.paddingPt,
  };
}

/** A semantic lesson card: icon rail + breadcrumb + assignment + mastery band. */
function measureLessonCardNode(ctx, block, { widthPt, path }) {
  const { theme } = ctx;
  // A card's icon is structural, not a small decorative glyph. It expands to
  // the card's usable height, but may never consume more than one fifth of
  // the card width. Measure a few times because a narrower text rail may make
  // a line wrap and thereby increase the card (and icon) height.
  const pad = theme.box.paddingPt + 4;
  const iconGapPt = 12;
  const resolved = ctx.resolveAsset?.(`subject-icon:${block.subjectIcon}`);
  if (!resolved?.svg) throw new UnresolvedAssetError(`subject-icon:${block.subjectIcon}`, path);
  const gap = 3;
  const bandGap = 7;
  const questionCount = Number(block.questionCount ?? 0);
  const neededToPass = Number.isFinite(block.passPercent) && questionCount > 0
    ? Math.ceil(questionCount * block.passPercent / 100)
    : null;
  // A percentage is a teacher configuration value, not an instruction a child
  // can act on. State the concrete target printed paper actually asks for.
  const successText = neededToPass === null
    ? `${questionCount} questions`
    : `${questionCount} questions     Get ${neededToPass} right to pass`;
  const progress = (Array.isArray(block.progress) ? block.progress : [])
    .filter((row) => Number.isInteger(row?.total) && row.total > 0 && Number.isInteger(row?.completed))
    .map((row) => ({
      label: String(row.label ?? 'Progress'),
      total: row.total,
      completed: Math.max(0, Math.min(row.completed, row.total)),
      inProgress: Math.max(0, Math.min(Number.isInteger(row.inProgress) ? row.inProgress : 0, row.total)),
    }));
  const railPt = Math.min(92, widthPt * 0.18);
  const iconSizePt = Math.min(46, railPt - 12);
  const subjectLabelHeightPt = 10;
  const progressRowHeightPt = 14;
  const progressGapPt = theme.lessonCard.progressGapPt;
  const sideRailHeightPt = subjectLabelHeightPt + iconSizePt
    + (progress.length ? progressGapPt + progress.length * progressRowHeightPt : 0);
  let breadcrumb;
  let title;
  let reading;
  let citation;
  let companionCode;
  let success;
  const textWidthPt = widthPt - pad * 2 - railPt - iconGapPt;
  const make = (text, styleKey) => measureTextLines(ctx.doc, theme, [{ text, font: theme.styles[styleKey].font }], {
    widthPt: textWidthPt, styleKey,
  });
  breadcrumb = make(String(block.breadcrumb ?? '').toUpperCase(), 'caption');
  title = make(String(block.lessonTitle ?? ''), 'heading');
  reading = block.reading ? make(String(block.reading), 'body') : null;
  citation = block.citation ? make(String(block.citation), 'caption') : null;
  companionCode = block.companionCode ? make(`COMPANION • PANEL CODE ${block.companionCode}`, 'label') : null;
  success = make(successText, 'label');
  const finalContent = [breadcrumb, title, reading, citation, companionCode].filter(Boolean);
  const finalTopHeight = finalContent.reduce((sum, entry) => sum + entry.heightPt, 0)
    + Math.max(0, finalContent.length - 1) * gap;
  const innerHeight = Math.max(sideRailHeightPt, finalTopHeight + bandGap + success.heightPt);
  return {
    kind: 'lessonCard', widthPt, heightPt: innerHeight + pad * 2, paddingPt: pad,
    radiusPt: theme.box.radiusPt, borderWidthPt: theme.box.borderWidthPt,
    icon: { svg: resolved.svg, widthPt: iconSizePt, heightPt: iconSizePt }, railPt,
    subjectName: String(block.subjectName ?? block.subjectIcon ?? 'School').toUpperCase(), subjectLabelHeightPt,
    breadcrumb, title, reading, citation, companionCode, success, progress, progressRowHeightPt,
    progressGapPt, gap, bandGap,
  };
}

/** One block → the nodes it contributes to its enclosing fragment. */
function measureNodes(ctx, block, { widthPt, path, bodyStyleKey = 'body' }) {
  const { theme } = ctx;
  switch (block.type) {
    case 'rich_text':
      return splitParagraphs(block.md).map((paragraph) => {
        const styleKey = paragraph.style === 'body' ? bodyStyleKey : paragraph.style;
        const style = theme.styles[styleKey];
        const runs = segmentParagraph(paragraph.text, { italic: ctx.italic }).flatMap((segment) => {
          if (segment.kind === 'text') return segment.runs;
          const svg = ctx.texToSvg(segment.tex, { display: false, fontSizePt: style.sizePt, ink: theme.ink.text });
          return [{ kind: 'math', svgString: svg.svgString, widthPt: svg.widthPt, heightPt: svg.heightPt }];
        });
        return {
          kind: 'text',
          ...measureTextLines(ctx.doc, theme, runs, { widthPt, styleKey }),
          widthPt,
        };
      });

    case 'math':
      return [measureMathNode(ctx, block.tex, { display: block.display !== false, widthPt, path })];

    case 'asset':
      return [measureAssetNode(ctx, block, { widthPt, path })];

    case 'answer_space':
      return [{
        kind: 'answerSpace',
        minPt: block.minPt,
        maxPt: block.maxPt,
        widthPt,
        heightPt: block.minPt,
      }];

    case 'omr_response':
      return [measureOmrNode(ctx, block, { widthPt, path })];

    case 'media_action':
    case 'scan_action':
      return [{
        kind: 'action',
        actionType: block.type,
        action: block.action,
        label: block.label,
        codeText: actionCodeText(block, ctx.tokens),
        widthPt,
        heightPt: theme.action.heightPt,
      }];

    case 'passage':
      return measurePassageNodes(ctx, block, { widthPt, path });

    case 'figure':
      return buildFigureNodes(ctx, block, { widthPt, path });

    case 'inset':
      if (block.layout === 'lesson_card') return [measureLessonCardNode(ctx, block, { widthPt, path })];
      return [measureBoxNode(ctx, block, { widthPt, path })];

    case 'list':
      return [measureListNode(ctx, block, { widthPt })];

    case 'divider':
      return [{
        kind: 'divider',
        widthPt,
        heightPt: theme.divider.paddingAbovePt + theme.divider.ruleWidthPt + theme.divider.paddingBelowPt,
      }];

    case 'spacer':
      // Same {minPt,maxPt} shape as `answer_space` (reused by `answerSpaceFor`
      // below) so the SAME per-page growth mechanics apply; the draw pass
      // simply never puts ink on an `elasticSpace` node.
      return [{
        kind: 'elasticSpace', minPt: block.minPt, maxPt: block.maxPt, widthPt, heightPt: block.minPt,
      }];

    case 'page_break':
      // Zero-height marker; `fragmentFromNode` turns this into a
      // `forceBreak: true` fragment that placement passes through harmlessly
      // today (Task 7 makes layout.mjs actually act on it).
      return [{ kind: 'pageBreak', widthPt, heightPt: 0 }];

    case 'wordbank':
      return [measureWordbankNode(ctx, block, { widthPt })];

    case 'matching':
      return [measureMatchingNode(ctx, block, { widthPt })];

    // Teacher-key render mode ONLY (spec §4.1, §12.1, Task 6): built directly
    // by `RenderPrintDocument` from the derived bank and fed straight to
    // `measureDocumentFragments`/`render()`, bypassing `blocks.mjs`'s
    // BLOCK_TYPES registry and `validateAnyDocument` entirely — it is never
    // authored in source YAML, so it needs no validator. See
    // `measureAnswerKeyNode` below.
    case 'answer_key':
      return [measureAnswerKeyNode(ctx, block, { widthPt })];

    case 'cloze': {
      const blanksByN = new Map(block.blanks.map((blank) => [blank.n, blank]));
      const items = clozeInlineItems(block.text, blanksByN, theme, { italic: ctx.italic });
      return [{
        kind: 'text',
        ...measureTextLines(ctx.doc, theme, items, { widthPt, styleKey: bodyStyleKey }),
        widthPt,
      }];
    }

    // short_answer/essay (spec §4.2, §6.2): sugar over a prompt text node +
    // an `answer_space` node, desugared HERE rather than upstream — this is
    // the exact node pair `measureBoxNode` already stacks and `measureNodes`
    // already knows how to place, so nesting one inside a box (or a question)
    // costs the rest of the pipeline nothing new (see blocks.mjs's
    // INSET_UNSUPPORTED_CHILD_TYPES comment, which reasons about this
    // in-advance). At the top level, the two returned nodes become two
    // INDEPENDENT fragments (unlike `question`, which stacks everything into
    // one atomic fragment) — that used to mean the prompt could strand on one
    // page while its own write space landed on the next (F4, review finding,
    // fixed since). `measureBlocks` (this module) now tags the prompt
    // fragment with `stickToNextId` right after building both, and
    // `layout.mjs`'s `placeFragments` refuses to place it without its space
    // fitting right after — so the two independent fragments still can never
    // separate across a page break, without paying for a full atomic merge
    // (which would also stop the prompt from wrapping/splitting on its own
    // when it's long).
    case 'short_answer': {
      const promptNode = {
        kind: 'text',
        ...measureTextLines(ctx.doc, theme, inlineRuns(block.prompt, { italic: ctx.italic }), {
          widthPt, styleKey: bodyStyleKey,
        }),
        widthPt,
      };
      const linesCount = block.lines ?? theme.shortAnswer.defaultLines;
      const minPt = theme.answerSpace.padAbovePt + linesCount * theme.answerSpace.rulePitchPt;
      const spaceNode = {
        kind: 'answerSpace', minPt, maxPt: minPt, widthPt, heightPt: minPt,
      };
      return [promptNode, spaceNode];
    }

    case 'essay': {
      const promptNode = {
        kind: 'text',
        ...measureTextLines(ctx.doc, theme, inlineRuns(block.prompt, { italic: ctx.italic }), {
          widthPt, styleKey: bodyStyleKey,
        }),
        widthPt,
      };
      if (block.box) {
        const { box } = theme;
        const boxNode = {
          kind: 'box',
          childNodes: [],
          paddingPt: box.paddingPt,
          radiusPt: box.radiusPt,
          borderWidthPt: box.borderWidthPt,
          widthPt,
          heightPt: theme.essay.boxHeightPt,
        };
        return [promptNode, boxNode];
      }
      const linesCount = block.lines ?? theme.essay.defaultLines;
      const minPt = theme.answerSpace.padAbovePt + linesCount * theme.answerSpace.rulePitchPt;
      const spaceNode = {
        kind: 'answerSpace', minPt, maxPt: minPt, widthPt, heightPt: minPt,
      };
      return [promptNode, spaceNode];
    }

    default:
      // plot/geometry are valid blocks with no Letter renderer yet. Refusing is
      // the only outcome that cannot mis-print.
      throw new UnsupportedBlockError(block.type, path);
  }
}

/** Stack nodes vertically with a fixed inner gap; returns the total height. */
function stackNodes(nodes, gapPt) {
  let cursor = 0;
  nodes.forEach((node, index) => {
    if (index > 0) cursor += node.gapBeforePt ?? gapPt;
    node.offsetYPt = cursor;
    cursor += node.heightPt;
  });
  return cursor;
}

/**
 * Answer-space headroom for a fragment, in the shape `layout.mjs` grows.
 * minPt is the fragment's own height so normalization is a no-op; maxPt adds
 * every nested space's remaining room. `elasticSpace` (the `spacer` block) is
 * the same {minPt,maxPt} shape as `answerSpace` and grows by the identical
 * rule — it just never gets ruled lines drawn into the room it grows.
 */
function answerSpaceFor(nodes, baseHeightPt) {
  const spaces = nodes.filter((node) => node.kind === 'answerSpace' || node.kind === 'elasticSpace');
  if (!spaces.length) return null;
  const headroomPt = spaces.reduce((total, node) => total + (node.maxPt - node.minPt), 0);
  return { minPt: baseHeightPt, maxPt: baseHeightPt + headroomPt };
}

function questionFragment(ctx, block, path) {
  const widthPt = ctx.widthPt - ctx.theme.question.numberGutterPt;
  const nodes = block.blocks.flatMap((child, index) =>
    measureNodes(ctx, child, { widthPt, path: `${path}.blocks[${index}]`, bodyStyleKey: 'question' }));
  const heightPt = stackNodes(nodes, ctx.theme.question.innerGapPt);
  return {
    id: path,
    blocks: [block],
    atomic: true,
    spacingClass: ctx.theme.question.spacingClass,
    number: block.number,
    itemId: block.itemId,
    gutterPt: ctx.theme.question.numberGutterPt,
    widthPt: ctx.widthPt,
    nodes,
    heightPt,
    baseHeightPt: heightPt,
    answerSpace: answerSpaceFor(nodes, heightPt),
    fillAfter: block.fillAfter === true,
  };
}

/**
 * `figure` → ONE atomic fragment (image + caption + optional credit stacked
 * with `theme.asset.captionGapPt`) — the image can never separate from its
 * caption across a page break, same guarantee a `question` gives its stem
 * and choices.
 */
function figureFragment(ctx, block, path) {
  const { theme } = ctx;
  const widthPt = ctx.widthPt;
  const nodes = buildFigureNodes(ctx, block, { widthPt, path });
  const innerGapPt = theme.asset.captionGapPt;
  const heightPt = stackNodes(nodes, innerGapPt);
  return {
    id: path,
    blocks: [block],
    atomic: true,
    spacingClass: theme.asset.spacingClass,
    widthPt,
    nodes,
    heightPt,
    baseHeightPt: heightPt,
    // The renderer's `applyAnswerSpaceGrowth` re-derives node offsets after any
    // grown answer/elastic space and MUST reuse this SAME gap — a fragment
    // measured with one gap and drawn with another is exactly the
    // measure/draw disagreement this module's own doctrine forbids.
    innerGapPt,
    answerSpace: answerSpaceFor(nodes, heightPt),
  };
}

/** A wrapped-text node becomes a FLOWABLE fragment; everything else is atomic. */
function fragmentFromNode(node, { id, block, theme }) {
  if (node.kind === 'text') {
    return {
      id,
      blocks: [block],
      atomic: false,
      spacingClass: node.style.spacingClass,
      styleKey: node.styleKey,
      widthPt: node.widthPt,
      lines: node.lines,
      heightPt: node.heightPt,
      minLinesBeforeBreak: node.minLinesBeforeBreak ?? theme.widowOrphan.minLinesBeforeBreak,
      minLinesAfterBreak: node.minLinesAfterBreak ?? theme.widowOrphan.minLinesAfterBreak,
      // Passage-only: reserved margin gutter + baked-in per-line numbers.
      // Omitted (not just falsy) for every other text node, so nothing about
      // existing fragments changes shape.
      ...(node.gutterPt ? { gutterPt: node.gutterPt } : {}),
      ...(node.lineNumbers ? { lineNumbers: node.lineNumbers } : {}),
    };
  }
  if (node.kind === 'pageBreak') {
    return {
      id,
      blocks: [block],
      atomic: true,
      spacingClass: null,
      widthPt: node.widthPt,
      nodes: [],
      heightPt: 0,
      baseHeightPt: 0,
      forceBreak: true,
      answerSpace: null,
    };
  }
  // Optional chaining throughout: `documentPdfTheme` and `workbookTheme` both
  // carry every group referenced below (F1: workbookTheme gained `math`/
  // `action`/`omr` alongside its existing `asset`/`answerSpace`/`box`/`list`/
  // `divider`/`spacer`), but this object is built once per node regardless of
  // `node.kind`, and nothing here guarantees a THIRD, future theme carries
  // every group on day one — so every entry still has to survive its own
  // theme lacking that one group rather than throwing on a bare `.` read.
  const spacingClassByKind = {
    math: theme.math?.spacingClass,
    asset: theme.asset?.spacingClass,
    answerSpace: theme.answerSpace?.spacingClass,
    omr: theme.omr?.spacingClass,
    action: theme.action?.spacingClass,
    box: theme.box?.spacingClass,
    list: theme.list?.spacingClass,
    divider: theme.divider?.spacingClass,
    elasticSpace: theme.spacer?.spacingClass,
    // Task 4 (assessment rendering): wordbank/matching are each their own
    // atomic single-node fragment, same path every other non-text kind above
    // already takes.
    wordbank: theme.wordbank?.spacingClass,
    matching: theme.matching?.spacingClass,
    // Teacher-key render mode (Task 6): same "atomic single-node fragment"
    // path as wordbank/matching above.
    answerKey: theme.answerKey?.spacingClass,
    // Without this the card had NO spacing class, so `gapBetween` fell through
    // to its `?? 0` default and the first question sat flush against the card's
    // border — the gap was never a tuned value, just an omission.
    lessonCard: theme.lessonCard?.spacingClass,
  };
  node.offsetYPt = 0;
  return {
    id,
    blocks: [block],
    atomic: true,
    spacingClass: spacingClassByKind[node.kind],
    widthPt: node.widthPt,
    nodes: [node],
    heightPt: node.heightPt,
    baseHeightPt: node.heightPt,
    // `answerSpaceFor` only inspects `node` itself, never `node.childNodes` —
    // for a `box` node (inset) that means a NESTED `answer_space`/`spacer` is
    // invisible here and never grows under fit policy `fill` (layout.mjs
    // `growLastPage`); it prints at its own minPt regardless of the flag.
    // Matches the v1 SCOPE note on `measureBoxNode` above — a fixed
    // write-space inside insets is a deliberate deferral, not an oversight.
    answerSpace: answerSpaceFor([node], node.heightPt),
  };
}

/**
 * Measure a block list into layout fragments.
 *
 * @param {Array<Object>} blocks - validated document blocks
 * @param {Object} deps
 * @param {Object} deps.doc - measurement PDFDocument (see createMeasurementDocument)
 * @param {Object} deps.theme - documentPdfTheme or a compatible theme
 * @param {Function} deps.texToSvg - (tex, opts) => { svgString, widthPt, heightPt }
 * @param {Function} [deps.resolveAsset] - (ref) => { svg, widthPt, heightPt } | null
 * @param {Function} [deps.resolveChoices] - (itemId, { choices, path }) => (
 *   string[] | {labels: string[], multiSelect?: boolean, maxSelect?: number}
 *   ). Two legal return shapes (see `normalizeChoiceResolution`/
 *   `measureOmrNode` above): a bare `string[]` of choice labels — the
 *   original contract, still what every non-multi_select caller returns
 *   (circles, no instruction line); or `{labels, multiSelect: true,
 *   maxSelect?}` for a `multi_select` bank item — square checkboxes plus a
 *   "Mark all that apply." / "Choose up to N." instruction caption. Omitted
 *   entirely means probe mode (bubble rows reserve space but carry no
 *   labels, and are never treated as multi_select).
 * @param {Object<string,string>} [deps.tokens] - action value → already-minted token
 * @param {string} [deps.path='blocks'] - dotted path prefix for fragment ids
 * @param {boolean} [deps.italic=false] - recognise `*italic*` in `rich_text`/
 *   `passage` inline grammar (v2). OFF by default: every v1 caller measures
 *   exactly as before.
 * @param {number} [deps.widthPt] - override the content wrap width (v2's
 *   furniture-aware `contentBox(theme, furnitureOpts).widthPt`, narrowed by
 *   any gutter reservation). Omitted (every v1/legacy caller) reproduces the
 *   original `theme.page.widthPt - 2 * theme.page.marginPt` computation
 *   byte-for-byte — see F2 in the print-design-system requirements.
 * @returns {Array<Object>} fragments for placeFragments()
 * @throws {UnsupportedBlockError|BlockMeasureError|MissingChoicesError|UnresolvedAssetError}
 *   with the offending block's path
 */
export function measureBlocks(blocks, {
  doc, theme = documentPdfTheme, texToSvg, resolveAsset = null, resolveChoices = null,
  tokens = null, path = 'blocks', italic = false, widthPt: widthPtOverride,
} = {}) {
  const widthPt = widthPtOverride ?? (theme.page.widthPt - 2 * theme.page.marginPt);
  const ctx = {
    doc, theme, texToSvg, resolveAsset, resolveChoices, tokens, widthPt, italic,
  };

  return blocks.flatMap((block, index) => {
    const at = `${path}[${index}]`;
    if (block.type === 'question') return [questionFragment(ctx, block, at)];
    // A figure's image can never separate from its caption, so it gets ONE
    // atomic fragment directly — same reason `question` is special-cased.
    if (block.type === 'figure') return [figureFragment(ctx, block, at)];
    const nodes = measureNodes(ctx, block, { widthPt, path: at });
    // A rich_text/passage block yields one fragment per paragraph (and per
    // promoted inline-math span or citation line), so a heading and its body
    // — or a passage body and its citation — can break apart and carry their
    // own spacing class.
    const fragments = nodes.map((node, nodeIndex) => fragmentFromNode(node, {
      id: nodes.length > 1 || block.type === 'rich_text' || block.type === 'passage' ? `${at}#p${nodeIndex}` : at,
      block,
      theme,
    }));
    // short_answer/essay (spec §4.2, §6.2 sugar; F4 review finding): unlike
    // `question`, this sugar's prompt + answer_space/box are two INDEPENDENT
    // top-level fragments — "same 'author a prompt then a bare answer_space'
    // behavior any v1 document already gets" (measureNodes' own short_answer
    // case comment). Independent fragments can strand: a short prompt fits at
    // the bottom of a page on its own while its (taller) write-space doesn't,
    // leaving the prompt with no space to answer into and the space with no
    // prompt to answer. `stickToNextId` (layout.mjs) is the keep-with-next
    // affinity that prevents it — a lightweight cross-fragment glue, unlike
    // `question`/`figure`'s single-atomic-fragment merge, because the prompt
    // must still be free to wrap/split on its OWN across pages when it is
    // long (the atomic-merge approach a `question` uses would instead force
    // an oversized prompt+space combo to fail fit outright).
    if ((block.type === 'short_answer' || block.type === 'essay') && fragments.length === 2) {
      fragments[0] = { ...fragments[0], stickToNextId: fragments[1].id };
    }
    // A section-level study card can declare the same lightweight
    // keep-with-next relationship as the short-answer prompt.  It remains a
    // normal full-width block (rather than becoming question content), but
    // placement moves it to the next page whenever its following question
    // would not fit underneath it.
    if (block.keepWithNext === true && fragments.length === 1 && index < blocks.length - 1) {
      fragments[0] = { ...fragments[0], stickToNextId: `${path}[${index + 1}]` };
    }
    return fragments;
  });
}

/**
 * The title/name/date(/instructions) banner, measured as an atomic fragment
 * on page one.
 *
 * `headerConfig` is v2's validated `document.header` ({name, date, scoreBox,
 * instructions?} — documentV2.mjs's archetype presets, all overridable).
 * v1 (schema-less) documents never carry `.header`, so `headerConfig`
 * defaults to `{}`, which resolves to `showName`/`showDate` both true and no
 * instructions — the EXACT unconditional behavior this banner always had,
 * byte-identical for every v1 caller.
 *
 * `totalPoints` (Phase B, spec §13 — "points/score box") is the score box's
 * only new input: when `headerConfig.scoreBox` is true AND a caller supplies
 * `totalPoints`, the banner gains a `Score ____ / <totalPoints>` line.
 * Computing the points TOTAL (summing the quiz's scored items) is the
 * caller's job (Task 5); this function only draws what it is handed —
 * `scoreBox: true` with no `totalPoints` prints no score line at all, same as
 * every caller before this field existed.
 */
function headerFragment(document, {
  theme, studentName, date, headerConfig = {}, widthPt: widthPtOverride, totalPoints,
  embeddedCard = null,
}) {
  const { header } = theme;
  const showName = headerConfig.name !== false;
  const showDate = headerConfig.date !== false;
  const showTitle = headerConfig.title !== false;
  const showMetaLine = showName || showDate;
  const instructions = headerConfig.instructions || null;
  const subtitle = headerConfig.subtitle || null;
  const reading = headerConfig.reading || null;
  // Header manifest ("10 questions · pass 80%", spec appendix: a child sees
  // how much sheet there is and what clears it without flipping a page to
  // find out). NEVER authored in source YAML — `RenderPrintDocument` computes
  // it (question count is a pure count of the document's own top-level
  // `question` blocks; the pass mark comes from the caller's
  // `context.passPercent`, since a document has no notion of "passing" on
  // its own) and writes it onto `document.header.manifest` right before
  // measurement, the same "adjust the document just before render" seam
  // `dropRedundantTitleHeading` already uses — so this is read here exactly
  // like `subtitle`/`reading`, a precomputed string with no policy of its
  // own to apply.
  const manifest = headerConfig.manifest || null;
  const showScoreBox = Boolean(headerConfig.scoreBox) && totalPoints !== undefined && totalPoints !== null;
  const showRule = headerConfig.rule !== false;
  const metaFirst = headerConfig.metaFirst === true;
  const frame = headerConfig.frame ?? 'none';
  // Theme-driven (not a bare literal) so `workbookTheme`'s `compact` density
  // can shrink the double-frame's own padding along with every other
  // inter-block gap it tightens — this box's padding is whitespace around
  // the title/meta text, not the text itself, so it belongs in the same
  // "gaps first" bucket as `spacing`/`innerGapPt` rather than being pinned at
  // `documentPdfTheme`'s legacy constant forever. `?? 7` preserves that
  // legacy constant exactly for any theme that predates this field.
  const framePaddingPt = frame === 'double' ? (header.framePaddingPt ?? 7) : 0;
  const gapBelowPt = metaFirst && frame === 'double' ? 0 : header.gapBelowPt;
  const metaRowHeightPt = showMetaLine || embeddedCard
    ? Math.max(showMetaLine ? header.metaLeadingPt : 0, embeddedCard?.heightPt ?? 0)
    : 0;
  const heightPt = (showTitle ? header.titleLeadingPt : 0)
    + (instructions ? header.metaLeadingPt : 0)
    + (subtitle ? theme.styles.body.leadingPt : 0)
    + (reading ? theme.styles.body.leadingPt : 0)
    + (manifest ? (theme.styles.caption ?? theme.styles.body).leadingPt : 0)
    + framePaddingPt * 2
    + metaRowHeightPt
    + (metaRowHeightPt && metaFirst ? header.metaTitleGapPt : 0)
    + (showScoreBox ? header.metaLeadingPt : 0)
    + (showRule ? header.ruleGapPt + header.ruleWidthPt : 0) + gapBelowPt;
  // Same furniture-aware width override measureBlocks takes (F2) — the
  // title/name/date rule has to stop at the SAME gutter-narrowed right edge
  // the body text wraps to, or the banner would overrun a guttered page's
  // narrower content box.
  const contentWidthPt = widthPtOverride ?? (theme.page.widthPt - 2 * theme.page.marginPt);
  const node = {
    kind: 'header',
    title: document.title || document.id,
    showTitle,
    studentName: studentName || null,
    // Prefilled learner date (RenderPrintDocument's `context.date`, spec §7);
    // omitted/null prints the blank ruled line, exactly as before this field
    // existed — see drawHeader.
    date: date || null,
    showName,
    showDate,
    instructions,
    subtitle,
    reading,
    manifest,
    showScoreBox,
    showRule,
    metaFirst,
    frame,
    framePaddingPt,
    embeddedCard,
    metaRowHeightPt,
    totalPoints: showScoreBox ? totalPoints : null,
    widthPt: contentWidthPt,
    heightPt,
    offsetYPt: 0,
  };
  return {
    id: 'header',
    blocks: [],
    atomic: true,
    spacingClass: header.spacingClass,
    widthPt: node.widthPt,
    nodes: [node],
    heightPt,
    baseHeightPt: heightPt,
  };
}

/**
 * Card header strip (Print Design Phase C, Task 4, spec §5.2): the card ID a
 * student bubbles into OMR columns 1-7, printed directly below the document
 * banner as large letter-spaced digits — "Card 4 8 2 9 3 0 6 — questions
 * 18-30" — plus a caption-style instruction line underneath. Every card
 * sheet gets a reminder line (spec §5.2: "subsequent sheets ... print the
 * same digits with 'use your card 4829306'"); the FIRST sheet issued
 * against a fresh card gets a different instruction telling the student
 * where to bubble it in. The two are mutually exclusive text for the SAME
 * line, never both — `firstUse` just selects which. The reminder's digits
 * are the plain `cardId` string, un-spaced (it is a reference line, not a
 * bubbling guide) — the large tracked digit row above it is the only place
 * letter-spacing applies.
 *
 * `card` is render context (`{cardId, startRow, endRow, firstUse}`, spec
 * §5.3/§5.4's allocation record) threaded by the caller exactly like
 * `totalPoints` on `headerFragment` above — this function only draws the
 * numbers it is handed. It allocates nothing, validates no range/collision
 * rule, and re-derives no numbering: Task 5's allocation domain
 * (`allocation.mjs`) owns all of that; this is draw-time only.
 *
 * Digit x-offsets are computed HERE, once, from real glyph widths plus
 * `theme.card.trackingPt` — the same "measurement is the drawing plan"
 * discipline `wrapRuns` uses for word offsets — so the draw pass never
 * re-measures a digit and the two can never disagree about where digit 4
 * sits.
 *
 * A theme with no `card` token group (the legacy `documentPdfTheme` — this
 * feature is workbook-only, same posture as `theme.badge`'s multi_select
 * checkbox) refuses loudly here rather than crashing on an undefined read
 * deep inside digit measurement.
 */
function cardHeaderFragment(doc, theme, card, { widthPt: widthPtOverride } = {}) {
  const { card: cardTheme } = theme;
  if (!cardTheme) {
    throw new Error('card rendering requires a theme with card tokens (workbook theme)');
  }
  const widthPt = widthPtOverride ?? (theme.page.widthPt - 2 * theme.page.marginPt);
  const cardId = String(card.cardId);

  let cursor = 0;
  const digits = [...cardId].map((ch) => {
    const digitWidthPt = stringWidth(doc, theme, 'bold', cardTheme.digitSizePt, ch);
    const digit = { ch, xPt: cursor, widthPt: digitWidthPt };
    cursor += digitWidthPt + cardTheme.trackingPt;
    return digit;
  });
  const digitsWidthPt = digits.length ? cursor - cardTheme.trackingPt : 0;

  const labelText = 'Student No.';
  const labelWidthPt = stringWidth(doc, theme, 'bold', cardTheme.labelSizePt, labelText);
  const metaText = '';

  const firstUse = card.firstUse === true;
  const reuseSheet = card.startRow > 1;
  const reuseText = reuseSheet ? `REUSE THE SAME ANSWER SHEET · ROWS ${card.startRow}–${card.endRow}` : null;
  const reuseTextWidthPt = reuseText
    ? stringWidth(doc, theme, 'bold', cardTheme.reuseLabelSizePt, reuseText)
    : 0;
  const instruction = null;

  const heightPt = cardTheme.bandHeightPt + (reuseSheet ? cardTheme.reuseLabelLeadingPt : 0);

  const node = {
    kind: 'cardHeader',
    cardId,
    digits,
    digitsWidthPt,
    labelText,
    labelWidthPt,
    metaText,
    firstUse,
    reuseSheet,
    reuseText,
    reuseTextWidthPt,
    instruction,
    widthPt,
    heightPt,
    offsetYPt: 0,
  };
  return {
    id: 'cardHeader',
    blocks: [],
    atomic: true,
    spacingClass: cardTheme.spacingClass,
    widthPt,
    nodes: [node],
    heightPt,
    baseHeightPt: heightPt,
  };
}

/**
 * Fragments for a whole document: header banner, then every block.
 *
 * @param {Object} document - validated document ({ id, seed, variant, blocks }, title optional)
 * @param {Object} deps - as measureBlocks (including the `widthPt` override, F2), plus `studentName`, `date`
 * @param {Object|null} [deps.card] - card render context (spec §5.2/§5.3:
 *   `{cardId, startRow, endRow, firstUse?}`). Drawn as its own fragment
 *   directly below the header banner ONLY when supplied — omitted/null
 *   (every caller before this option existed, and every render with no card
 *   attachment) produces byte-identical fragments to before this feature
 *   existed.
 * @returns {Array<Object>}
 */
export function measureDocumentFragments(document, {
  doc, theme = documentPdfTheme, texToSvg, resolveAsset = null, resolveChoices = null,
  tokens = null, studentName = null, date = null, italic = false, header, widthPt, totalPoints,
  card = null,
} = {}) {
  // `header` override lets a caller force the banner shape (tests, answer
  // keys); omitted (the normal path), it reads the v2 document's own
  // validated `.header` — absent on every v1 document, which is exactly
  // what keeps v1 rendering the unconditional Name/Date banner it always has
  // (see headerFragment's own doc comment).
  const headerConfig = header ?? document.header ?? {};
  const cardFragment = card?.cardId !== undefined && card?.cardId !== null
    ? cardHeaderFragment(doc, theme, card, { widthPt })
    : null;
  const fragments = [headerFragment(document, {
    theme, studentName, date, headerConfig, widthPt, totalPoints,
    embeddedCard: cardFragment?.nodes?.[0] ?? null,
  })];
  fragments.push(...measureBlocks(document.blocks, {
    doc, theme, texToSvg, resolveAsset, resolveChoices, tokens, italic, widthPt,
  }));
  return fragments;
}

/**
 * Publish-time gate: measure and place a document, produce NO bytes, and report
 * what would print wrong. Consumed by ValidateCatalog's `--render-probe`.
 *
 * Measurement stops at the first block it cannot measure (a renderer has no way
 * to continue past bad TeX), so a document with two broken blocks reports the
 * first; layout errors are reported in full.
 *
 * SCOPE: without a `resolveChoices` the probe checks PAGE GEOMETRY, reserving a
 * conservative two lines under each bubble instead of the bank's real choice
 * text. It is not a claim that the sheet is printable — the print path refuses
 * an unlabelled bubble row outright, which is the guarantee that matters.
 *
 * @param {Object} document - a validated document
 * @param {Object} [deps] - injectable for tests; defaults to the real MathJax renderer
 * @returns {Promise<{ errors: string[] }>}
 */
export async function probeDocument(document, {
  theme = documentPdfTheme, texToSvg = mathJaxTexToSvg, resolveAsset = null,
  resolveChoices = null, fontDir = DEFAULT_FONT_DIR,
} = {}) {
  let fragments;
  try {
    const doc = createMeasurementDocument({ theme, fontDir });
    fragments = measureDocumentFragments(document, { doc, theme, texToSvg, resolveAsset, resolveChoices });
  } catch (err) {
    return { errors: [err?.message ?? String(err)] };
  }

  const { errors } = placeFragments(fragments, {
    pageHeightPt: theme.page.heightPt,
    marginPt: theme.page.marginPt,
    spacing: theme.spacing,
  });
  return { errors: errors.map((error) => error.message) };
}

export default {
  measureBlocks, measureDocumentFragments, createMeasurementDocument, probeDocument, parseRichText,
};
