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
      throw new MissingChoicesError(
        'bubble row has no choice text to print', `omr_response(${node.itemId})`, node.itemId,
      );
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
      case 'box': drawBox(out, node, position); break;
      case 'divider': drawDivider(out, node, position); break;
      case 'list': drawList(out, node, position); break;
      // `spacer`: the whole point is blank space. The fragment's grown height
      // already pushes what follows down; nothing here puts ink on the page.
      case 'elasticSpace': break;
      // Unreachable: measure.mjs refuses any kind this switch does not cover.
      default: throw new Error(`no draw pass for measured node kind '${node.kind}'`);
    }
  }

  function drawFragment(out, fragment, { page, marks, codes }) {
    if (Array.isArray(fragment.lines)) {
      const gutterPt = fragment.gutterPt ?? 0;
      if (fragment.lineNumbers) {
        drawLineNumbers(out, fragment.lines, { xPt: contentLeftPt, yPt: fragment.yPt, gutterPt });
      }
      drawLines(out, fragment.lines, {
        xPt: contentLeftPt + gutterPt, yPt: fragment.yPt, styleKey: fragment.styleKey,
      });
      return;
    }
    // A fragment measured with its own inner gap (e.g. `figure`'s
    // theme.asset.captionGapPt) must be reflowed with that SAME gap, not
    // unconditionally the question's — see the `innerGapPt` comment in
    // measure.mjs's figureFragment.
    applyAnswerSpaceGrowth(fragment, fragment.innerGapPt ?? theme.question.innerGapPt);
    const nodeXPt = contentLeftPt + (fragment.gutterPt ?? 0);
    if (fragment.number !== undefined) {
      setFont(out, 'bold', theme.question.numberSizePt);
      out.text(`${fragment.number}.`, contentLeftPt, fragment.yPt, { width: fragment.gutterPt, lineBreak: false });
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
  function renderPlaced(document, { studentName, isAnswerKey, keyItems, bank, tokens }) {
    const measurementDoc = createMeasurementDocument({ theme, fontDir });
    const fragments = measureDocumentFragments(document, {
      doc: measurementDoc,
      theme,
      texToSvg,
      resolveAsset: assetResolver,
      resolveChoices: createChoiceResolver(bank),
      tokens,
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
        for (const fragment of page.fragments) {
          drawFragment(out, fragment, { page: index + 1, marks, codes });
        }
        drawFooter(out, { page: index + 1, pageCount: pages.length, variant: document.variant ?? 0 });
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
   * @returns {Promise<{pdf: Buffer, pageCount: number, formMap: Object|null, isAnswerKey: boolean, keyItems: Array}>}
   */
  async function render(source, {
    studentName = null, answers = null, answerKey = false, bank = null, tokens = null,
    variant = null,
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
      return renderPlaced(document, { studentName, isAnswerKey: false, keyItems: [], bank, tokens });
    }
    const keyItems = keyItemsFor(document, resolvedAnswers);
    return renderPlaced(keyDocumentFor(document, keyItems), {
      studentName: null, isAnswerKey: true, keyItems, bank, tokens,
    });
  }

  return { render, FORM_VERSION };
}

export default { createDocumentPdfRenderer, FORM_VERSION };
