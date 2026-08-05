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

/** short_answer/essay desugar (measureNodes below) when the block omits `lines`. */
const DEFAULT_SHORT_ANSWER_LINES = 3;
const DEFAULT_ESSAY_LINES = 10;

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

/** Paragraph descriptors from a constrained-Markdown source. */
function splitParagraphs(md) {
  const paragraphs = [];
  for (const chunk of String(md).split(/\n\s*\n/)) {
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
    const pieces = word.pieces.map((piece) => (piece.kind === 'blank'
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
  const cellWidthPt = availablePt / block.choices;
  const resolved = ctx.resolveChoices
    ? ctx.resolveChoices(block.itemId, { choices: block.choices, path })
    : null;
  const { labels, multiSelect, maxSelect } = normalizeChoiceResolution(resolved);

  const cells = [];
  for (let index = 0; index < block.choices; index += 1) {
    const label = labels ? String(labels[index]) : null;
    cells.push({
      choice: theme.omr.letters[index],
      label,
      lines: label
        ? wrapRuns(doc, theme, [{ text: label, font: 'regular' }], {
          widthPt: cellWidthPt, sizePt: theme.omr.choiceSizePt, leadingPt: theme.omr.choiceLeadingPt,
        })
        : [],
    });
  }

  const textLines = labels
    ? Math.max(...cells.map((cell) => cell.lines.length))
    : theme.omr.probeChoiceLines;

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
    instruction,
    widthPt,
    heightPt: (instruction ? instruction.heightPt + theme.omr.instructionGapPt : 0)
      + theme.omr.rowHeightPt + theme.omr.choiceGapPt + textLines * theme.omr.choiceLeadingPt,
  };
}

/**
 * Token VALUES arrive from the caller (IDocumentRenderer's `opts.tokens`, keyed
 * by action) or from the document data. The renderer only draws them; nothing
 * here mints, signs, or derives a code.
 */
function actionCodeText(block, tokens) {
  return tokens?.[block.action] ?? block.code ?? block.token ?? block.action;
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

/** One block → the nodes it contributes to its enclosing fragment. */
function measureNodes(ctx, block, { widthPt, path, bodyStyleKey = 'body' }) {
  const { theme } = ctx;
  switch (block.type) {
    case 'rich_text':
      return splitParagraphs(block.md).flatMap((paragraph) =>
        segmentParagraph(paragraph.text, { italic: ctx.italic }).map((segment) => (segment.kind === 'math'
          ? measureMathNode(ctx, segment.tex, { display: true, widthPt, path })
          : {
            kind: 'text',
            // Body prose inside a question is the `question` style; a heading
            // stays a heading wherever it sits.
            ...measureTextLines(ctx.doc, theme, segment.runs, {
              widthPt, styleKey: paragraph.style === 'body' ? bodyStyleKey : paragraph.style,
            }),
            widthPt,
          })));

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
    // independent fragments — same "author a prompt then a bare answer_space"
    // behavior any v1 document already gets; the keep-together guarantee is
    // scoped to `question`, not to this sugar.
    case 'short_answer': {
      const promptNode = {
        kind: 'text',
        ...measureTextLines(ctx.doc, theme, inlineRuns(block.prompt, { italic: ctx.italic }), {
          widthPt, styleKey: bodyStyleKey,
        }),
        widthPt,
      };
      const linesCount = block.lines ?? DEFAULT_SHORT_ANSWER_LINES;
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
      const linesCount = block.lines ?? DEFAULT_ESSAY_LINES;
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
    if (index > 0) cursor += gapPt;
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
 * @param {Function} [deps.resolveChoices] - (itemId, { choices, path }) => string[];
 *   omitted means probe mode (bubble rows reserve space but carry no labels)
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
    return nodes.map((node, nodeIndex) => fragmentFromNode(node, {
      id: nodes.length > 1 || block.type === 'rich_text' || block.type === 'passage' ? `${at}#p${nodeIndex}` : at,
      block,
      theme,
    }));
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
}) {
  const { header } = theme;
  const showName = headerConfig.name !== false;
  const showDate = headerConfig.date !== false;
  const showMetaLine = showName || showDate;
  const instructions = headerConfig.instructions || null;
  const showScoreBox = Boolean(headerConfig.scoreBox) && totalPoints !== undefined && totalPoints !== null;
  const heightPt = header.titleLeadingPt
    + (instructions ? header.metaLeadingPt : 0)
    + (showMetaLine ? header.metaLeadingPt : 0)
    + (showScoreBox ? header.metaLeadingPt : 0)
    + header.ruleGapPt + header.ruleWidthPt + header.gapBelowPt;
  // Same furniture-aware width override measureBlocks takes (F2) — the
  // title/name/date rule has to stop at the SAME gutter-narrowed right edge
  // the body text wraps to, or the banner would overrun a guttered page's
  // narrower content box.
  const contentWidthPt = widthPtOverride ?? (theme.page.widthPt - 2 * theme.page.marginPt);
  const node = {
    kind: 'header',
    title: document.title || document.id,
    studentName: studentName || null,
    // Prefilled learner date (RenderPrintDocument's `context.date`, spec §7);
    // omitted/null prints the blank ruled line, exactly as before this field
    // existed — see drawHeader.
    date: date || null,
    showName,
    showDate,
    instructions,
    showScoreBox,
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
 * Fragments for a whole document: header banner, then every block.
 *
 * @param {Object} document - validated document ({ id, seed, variant, blocks }, title optional)
 * @param {Object} deps - as measureBlocks (including the `widthPt` override, F2), plus `studentName`, `date`
 * @returns {Array<Object>}
 */
export function measureDocumentFragments(document, {
  doc, theme = documentPdfTheme, texToSvg, resolveAsset = null, resolveChoices = null,
  tokens = null, studentName = null, date = null, italic = false, header, widthPt, totalPoints,
} = {}) {
  // `header` override lets a caller force the banner shape (tests, answer
  // keys); omitted (the normal path), it reads the v2 document's own
  // validated `.header` — absent on every v1 document, which is exactly
  // what keeps v1 rendering the unconditional Name/Date banner it always has
  // (see headerFragment's own doc comment).
  const headerConfig = header ?? document.header ?? {};
  return [
    headerFragment(document, {
      theme, studentName, date, headerConfig, widthPt, totalPoints,
    }),
    ...measureBlocks(document.blocks, {
      doc, theme, texToSvg, resolveAsset, resolveChoices, tokens, italic, widthPt,
    }),
  ];
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
