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

import { placeFragments } from './layout.mjs';
import {
  measureDocumentFragments, createMeasurementDocument, registerDocumentFonts,
  MissingChoicesError, UnresolvedAssetError,
} from './measure.mjs';
import { documentPdfTheme } from './documentPdfTheme.mjs';
import { texToSvg as mathJaxTexToSvg } from './mathSvg.mjs';

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
  let growable = nodes
    .filter((node) => node.kind === 'answerSpace')
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
    if (!Array.isArray(item.choices) || item.choices.length !== choices) {
      throw new MissingChoicesError(
        `item '${itemId}' has ${item.choices?.length ?? 0} bank choices but the sheet prints ${choices} bubbles`,
        path, itemId,
      );
    }
    return item.choices.map((choice) => String(choice));
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

  function drawLines(out, lines, { xPt, yPt, styleKey }) {
    const style = theme.styles[styleKey];
    let cursorY = yPt;
    for (const line of lines) {
      for (const run of line.runs) {
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
      throw new MissingChoicesError('bubble row has no choice text to print', node.itemId, node.itemId);
    }
    const centreY = yPt + rowHeightPt / 2;
    const textY = yPt + rowHeightPt + choiceGapPt;

    node.cells.forEach((cell, index) => {
      const cellX = xPt + indentPt + index * node.cellWidthPt;
      const labelWidth = setFont(out, 'regular', labelSizePt).widthOfString(cell.choice);
      const centreX = cellX + labelWidth + labelGapPt + bubbleRadiusPt;

      out.text(cell.choice, cellX, centreY - labelSizePt / 2, { lineBreak: false });
      out.save().lineWidth(bubbleStrokeWidthPt).strokeColor(theme.ink.bubble)
        .circle(centreX, centreY, bubbleRadiusPt).stroke().restore();

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

  function drawActionBox(out, node, { xPt, yPt }) {
    const { padPt, borderWidthPt, borderDash, labelSizePt, codeSizePt, codeAreaPt, codeGapPt } = theme.action;
    out.save().lineWidth(borderWidthPt).strokeColor(theme.ink.box).dash(borderDash[0], { space: borderDash[1] });
    out.rect(xPt, yPt, node.widthPt, node.heightPt).stroke();
    out.undash();

    const codeX = xPt + node.widthPt - padPt - codeAreaPt;
    out.rect(codeX, yPt + padPt, codeAreaPt, node.heightPt - 2 * padPt).stroke();
    out.restore();

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
    drawLines(out, node.caption.lines, {
      xPt, yPt: yPt + node.drawHeightPt + theme.asset.captionGapPt, styleKey: 'instruction',
    });
  }

  function drawHeader(out, node, { xPt, yPt }) {
    const { titleSizePt, titleLeadingPt, metaSizePt, metaLeadingPt, ruleGapPt, ruleWidthPt, blankFieldPt } = theme.header;
    setFont(out, 'bold', titleSizePt);
    out.text(node.title, xPt, yPt, { width: node.widthPt, lineBreak: false });

    const metaY = yPt + titleLeadingPt;
    const blank = BLANK_RULE.repeat(24);
    setFont(out, 'regular', metaSizePt, 'muted');
    out.text(`Name: ${node.studentName ?? blank}`, xPt, metaY, { lineBreak: false });
    out.text(`Date: ${blank}`, xPt + node.widthPt - blankFieldPt, metaY, { width: blankFieldPt, lineBreak: false });

    const ruleY = metaY + metaLeadingPt + ruleGapPt;
    out.save().lineWidth(ruleWidthPt).strokeColor(theme.ink.rule)
      .moveTo(xPt, ruleY).lineTo(xPt + node.widthPt, ruleY).stroke().restore();
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
      // Unreachable: measure.mjs refuses any kind this switch does not cover.
      default: throw new Error(`no draw pass for measured node kind '${node.kind}'`);
    }
  }

  function drawFragment(out, fragment, { page, marks }) {
    if (Array.isArray(fragment.lines)) {
      drawLines(out, fragment.lines, { xPt: contentLeftPt, yPt: fragment.yPt, styleKey: fragment.styleKey });
      return;
    }
    applyAnswerSpaceGrowth(fragment, theme.question.innerGapPt);
    const nodeXPt = contentLeftPt + (fragment.gutterPt ?? 0);
    if (fragment.number !== undefined) {
      setFont(out, 'bold', theme.question.numberSizePt);
      out.text(`${fragment.number}.`, contentLeftPt, fragment.yPt, { width: fragment.gutterPt, lineBreak: false });
    }
    for (const node of fragment.nodes ?? []) {
      drawNode(out, node, { xPt: nodeXPt, yPt: fragment.yPt + node.offsetYPt, page, marks });
    }
  }

  function drawFooter(out, { page, pageCount }) {
    const { sizePt, gapAbovePt } = theme.footer;
    setFont(out, 'regular', sizePt, 'muted');
    out.text(
      `Page ${page} of ${pageCount}`,
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
  function renderPlaced(document, { studentName, isAnswerKey, keyItems, bank }) {
    const measurementDoc = createMeasurementDocument({ theme, fontDir });
    const fragments = measureDocumentFragments(document, {
      doc: measurementDoc,
      theme,
      texToSvg,
      resolveAsset: assetResolver,
      resolveChoices: createChoiceResolver(bank),
      studentName,
    });
    const { pages, errors } = placeFragments(fragments, {
      pageHeightPt: theme.page.heightPt,
      marginPt: theme.page.marginPt,
      spacing: theme.spacing,
    });
    if (errors.length) {
      const error = new Error(`document '${document.id}' cannot be laid out: ${errors.map((e) => e.message).join('; ')}`);
      error.name = 'DocumentLayoutError';
      error.errors = errors;
      throw error;
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
        pageCount: pages.length,
        formMap: {
          formVersion: FORM_VERSION,
          documentId: document.id,
          seed: document.seed,
          variant: document.variant ?? 0,
          marks,
        },
        isAnswerKey,
        keyItems,
      }));

      const marks = [];
      pages.forEach((page, index) => {
        out.addPage();
        // Pagination belongs to layout.mjs alone. pdfkit otherwise spawns a
        // fresh page for anything that crosses a margin — which silently
        // doubled the page count once already (each page trailed by a page
        // containing only its footer).
        out.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
        for (const fragment of page.fragments) {
          drawFragment(out, fragment, { page: index + 1, marks });
        }
        drawFooter(out, { page: index + 1, pageCount: pages.length });
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
   * @param {{id?: string, items: Array<{id: string, choices: string[]}>}} [options.bank]
   *   the question bank behind this document. REQUIRED when the document has
   *   any `omr_response`: the choice text is printed from the bank, never
   *   duplicated into the document.
   * @returns {Promise<{pdf: Buffer, pageCount: number, formMap: Object, isAnswerKey: boolean, keyItems: Array}>}
   */
  async function render(document, { studentName = null, answers = null, bank = null } = {}) {
    if (!answers) {
      return renderPlaced(document, { studentName, isAnswerKey: false, keyItems: [], bank });
    }
    const keyItems = keyItemsFor(document, answers);
    return renderPlaced(keyDocumentFor(document, keyItems), {
      studentName: null, isAnswerKey: true, keyItems, bank,
    });
  }

  return { render, FORM_VERSION };
}

export default { createDocumentPdfRenderer, FORM_VERSION };
