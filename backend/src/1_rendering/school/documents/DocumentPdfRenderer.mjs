/**
 * Letter PDF renderer for school documents.
 *
 * The draw half of measure-then-place: `measure.mjs` computed every line, box
 * and bubble position, `layout.mjs` assigned pages, and this file replays those
 * numbers into pdfkit. It re-decides nothing — if a page break looks wrong, the
 * bug is upstream in a pure, unit-tested module.
 *
 * Three properties this file owns:
 *
 * - **The form map.** Every OMR bubble's exact centre and radius is recorded in
 *   the coordinate space it was drawn in, and that record is what the reader
 *   grades against (`VirtualOmrReader.formLayout`). A bubble whose recorded
 *   geometry drifts from its printed geometry mis-grades a real child's test,
 *   so the two come from one calculation, made once, at draw time.
 * - **Answer-key separation.** A key is a DIFFERENT artifact, rendered from a
 *   different block list. Learner copies are produced by a call that was never
 *   given any answers, so there is no branch in which one could leak.
 * - **Determinism.** Same document, same seed, same bytes: CreationDate is
 *   pinned, nothing consults the clock, and no randomness enters the draw pass.
 *
 * Math is vector throughout (MathJax SVG → svg-to-pdfkit); nothing is
 * rasterized on this target.
 *
 * @module rendering/school/documents/DocumentPdfRenderer
 */

import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import QRCode from 'qrcode';

import { placeFragments } from './layout.mjs';
import {
  measureDocumentFragments, createMeasurementDocument, registerDocumentFonts,
  MissingChoicesError, UnresolvedAssetError,
} from './measure.mjs';
import { documentPdfTheme } from './documentPdfTheme.mjs';
import { texToSvg as mathJaxTexToSvg } from './mathSvg.mjs';
import { drawFurniture, contentBox } from './furniture.mjs';

/** Contract version for the form map. Bump when mark geometry semantics change. */
const FORM_VERSION = 'school-document-1';

/** Fixed timestamp so two renders of one document are byte-identical. */
const PINNED_CREATION_DATE = new Date(0);

const EPSILON = 1e-9;
const BLANK_RULE = '_';

/**
 * Grow this fragment's answer-space nodes into the height layout gave it, evenly
 * and each capped at its own maxPt — the same rule `layout.mjs` applies between
 * fragments, applied here between the spaces inside one question.
 */
function applyAnswerSpaceGrowth(fragment, innerGapPt) {
  const nodes = fragment.nodes ?? [];
  let sparePt = (fragment.heightPt ?? 0) - (fragment.baseHeightPt ?? fragment.heightPt ?? 0);
  // `elasticSpace` (the `spacer` block) grows by the identical rule as
  // `answerSpace` — it just never gets ruled lines drawn into the room.
  let growable = nodes
    .filter((node) => node.kind === 'answerSpace' || node.kind === 'elasticSpace')
    .map((node) => ({ node, headroomPt: node.maxPt - node.heightPt }))
    .filter((entry) => entry.headroomPt > EPSILON);

  while (sparePt > EPSILON && growable.length > 0) {
    const share = sparePt / growable.length;
    let consumed = 0;
    const stillGrowable = [];
    for (const entry of growable) {
      const growth = Math.min(share, entry.headroomPt);
      entry.node.heightPt += growth;
      entry.headroomPt -= growth;
      consumed += growth;
      if (entry.headroomPt > EPSILON) stillGrowable.push(entry);
    }
    if (consumed <= EPSILON) break;
    sparePt -= consumed;
    growable = stillGrowable;
  }

  let cursor = 0;
  nodes.forEach((node, index) => {
    if (index > 0) cursor += innerGapPt;
    node.offsetYPt = cursor;
    cursor += node.heightPt;
  });
}

/** Questions in document order, for the answer key. */
function collectQuestions(blocks, into = []) {
  for (const block of blocks ?? []) {
    if (block?.type === 'question') {
      into.push(block);
      collectQuestions(block.blocks, into);
    }
  }
  return into;
}

/**
 * Choice text comes from the question bank — the same bank the grader scores
 * against — so the paper and the grader can never disagree about what B meant.
 *
 * Every failure here throws. A bubble sheet missing its choices scans perfectly
 * and means nothing; refusing to print it is the only outcome that cannot
 * mis-grade a child.
 */
function createChoiceResolver(bank) {
  const items = new Map((bank?.items ?? []).map((item) => [item.id, item]));
  return (itemId, { choices, path }) => {
    if (!bank) {
      throw new MissingChoicesError('an omr_response needs its question bank; none was supplied', path, itemId);
    }
    const item = items.get(itemId);
    if (!item) {
      throw new MissingChoicesError(`item '${itemId}' is not in bank '${bank.id ?? '(unnamed)'}'`, path, itemId);
    }
    // true_false (spec §5.2/§5.3): a fixed two-option shape with NO
    // `.choices` array on the bank item at all (questionBankValidation.mjs
    // never authors one — the two-option shape is hardcoded, not authored).
    // Labels are synthesized here rather than read from the bank, the same
    // "resolver returns the bank item's own richer shape" move multi_select
    // makes below — except this one returns the ORIGINAL bare-array shape,
    // so a true_false row gets ordinary circle bubbles + label text
    // (Ⓐ True / Ⓑ False), never the multiSelect/square-checkbox geometry.
    if (item.type === 'true_false') {
      if (choices !== 2) {
        throw new MissingChoicesError(
          `item '${itemId}' is true_false (2 options: True/False) but the sheet prints ${choices} bubbles`,
          path, itemId,
        );
      }
      return ['True', 'False'];
    }
    if (!Array.isArray(item.choices) || item.choices.length !== choices) {
      throw new MissingChoicesError(
        `item '${itemId}' has ${item.choices?.length ?? 0} bank choices but the sheet prints ${choices} bubbles`,
        path, itemId,
      );
    }
    const labels = item.choices.map((choice) => String(choice));
    // multi_select (spec §5.5): the richer `{labels, multiSelect, maxSelect}`
    // shape `measure.mjs`'s `measureOmrNode` knows how to read — square
    // checkboxes + an instruction caption instead of circles. Every OTHER
    // item type (including one with no `type` at all, e.g. this file's own
    // test fixtures) keeps returning the bare `labels` array, so ordinary
    // multiple_choice rendering is untouched.
    if (item.type === 'multi_select') {
      return { labels, multiSelect: true, maxSelect: item.maxSelect };
    }
    return labels;
  };
}

/**
 * Create a Letter PDF renderer.
 *
 * @param {Object} [deps]
 * @param {Object} [deps.theme=documentPdfTheme]
 * @param {Function} [deps.texToSvg] - TeX → SVG; defaults to the real MathJax renderer
 * @param {Function} [deps.resolveAsset] - (ref) => { svg, widthPt, heightPt }.
 *   Defaults to a resolver that THROWS: an asset that cannot be drawn must not
 *   become a blank rectangle on a child's worksheet.
 * @param {string} [deps.fontDir] - override the bundled font directory
 */
export function createDocumentPdfRenderer({
  theme = documentPdfTheme,
  texToSvg = mathJaxTexToSvg,
  resolveAsset = null,
  fontDir = undefined,
} = {}) {
  if (typeof texToSvg !== 'function') {
    throw new TypeError('createDocumentPdfRenderer needs a texToSvg function');
  }
  const assetResolver = resolveAsset ?? ((ref) => { throw new UnresolvedAssetError(ref, 'document'); });
  const contentLeftPt = theme.page.marginPt;
  const contentRightPt = theme.page.widthPt - theme.page.marginPt;

  // ── drawing primitives ────────────────────────────────────────────────
  const setFont = (out, fontKey, sizePt, inkKey = 'text') => out
    .font(theme.fonts[fontKey].name)
    .fontSize(sizePt)
    .fillColor(theme.ink[inkKey]);

  /**
   * A cloze inline blank atom (spec §6.3): a superscript number at the
   * blank's start, plus a baseline rule drawn at exactly `run.widthPt` — the
   * SAME width the answer-length-blind measurement pass reserved for it.
   * `run.xPt`/the caller's `xPt` already place this at the blank's measured
   * position inside the line; nothing here re-decides where it sits.
   */
  function drawClozeBlank(out, run, { xPt, yPt, style }) {
    const numberSizePt = Math.round(style.sizePt * 0.62 * 10) / 10;
    setFont(out, 'regular', numberSizePt, style.ink);
    out.text(String(run.n), xPt, yPt, { lineBreak: false });
    const baselineYPt = yPt + style.sizePt * 0.86;
    out.save().lineWidth(theme.answerSpace.ruleWidthPt).strokeColor(theme.ink.rule)
      .moveTo(xPt, baselineYPt).lineTo(xPt + run.widthPt, baselineYPt).stroke().restore();
  }

  function drawLines(out, lines, { xPt, yPt, styleKey }) {
    const style = theme.styles[styleKey];
    let cursorY = yPt;
    for (const line of lines) {
      for (const run of line.runs) {
        // A cloze blank atom (measure.mjs's `clozeInlineItems`) carries no
        // `.text`/`.font` — it is drawn as a superscript number + rule
        // instead of `out.text`. Every other caller's runs never carry
        // `kind: 'blank'`, so this branch is unreachable for them.
        if (run.kind === 'blank') { drawClozeBlank(out, run, { xPt: xPt + run.xPt, yPt: cursorY, style }); continue; }
        setFont(out, run.font, run.sizePt ?? style.sizePt, style.ink);
        out.text(run.text, xPt + run.xPt, cursorY, { lineBreak: false });
      }
      cursorY += line.heightPt;
    }
  }

  function drawMath(out, node, { xPt, yPt }) {
    SVGtoPDF(out, node.svgString, xPt + node.indentPt, yPt + node.padAbovePt, {
      width: node.drawWidthPt,
      height: node.drawHeightPt,
      assumePt: true,
    });
  }

  function drawAnswerSpace(out, node, { xPt, yPt }) {
    const { rulePitchPt, ruleWidthPt, ruleInsetPt, padAbovePt } = theme.answerSpace;
    out.save().lineWidth(ruleWidthPt).strokeColor(theme.ink.rule);
    for (let ruleY = yPt + padAbovePt + rulePitchPt; ruleY <= yPt + node.heightPt + EPSILON; ruleY += rulePitchPt) {
      out.moveTo(xPt + ruleInsetPt, ruleY).lineTo(xPt + node.widthPt, ruleY).stroke();
    }
    out.restore();
  }

  /**
   * A row of vector bubbles with the bank's choice text under each one. All
   * bubbles share one y — that is what makes the row a single reader column.
   *
   * The centre and radius written into the form map are the very numbers handed
   * to pdfkit, never a recomputation: a mark 2pt from where the ink actually is
   * grades the wrong bubble.
   */
  function drawOmrRow(out, node, { xPt, yPt, page, marks }) {
    const { bubbleRadiusPt, bubbleStrokeWidthPt, labelSizePt, labelGapPt, indentPt, rowHeightPt, choiceSizePt, choiceGapPt } = theme.omr;
    if (!node.labelled) {
      throw new MissingChoicesError(
        'bubble row has no choice text to print', `omr_response(${node.itemId})`, node.itemId,
      );
    }

    // multi_select's instruction caption prints ABOVE the row (spec §5.5);
    // absent for every ordinary multiple_choice/probe row, in which case
    // `rowYPt` is `yPt` unchanged and every calculation below is
    // byte-identical to before this feature existed.
    let rowYPt = yPt;
    if (node.instruction) {
      drawLines(out, node.instruction.lines, { xPt, yPt: rowYPt, styleKey: node.instruction.styleKey });
      rowYPt += node.instruction.heightPt + theme.omr.instructionGapPt;
    }

    const centreY = rowYPt + rowHeightPt / 2;
    const textY = rowYPt + rowHeightPt + choiceGapPt;

    node.cells.forEach((cell, index) => {
      const cellX = xPt + indentPt + index * node.cellWidthPt;
      const labelWidth = setFont(out, 'regular', labelSizePt).widthOfString(cell.choice);
      const centreX = cellX + labelWidth + labelGapPt + bubbleRadiusPt;

      out.text(cell.choice, cellX, centreY - labelSizePt / 2, { lineBreak: false });
      if (node.multiSelect) {
        // Square checkbox (theme.badge's square variant) instead of the
        // circle — same centre point a circle would occupy, so the letter
        // label/choice text below it never has to move.
        const { sizePt, strokeWidthPt } = theme.badge.square;
        out.save().lineWidth(strokeWidthPt).strokeColor(theme.ink.bubble)
          .rect(centreX - sizePt / 2, centreY - sizePt / 2, sizePt, sizePt).stroke().restore();
      } else {
        out.save().lineWidth(bubbleStrokeWidthPt).strokeColor(theme.ink.bubble)
          .circle(centreX, centreY, bubbleRadiusPt).stroke().restore();
      }

      let lineY = textY;
      for (const line of cell.lines) {
        for (const run of line.runs) {
          setFont(out, run.font, choiceSizePt);
          out.text(run.text, cellX + run.xPt, lineY, { lineBreak: false });
        }
        lineY += line.heightPt;
      }

      marks.push({
        itemId: node.itemId,
        choice: cell.choice,
        label: cell.label,
        xPt: centreX,
        yPt: centreY,
        rPt: bubbleRadiusPt,
        page,
      });
    });
  }

  /**
   * The scannable code itself, drawn as vector modules.
   *
   * This box used to be an empty outline with the token printed underneath as
   * small text — a reserved space nobody ever filled. The whole console runs on
   * scanning, so a worksheet whose code area is blank is a sheet a child cannot
   * act on without a grown-up keying sixteen characters in by hand.
   *
   * Rects rather than a rasterized image: a QR at 40pt would have to be ~600dpi
   * to survive printing, and vector modules are exact at any resolution and stay
   * byte-deterministic. `QRCode.create` is synchronous and pure, so the draw
   * pass keeps its "no clock, no randomness" property.
   */
  function drawQrCode(out, { text, xPt, yPt, sizePt, codes = null, page = null }) {
    const { modules } = QRCode.create(String(text), {
      errorCorrectionLevel: theme.action.qrErrorCorrection,
    });
    // A quiet zone is part of the symbol: without it a reader cannot find the
    // finder patterns against the dashed border sitting right beside them.
    const quiet = theme.action.qrQuietModules;
    const span = modules.size + 2 * quiet;
    const modulePt = sizePt / span;

    let drawn = 0;
    out.save().fillColor(theme.ink.text);
    for (let row = 0; row < modules.size; row += 1) {
      for (let col = 0; col < modules.size; col += 1) {
        if (!modules.data[row * modules.size + col]) continue;
        out.rect(
          xPt + (col + quiet) * modulePt,
          yPt + (row + quiet) * modulePt,
          // A hair of overlap, so adjacent modules do not show hairlines
          // between them when the rasterizer rounds to device pixels.
          modulePt + 0.02,
          modulePt + 0.02,
        );
        drawn += 1;
      }
    }
    out.fill().restore();

    // Reported for the same reason bubble geometry is: a symbol is machine-read
    // hardware and the pixel gate cannot see it — adding the QR at all moved
    // 0.33% of a Letter page, under the golden suite's 0.5% tolerance, so every
    // snapshot passed with and without a scannable code.
    //
    // `darkModules` is counted AS THE RECTS ARE EMITTED, never recomputed from
    // the matrix. A count taken from `QRCode.create` would report a healthy
    // symbol even if the draw loop emitted nothing — which is exactly the
    // empty-box defect this record exists to catch.
    codes?.push({
      text: String(text),
      moduleCount: modules.size,
      darkModules: drawn,
      xPt, yPt, sizePt, page,
    });
  }

  function drawActionBox(out, node, { xPt, yPt, codes = null, page = null }) {
    const { padPt, borderWidthPt, borderDash, labelSizePt, codeSizePt, codeAreaPt, codeGapPt } = theme.action;
    out.save().lineWidth(borderWidthPt).strokeColor(theme.ink.box).dash(borderDash[0], { space: borderDash[1] });
    out.rect(xPt, yPt, node.widthPt, node.heightPt).stroke();
    out.undash();
    out.restore();

    const codeX = xPt + node.widthPt - padPt - codeAreaPt;
    drawQrCode(out, {
      text: node.codeText,
      xPt: codeX,
      yPt: yPt + padPt,
      sizePt: Math.min(codeAreaPt, node.heightPt - 2 * padPt),
      codes,
      page,
    });

    const textWidth = codeX - codeGapPt - (xPt + padPt);
    setFont(out, 'bold', labelSizePt);
    out.text(node.label, xPt + padPt, yPt + padPt, { width: textWidth, lineBreak: true, height: node.heightPt - 2 * padPt });
    setFont(out, 'regular', codeSizePt, 'muted');
    out.text(node.codeText, xPt + padPt, yPt + node.heightPt - padPt - codeSizePt, { width: textWidth, lineBreak: false });
  }

  function drawAsset(out, node, { xPt, yPt }) {
    // Unreachable via render(): the renderer's asset resolver throws rather than
    // return nothing. Kept so no future path can quietly print an empty box.
    if (!node.resolved || !node.svg) throw new UnresolvedAssetError(node.ref, 'document');
    SVGtoPDF(out, node.svg, xPt, yPt, {
      width: node.drawWidthPt, height: node.drawHeightPt, assumePt: true,
    });
    // The legacy `asset` block bakes its caption into this node; a `figure`
    // block's image node carries `caption: null` because its caption is a
    // separate sibling node (drawn by the ordinary `text` case below it).
    if (node.caption) {
      drawLines(out, node.caption.lines, {
        xPt, yPt: yPt + node.drawHeightPt + theme.asset.captionGapPt, styleKey: 'instruction',
      });
    }
  }

  /** `inset` — a rounded box behind its already-measured, already-stacked children. */
  function drawBox(out, node, position) {
    const { xPt, yPt } = position;
    out.save().lineWidth(node.borderWidthPt).strokeColor(theme.ink.box)
      .roundedRect(xPt, yPt, node.widthPt, node.heightPt, node.radiusPt).stroke().restore();
    const innerXPt = xPt + node.paddingPt;
    const innerYPt = yPt + node.paddingPt;
    for (const child of node.childNodes) {
      drawNode(out, child, { ...position, xPt: innerXPt, yPt: innerYPt + child.offsetYPt });
    }
  }

  /** `divider` — a bare rule centred in its reserved vertical band. */
  function drawDivider(out, node, { xPt, yPt }) {
    const { divider } = theme;
    const ruleY = yPt + divider.paddingAbovePt + divider.ruleWidthPt / 2;
    out.save().lineWidth(divider.ruleWidthPt).strokeColor(theme.ink.rule)
      .moveTo(xPt, ruleY).lineTo(xPt + node.widthPt, ruleY).stroke().restore();
  }

  /**
   * `list` — bullet dot / number text in a fixed marker column, or (checklist)
   * a stroked empty square: a vector primitive, not a Unicode box-glyph that
   * might not exist in the embedded font — the same reasoning the OMR row's
   * bubbles already follow.
   */
  function drawList(out, node, { xPt, yPt }) {
    const { list } = theme;
    const bodyStyle = theme.styles.body;
    const textXPt = xPt + node.markerColumnPt;
    for (const item of node.items) {
      const itemYPt = yPt + item.offsetYPt;
      if (item.marker === null) {
        const size = list.checklistSizePt;
        const squareY = itemYPt + (bodyStyle.leadingPt - size) / 2;
        out.save().lineWidth(list.checklistStrokeWidthPt).strokeColor(theme.ink.box)
          .rect(xPt, squareY, size, size).stroke().restore();
      } else {
        setFont(out, 'regular', bodyStyle.sizePt, bodyStyle.ink);
        out.text(item.marker, xPt, itemYPt, { width: node.markerColumnPt - 4, lineBreak: false });
      }
      drawLines(out, item.lines, { xPt: textXPt, yPt: itemYPt, styleKey: 'body' });
    }
  }

  /**
   * `wordbank` — a rounded box (theme.box chrome) around a wrapping flow of
   * terms in `label` style, printed in the order `node.rows` was measured
   * (upstream shuffling, Task 5, already baked that order in).
   */
  function drawWordbank(out, node, { xPt, yPt }) {
    out.save().lineWidth(node.borderWidthPt).strokeColor(theme.ink.box)
      .roundedRect(xPt, yPt, node.widthPt, node.heightPt, node.radiusPt).stroke().restore();
    const style = theme.styles.label;
    const innerXPt = xPt + node.paddingPt;
    let rowYPt = yPt + node.paddingPt;
    for (const row of node.rows) {
      for (const term of row) {
        setFont(out, style.font, style.sizePt, style.ink);
        out.text(term.text, innerXPt + term.xPt, rowYPt, { lineBreak: false });
      }
      rowYPt += node.rowHeightPt + node.rowGapPt;
    }
  }

  /**
   * `matching` — the block-internal two-column write-the-letter grid (spec
   * §6.2). Left items get a short blank rule + a number; right items get a
   * letter. Both columns are drawn from the SAME `yPt` origin the fragment
   * was placed at — `item.offsetYPt` (measure.mjs's `measureMatchingNode`)
   * already accounts for uneven left/right row heights.
   */
  function drawMatching(out, node, { xPt, yPt }) {
    const { matching } = theme;
    const bodyStyle = theme.styles.body;
    const leftXPt = xPt;
    const rightXPt = xPt + node.halfWidthPt + node.columnGapPt;

    for (const item of node.left) {
      const rowYPt = yPt + item.offsetYPt;
      const ruleY = rowYPt + bodyStyle.leadingPt / 2;
      out.save().lineWidth(theme.answerSpace.ruleWidthPt).strokeColor(theme.ink.rule)
        .moveTo(leftXPt, ruleY).lineTo(leftXPt + node.ruleWidthPt, ruleY).stroke().restore();
      setFont(out, 'bold', bodyStyle.sizePt, bodyStyle.ink);
      out.text(`${item.number}.`, leftXPt + node.ruleWidthPt + matching.ruleGapPt, rowYPt, { lineBreak: false });
      drawLines(out, item.lines, { xPt: leftXPt + node.leftMarkerPt, yPt: rowYPt, styleKey: 'body' });
    }
    for (const item of node.right) {
      const rowYPt = yPt + item.offsetYPt;
      setFont(out, 'bold', bodyStyle.sizePt, bodyStyle.ink);
      out.text(`${item.letter}.`, rightXPt, rowYPt, { lineBreak: false });
      drawLines(out, item.lines, { xPt: rightXPt + node.rightMarkerPt, yPt: rowYPt, styleKey: 'body' });
    }
  }

  /**
   * `answer_key` — the v2 teacher-key render mode's dense list (Task 6, spec
   * §4.1/§12.1). The section heading is drawn separately, by the ordinary
   * header banner (see `measureAnswerKeyNode`'s doc comment) — this node is
   * only the entry list. `node.entries[].offsetYPt` was measured relative to
   * the fragment's own top, so drawing is a flat replay: every entry at
   * `yPt + entry.offsetYPt`, no cursor math here — same "measurement decided
   * it, draw just replays it" discipline every other node in this file
   * follows.
   */
  function drawAnswerKey(out, node, { xPt, yPt }) {
    for (const entry of node.entries) {
      drawLines(out, entry.lines, { xPt, yPt: yPt + entry.offsetYPt, styleKey: theme.answerKey.lineStyleKey });
    }
  }

  /** Small muted labels in the left margin, aligned to a passage's own wrapped lines. */
  function drawLineNumbers(out, lines, { xPt, yPt, gutterPt }) {
    const style = theme.styles.caption ?? theme.styles.instruction ?? theme.styles.body;
    let cursorY = yPt;
    for (const line of lines) {
      if (line.lineNumber !== undefined) {
        setFont(out, 'regular', style.sizePt, 'muted');
        out.text(String(line.lineNumber), xPt, cursorY, {
          width: Math.max(gutterPt - 4, 0), align: 'right', lineBreak: false,
        });
      }
      cursorY += line.heightPt;
    }
  }

  /**
   * `node.showName`/`node.showDate`/`node.instructions` come from v2's
   * `document.header` (documentV2.mjs's archetype presets — infopage's is
   * `{name: false, date: false}`); v1 documents never set them, so
   * `headerFragment` (measure.mjs) defaults both show flags true and
   * `instructions` null — the SAME cursor math this function walks either
   * way, so a v1 render is byte-identical to before these fields existed.
   */
  function drawHeader(out, node, { xPt, yPt }) {
    const { titleSizePt, titleLeadingPt, metaSizePt, metaLeadingPt, ruleGapPt, ruleWidthPt, blankFieldPt } = theme.header;
    setFont(out, 'bold', titleSizePt);
    out.text(node.title, xPt, yPt, { width: node.widthPt, lineBreak: false });

    let cursorY = yPt + titleLeadingPt;

    if (node.instructions) {
      // Same style-fallback chain drawLineNumbers already uses for a theme
      // that may not carry every optional style key.
      const style = theme.styles.caption ?? theme.styles.instruction ?? theme.styles.body;
      setFont(out, style.font, style.sizePt, style.ink);
      out.text(node.instructions, xPt, cursorY, { width: node.widthPt, lineBreak: false });
      cursorY += metaLeadingPt;
    }

    if (node.showName || node.showDate) {
      const blank = BLANK_RULE.repeat(24);
      setFont(out, 'regular', metaSizePt, 'muted');
      if (node.showName) {
        out.text(`Name: ${node.studentName ?? blank}`, xPt, cursorY, { lineBreak: false });
      }
      // `node.date` (RenderPrintDocument's `context.date`, spec §7) prefills this
      // field exactly like `studentName` prefills Name above; null/undefined
      // (every caller before this field existed) keeps the blank ruled line.
      if (node.showDate) {
        out.text(`Date: ${node.date ?? blank}`, xPt + node.widthPt - blankFieldPt, cursorY, { width: blankFieldPt, lineBreak: false });
      }
      cursorY += metaLeadingPt;
    }

    // Score box (Phase B, spec §13): only when the quiz archetype's
    // `header.scoreBox` is set AND a caller supplied `totalPoints` (Task 5
    // computes it from the quiz's scored items) — absent either, this row
    // never prints, byte-identical to before this field existed.
    if (node.showScoreBox) {
      const blank = BLANK_RULE.repeat(4);
      setFont(out, 'regular', metaSizePt, 'muted');
      out.text(`Score ${blank} / ${node.totalPoints}`, xPt, cursorY, { lineBreak: false });
      cursorY += metaLeadingPt;
    }

    const ruleY = cursorY + ruleGapPt;
    out.save().lineWidth(ruleWidthPt).strokeColor(theme.ink.rule)
      .moveTo(xPt, ruleY).lineTo(xPt + node.widthPt, ruleY).stroke().restore();
  }

  /**
   * `cardHeader` — the card ID strip (Task 4, spec §5.2): "Card" label, then
   * large letter-spaced digits at their pre-measured x offsets (see
   * measure.mjs's `cardHeaderFragment` — the draw pass never re-measures a
   * digit), then the row-range meta text, all vertically centred inside
   * `theme.card.bandHeightPt`. When the card is fresh (`node.firstUse`), a
   * caption-style instruction line prints below the band.
   */
  function drawCardHeader(out, node, { xPt, yPt }) {
    const { card } = theme;
    const bandCentreY = yPt + card.bandHeightPt / 2;

    setFont(out, 'bold', card.labelSizePt);
    out.text(node.labelText, xPt, bandCentreY - card.labelSizePt / 2, { lineBreak: false });

    const digitsXPt = xPt + node.labelWidthPt + card.labelGapPt;
    setFont(out, 'bold', card.digitSizePt);
    for (const digit of node.digits) {
      out.text(digit.ch, digitsXPt + digit.xPt, bandCentreY - card.digitSizePt / 2, { lineBreak: false });
    }

    const metaXPt = digitsXPt + node.digitsWidthPt + card.metaGapPt;
    setFont(out, 'regular', card.metaSizePt, 'muted');
    out.text(node.metaText, metaXPt, bandCentreY - card.metaSizePt / 2, { lineBreak: false });

    if (node.instruction) {
      drawLines(out, node.instruction.lines, {
        xPt, yPt: yPt + card.bandHeightPt + card.instructionGapPt, styleKey: node.instruction.styleKey,
      });
    }
  }

  function drawNode(out, node, position) {
    switch (node.kind) {
      case 'text': drawLines(out, node.lines, { ...position, styleKey: node.styleKey }); break;
      case 'math': drawMath(out, node, position); break;
      case 'answerSpace': drawAnswerSpace(out, node, position); break;
      case 'omr': drawOmrRow(out, node, position); break;
      case 'action': drawActionBox(out, node, position); break;
      case 'asset': drawAsset(out, node, position); break;
      case 'header': drawHeader(out, node, position); break;
      case 'cardHeader': drawCardHeader(out, node, position); break;
      case 'box': drawBox(out, node, position); break;
      case 'divider': drawDivider(out, node, position); break;
      case 'list': drawList(out, node, position); break;
      case 'wordbank': drawWordbank(out, node, position); break;
      case 'matching': drawMatching(out, node, position); break;
      case 'answerKey': drawAnswerKey(out, node, position); break;
      // `spacer`: the whole point is blank space. The fragment's grown height
      // already pushes what follows down; nothing here puts ink on the page.
      case 'elasticSpace': break;
      // Unreachable: measure.mjs refuses any kind this switch does not cover.
      default: throw new Error(`no draw pass for measured node kind '${node.kind}'`);
    }
  }

  /**
   * `leftPt` is the PAGE's content-box left edge — `contentLeftPt` (the
   * factory default, no furniture) or, once furniture/gutter is opted in,
   * that page's own `contentBox(...).xPt` (F2: the same left edge
   * `contentBox`'s gutter-adjusted `widthPt` was measured against, and the
   * one furniture's own footer/continuation-strip painting already uses —
   * so body text starts flush with furniture, not the page's raw margin).
   * `fragment.gutterPt` (only ever set on a `passage`'s line-numbered text
   * node) is an UNRELATED, smaller reservation nested inside that box for
   * the line-number column — the two compose by simple addition.
   */
  function drawFragment(out, fragment, { page, marks, codes, leftPt = contentLeftPt }) {
    if (Array.isArray(fragment.lines)) {
      const gutterPt = fragment.gutterPt ?? 0;
      if (fragment.lineNumbers) {
        drawLineNumbers(out, fragment.lines, { xPt: leftPt, yPt: fragment.yPt, gutterPt });
      }
      drawLines(out, fragment.lines, {
        xPt: leftPt + gutterPt, yPt: fragment.yPt, styleKey: fragment.styleKey,
      });
      return;
    }
    // A fragment measured with its own inner gap (e.g. `figure`'s
    // theme.asset.captionGapPt) must be reflowed with that SAME gap, not
    // unconditionally the question's — see the `innerGapPt` comment in
    // measure.mjs's figureFragment.
    applyAnswerSpaceGrowth(fragment, fragment.innerGapPt ?? theme.question.innerGapPt);
    const nodeXPt = leftPt + (fragment.gutterPt ?? 0);
    if (fragment.number !== undefined) {
      setFont(out, 'bold', theme.question.numberSizePt);
      out.text(`${fragment.number}.`, leftPt, fragment.yPt, { width: fragment.gutterPt, lineBreak: false });
    }
    for (const node of fragment.nodes ?? []) {
      drawNode(out, node, { xPt: nodeXPt, yPt: fragment.yPt + node.offsetYPt, page, marks, codes });
    }
  }

  /**
   * Which equivalent form of the sheet this is, as a letter a person can read
   * off the page: form 1 is "Form B". Form 0 is UNMARKED — it is the ordinary
   * sheet, and a worksheet that never gets retried should not grow a label just
   * because retries are possible.
   */
  function formLabel(variant) {
    if (!Number.isInteger(variant) || variant <= 0) return null;
    // Past Z, the number itself: 26 forms of one worksheet is not a thing a
    // curriculum authors, and "Form AA" would read as a typo.
    return variant < 26 ? `Form ${String.fromCharCode(65 + variant)}` : `Form ${variant + 1}`;
  }

  /**
   * The legacy per-page footer ("Page x of y  ·  Form B"), unchanged since
   * before `furniture.mjs` existed. Kept verbatim — byte-for-byte, same
   * position — so every existing golden PDF (pixel-diffed in
   * `tests/isolated/rendering/school/golden/`) stays untouched.
   *
   * `render()`'s new `options.furniture` opts a document INTO
   * `furniture.mjs`'s richer footer (+ continuation strip + gutter) instead
   * of this one — the two are mutually exclusive per render, chosen once in
   * `renderPlaced` below, so a page is never drawn by both (no double-draw).
   * `furniture.mjs`'s footer intentionally does not carry the "Form B" form
   * label: that's a legacy variant-retry concept this renderer owns, not a
   * generic furniture concern.
   */
  function drawFooter(out, { page, pageCount, variant }) {
    const { sizePt, gapAbovePt } = theme.footer;
    const form = formLabel(variant);
    setFont(out, 'regular', sizePt, 'muted');
    out.text(
      form ? `Page ${page} of ${pageCount}  ·  ${form}` : `Page ${page} of ${pageCount}`,
      contentLeftPt,
      theme.page.heightPt - theme.page.marginPt + gapAbovePt,
      { width: contentRightPt - contentLeftPt, align: 'center', lineBreak: false },
    );
  }

  // ── answer key ────────────────────────────────────────────────────────
  function keyItemsFor(document, answers) {
    return collectQuestions(document.blocks)
      .filter((question) => answers[question.itemId] !== undefined)
      .map((question) => ({
        itemId: question.itemId,
        number: question.number,
        answer: String(answers[question.itemId]),
      }));
  }

  /** A key is its own document: separate blocks, separate render, no bubbles. */
  function keyDocumentFor(document, keyItems) {
    const md = keyItems.map((item) => `**${item.number}.**  ${item.answer}`).join('\n\n')
      || 'No answers were supplied for this document.';
    return {
      ...document,
      id: `${document.id}-key`,
      title: `${document.title || document.id} — ${theme.answerKey.titleSuffix}`,
      blocks: [{ type: 'rich_text', md }],
    };
  }

  // ── render ────────────────────────────────────────────────────────────
  function renderPlaced(document, {
    studentName, date = null, isAnswerKey, keyItems, bank, tokens, furniture = null, growLastPage = false,
    italic = false, totalPoints = null, keyBlocks = null, keyTitle = null, card = null,
  }) {
    // Opting into `furniture` shrinks the usable page height by the
    // footer-band + continuation-strip reservation (contentBox) BEFORE
    // placement runs, so no fragment is ever placed where furniture paints.
    // Without it, placement uses the page's full height exactly as it always
    // has — existing (non-furniture) callers and their goldens are untouched.
    // Computed BEFORE measurement (not after, as before F2) so `box.widthPt`
    // — narrowed by any gutter reservation — can be threaded into the SAME
    // measurement pass that decides where every line wraps; measuring at the
    // full page width while drawing/placing at a gutter-narrowed one is
    // exactly the "gutter is furniture-only" bug F2 fixes.
    const box = furniture ? contentBox(theme, furniture) : null;
    const measurementDoc = createMeasurementDocument({ theme, fontDir });
    const fragments = measureDocumentFragments(document, {
      doc: measurementDoc,
      theme,
      texToSvg,
      resolveAsset: assetResolver,
      resolveChoices: createChoiceResolver(bank),
      tokens,
      studentName,
      date,
      widthPt: box?.widthPt,
      // `*italic*` markdown grammar (v2, spec §12.8). Draw never re-parses
      // text — `drawLines` replays the font already baked into each
      // MEASURED run (`wrapRuns`/`inlineRuns` at measure time) — so this flag
      // only needs to reach measurement; nothing downstream of it changes.
      italic,
      // Score box (Phase B, spec §13): a pure passthrough to
      // `headerFragment` — this renderer computes nothing about points,
      // Task 5's caller supplies the already-summed total.
      totalPoints,
      // Card header strip (Phase C, Task 4, spec §5.2): a pure passthrough
      // to `cardHeaderFragment` — this renderer allocates no card, checks no
      // collision/range rule; Task 5's caller (RenderPrintDocument) supplies
      // the already-resolved allocation render context.
      card,
    });
    const { pages, errors } = placeFragments(fragments, {
      pageHeightPt: box?.pageHeightPt ?? theme.page.heightPt,
      marginPt: box?.marginPt ?? theme.page.marginPt,
      spacing: theme.spacing,
      // Fit policy `fill` (spec §7): RenderPrintDocument (Task 8) is the only
      // caller that ever sets this true. Default false reproduces every
      // existing render byte-for-byte — see layout.mjs's own doc comment.
      growLastPage,
    });
    if (errors.length) {
      const error = new Error(`document '${document.id}' cannot be laid out: ${errors.map((e) => e.message).join('; ')}`);
      error.name = 'DocumentLayoutError';
      error.errors = errors;
      throw error;
    }

    // Teacher key (Task 6, spec §4.1/§12.1): measured and PLACED as its own
    // small document, entirely separate from the fragments/placement above —
    // never folded into the SAME `placeFragments` call. Folding it in would
    // change which page `layout.mjs` considers "last" (`pages.slice(0, -1)`
    // in placeFragments), which would silently alter answer-space/spacer
    // growth on the STUDENT'S actual last page purely because more pages got
    // appended after it — exactly the drift RenderPrintDocument's caller
    // must never see between a teacher and a non-teacher render of the same
    // document. Keeping it a fully separate measure+place pass means the
    // STUDENT pages above are computed by the IDENTICAL call, with the
    // IDENTICAL `growLastPage`, regardless of whether a key follows.
    let keyPages = [];
    if (Array.isArray(keyBlocks) && keyBlocks.length > 0) {
      // Plain page metrics — NOT `box` (furniture's gutter/duplex/footer-band
      // reservation). A key page is a loose appendix, never bound into the
      // duplex-punched student packet the gutter exists for, and it carries
      // no footer of its own (below), so there is nothing for a footer-band
      // reservation to protect either — reserving either would silently
      // contradict this section's own "loose appendix" framing.
      const keyWidthPt = theme.page.widthPt - 2 * theme.page.marginPt;
      const keyDocument = { ...document, id: `${document.id}-teacher-key`, title: keyTitle, blocks: keyBlocks };
      const keyFragments = measureDocumentFragments(keyDocument, {
        doc: measurementDoc,
        theme,
        texToSvg,
        resolveAsset: assetResolver,
        widthPt: keyWidthPt,
        italic,
        // No Name/Date/score line on an appendix key page — it is not the
        // learner's sheet, and `keyTitle` already carries the section's own
        // heading text ("Answer key — <title> (variant N)").
        header: { name: false, date: false, scoreBox: false },
      });
      const placedKey = placeFragments(keyFragments, {
        pageHeightPt: theme.page.heightPt,
        marginPt: theme.page.marginPt,
        spacing: theme.spacing,
        // No elastic (answerSpace/spacer) nodes ever appear in a key section,
        // so this has no observable effect either way — explicit false for
        // the same reason every other growLastPage site in this file is.
        growLastPage: false,
      });
      if (placedKey.errors.length) {
        const error = new Error(
          `document '${document.id}' teacher key cannot be laid out: ${placedKey.errors.map((e) => e.message).join('; ')}`,
        );
        error.name = 'DocumentLayoutError';
        error.errors = placedKey.errors;
        throw error;
      }
      keyPages = placedKey.pages;
    }

    return new Promise((resolve, reject) => {
      const out = new PDFDocument({
        size: 'letter',
        margin: theme.page.marginPt,
        autoFirstPage: false,
        info: { CreationDate: PINNED_CREATION_DATE },
      });
      registerDocumentFonts(out, { theme, fontDir });

      const chunks = [];
      out.on('data', (chunk) => chunks.push(chunk));
      out.on('error', reject);
      out.on('end', () => resolve({
        pdf: Buffer.concat(chunks),
        // Total physical pages — student pages plus any appended teacher-key
        // pages. `formMap`/`codeMap` below stay scoped to the STUDENT pages'
        // own `marks`/`codes` (a key page carries no bubbles/QR codes of its
        // own), but the page count a caller reports (`RenderPrintDocument`,
        // the CLI) is honestly the whole artifact's page count.
        pageCount: pages.length + keyPages.length,
        // Null, not an empty map: a document with no bubbles has no form to
        // grade, and IDocumentRenderer's contract distinguishes the two.
        formMap: marks.length ? {
          formVersion: FORM_VERSION,
          documentId: document.id,
          seed: document.seed,
          variant: document.variant ?? 0,
          marks,
        } : null,
        // Always an array (empty is meaningful: this sheet has no scannable
        // ticket), unlike formMap, where null vs empty distinguishes "not a
        // gradeable form" from "a form with no bubbles".
        codeMap: codes,
        isAnswerKey,
        keyItems,
      }));

      const marks = [];
      const codes = [];
      pages.forEach((page, index) => {
        out.addPage();
        // Pagination belongs to layout.mjs alone. pdfkit otherwise spawns a
        // fresh page for anything that crosses a margin — which silently
        // doubled the page count once already (each page trailed by a page
        // containing only its footer).
        out.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
        // Under `duplex`, the gutter alternates side by page parity
        // (contentBox's own "mirror margins" rule), so the left edge is
        // recomputed PER PAGE — `box.widthPt` itself never changes (see
        // `contentBox`'s doc comment: both sides give up the same room), only
        // which side it's reserved from, which is exactly what `pageIndex`
        // resolves here.
        const pageLeftPt = furniture ? contentBox(theme, { ...furniture, pageIndex: index }).xPt : contentLeftPt;
        for (const fragment of page.fragments) {
          drawFragment(out, fragment, { page: index + 1, marks, codes, leftPt: pageLeftPt });
        }
        if (furniture) {
          drawFurniture(out, {
            theme,
            page: index + 1,
            pageCount: pages.length,
            title: furniture.title ?? document.title ?? document.id,
            nameLine: furniture.nameLine ?? studentName,
            duplex: furniture.duplex,
            gutter: furniture.gutter,
          });
        } else {
          drawFooter(out, { page: index + 1, pageCount: pages.length, variant: document.variant ?? 0 });
        }
      });
      // Teacher-key pages (Task 6): drawn from their OWN separately-placed
      // `keyPages`, appended after every student page. No footer/furniture —
      // an appendix key page carries no "Page x of y"/continuation-strip
      // chrome of its own in v1; its content (the entry list) is what
      // matters. `leftPt` is the plain (non-duplex, non-alternating) content
      // edge — a key page is a loose appendix, never bound into the
      // duplex-punched student packet the gutter reservation is for.
      keyPages.forEach((page, index) => {
        out.addPage();
        out.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
        for (const fragment of page.fragments) {
          drawFragment(out, fragment, { page: pages.length + index + 1, marks, codes, leftPt: contentLeftPt });
        }
      });
      out.end();
    });
  }

  /**
   * Render one document to a Letter PDF.
   *
   * @param {Object} document - a VALIDATED document ({ id, seed, variant, blocks }; `title` optional)
   * @param {Object} [options]
   * @param {string|null} [options.studentName] - printed on the name line
   * @param {Object<string,string>} [options.answers] - itemId → answer. When
   *   given, the returned artifact IS the answer key — a separate document.
   *   Call again without `answers` for the learner copy.
   * @param {boolean} [options.answerKey] - render the key sourcing answers from
   *   the bank, for callers that hold no answer map of their own.
   * @param {{id?: string, items: Array<{id: string, choices: string[], answer?: string}>}} [options.bank]
   *   the question bank behind this document. REQUIRED when the document has
   *   any `omr_response`: the choice text is printed from the bank, never
   *   duplicated into the document.
   * @param {Object<string,string>} [options.tokens] - action value → already-minted
   *   token, drawn in the action box. Nothing is minted here.
   * @param {number} [options.variant] - which equivalent form of the sheet this
   *   is. Overrides `document.variant`; it reaches the footer ("Form B") and the
   *   form map, so the artifact and its geometry both record WHICH sheet was
   *   handed over. Anything that is not a non-negative integer is ignored.
   *
   *   DEFERRED: this renderer does not GENERATE equivalent problems — a retry
   *   is the same questions under a new form letter. Real variant generation
   *   needs a problem generator per question type and is its own piece of work;
   *   until then the plumbing is honest about which form was issued, and the
   *   e2e suite reports the sameness rather than hiding it.
   * @param {Object} [options.furniture] - opt into `furniture.mjs` page
   *   furniture (page-x-of-y footer + continuation strip + gutter) INSTEAD OF
   *   the legacy `drawFooter`. Omitted/null (the default) leaves every
   *   existing caller's output byte-identical to before this option existed.
   * @param {string} [options.furniture.title] - continuation-strip title;
   *   defaults to `document.title ?? document.id`
   * @param {string|null} [options.furniture.nameLine] - continuation-strip
   *   "Name:" field; defaults to `studentName`
   * @param {boolean} [options.furniture.duplex] - alternate gutter side by page parity
   * @param {boolean|number} [options.furniture.gutter] - gutter width; see `furniture.mjs`
   * @param {string|null} [options.date] - printed on the header's Date line
   *   (RenderPrintDocument's `context.date`, spec §7); omitted/null keeps the
   *   blank ruled line, byte-identical to every caller before this option
   *   existed.
   * @param {boolean} [options.growLastPage] - fit policy `fill` (spec §7):
   *   forwarded to `placeFragments`' `growLastPage`, so the LAST page also
   *   bottoms out its answer spaces/spacers. Default false reproduces every
   *   existing render byte-for-byte.
   * @param {boolean} [options.italic] - recognise `*italic*` in `rich_text`/
   *   `passage` inline grammar (v2, spec §12.8). Default false reproduces
   *   every existing render byte-for-byte — a v1 caller's stray `*word*`
   *   keeps printing literally, exactly as before this option existed.
   * @param {number|null} [options.totalPoints] - the quiz's summed points
   *   (Phase B, spec §13). Printed as `Score ____ / <totalPoints>` in the
   *   header ONLY when the document's `header.scoreBox` is also true; this
   *   renderer does not compute a total itself — omitted/null (every caller
   *   before this option existed) prints no score line, byte-identical to
   *   before.
   * @param {Array<Object>|null} [options.keyBlocks] - teacher-key render mode
   *   (Task 6, spec §4.1/§12.1): when non-empty, an `answer_key` node block
   *   list (built by `RenderPrintDocument`, NOT authorable in source YAML —
   *   see measure.mjs's `measureAnswerKeyNode`), measured and PLACED as its
   *   OWN document and appended as extra pages after every student page.
   *   Never folded into the student document's own fragment/placement pass
   *   — see `renderPlaced`'s own comment for why that would risk changing
   *   the student's last-page answer-space growth. Omitted/null (every
   *   caller before this option existed) renders byte-identical to before.
   * @param {string|null} [options.keyTitle] - the appended key section's own
   *   page-1 heading (its mini document's `title`); required together with
   *   `keyBlocks`.
   * @param {{cardId: string|number, startRow: number, endRow: number, firstUse?: boolean}|null} [options.card] -
   *   card allocation render context (Phase C, Task 4, spec §5.2/§5.3): drawn
   *   as a strip directly below the document header — large letter-spaced
   *   card-ID digits plus "questions <startRow>-<endRow>", and, when
   *   `firstUse` is true, an instruction line telling the student where to
   *   bubble the ID in. This renderer computes no allocation itself (no
   *   cardId minting, no range/collision check) — Task 5's caller supplies
   *   the already-resolved context. Omitted/null (every caller before this
   *   option existed) renders byte-identical to before.
   * @returns {Promise<{pdf: Buffer, pageCount: number, formMap: Object|null, isAnswerKey: boolean, keyItems: Array}>}
   */
  async function render(source, {
    studentName = null, date = null, answers = null, answerKey = false, bank = null, tokens = null,
    variant = null, furniture = null, growLastPage = false, italic = false, totalPoints = null,
    keyBlocks = null, keyTitle = null, card = null,
  } = {}) {
    // The variant rides on the DOCUMENT, not just alongside it: the footer and
    // the form map both derive from what was rendered, so a variant passed only
    // in the options would be a variant the paper does not actually carry.
    const asked = Number.isInteger(variant) && variant >= 0 ? variant : null;
    const document = asked === null || asked === (source.variant ?? 0)
      ? source
      : { ...source, variant: asked };

    const resolvedAnswers = answers
      ?? (answerKey ? Object.fromEntries((bank?.items ?? [])
        .filter((item) => item.answer !== undefined)
        .map((item) => [item.id, item.answer])) : null);

    if (!resolvedAnswers) {
      return renderPlaced(document, {
        studentName, date, isAnswerKey: false, keyItems: [], bank, tokens, furniture, growLastPage, italic, totalPoints,
        keyBlocks, keyTitle, card,
      });
    }
    const keyItems = keyItemsFor(document, resolvedAnswers);
    return renderPlaced(keyDocumentFor(document, keyItems), {
      studentName: null, date: null, isAnswerKey: true, keyItems, bank, tokens, furniture, growLastPage, italic, totalPoints,
      card,
    });
  }

  return { render, FORM_VERSION };
}

export default { createDocumentPdfRenderer, FORM_VERSION };
