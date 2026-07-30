/**
 * Thermal receipt renderer for school documents.
 *
 * Same shape as the other thermal renderers (plan the heights on a scratch
 * context, then draw once onto a canvas of the exact size), and the same output:
 * a single-column PNG the ESC/POS path feeds to the printer.
 *
 * Two things differ from the Letter target on purpose:
 *
 * - **Math is rasterized.** Tape has no vector path at all, so the MathJax SVG
 *   is rendered to a bitmap at 2x and drawn down — the one place the
 *   no-rasterize rule does not bind, because there is no alternative.
 * - **Cuts, not pages.** Long output is torn at block boundaries; nothing is
 *   ever split mid-block.
 *
 * `omr_response` is REFUSED. Bubbles on 58mm tape cannot be fed through the
 * reader, so a receipt carrying them would be a sheet a child fills in and
 * nobody can ever grade — the exact silent failure this system exists to avoid.
 *
 * Token VALUES arrive from the caller and are drawn as text under the code area
 * so a grown-up can read them off the tape. Nothing here mints a token.
 *
 * @module rendering/school/documents/DocumentReceiptRenderer
 */

import { initCanvas } from '#rendering/lib/CanvasFactory.mjs';
import { wrapText } from '#rendering/lib/TextRenderer.mjs';
import QRCode from 'qrcode';

import { parseRichText } from './measure.mjs';
import { documentReceiptTheme } from './documentReceiptTheme.mjs';
import { texToSvg as mathJaxTexToSvg } from './mathSvg.mjs';

/** Blocks this target can print. Anything else is refused by name. */
const SUPPORTED = new Set(['rich_text', 'math', 'question', 'media_action', 'scan_action']);

export class ReceiptBlockError extends Error {
  constructor(message, blockType) {
    super(message);
    this.name = 'ReceiptBlockError';
    this.blockType = blockType;
  }
}

/** SVG → PNG bytes. Injectable; the default is the repo's resvg binding. */
async function defaultRasterizeSvg({ svgString, widthPx }) {
  const { Resvg } = await import('@resvg/resvg-js');
  return new Resvg(svgString, { fitTo: { mode: 'width', value: widthPx } }).render().asPng();
}

export function createDocumentReceiptRenderer({
  theme = documentReceiptTheme,
  texToSvg = mathJaxTexToSvg,
  rasterizeSvg = defaultRasterizeSvg,
  fontDir = undefined,
  scanCodes = 'box',
} = {}) {
  const contentWidth = theme.canvas.width - 2 * theme.layout.margin;

  /**
   * Wrap where a word break exists, then break mid-word on what is left. Tokens
   * are opaque strings with no spaces in them: word wrapping alone leaves them
   * running off the edge of the tape, where the part a grown-up needs to read
   * is simply not printed.
   */
  function wrapTight(ctx, text, maxWidth) {
    const lines = [];
    for (const line of wrapText(ctx, text, maxWidth)) {
      let rest = line;
      while (ctx.measureText(rest).width > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > maxWidth) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      lines.push(rest);
    }
    return lines;
  }

  function textOps(ctx, text, { font, lineHeight }) {
    ctx.font = font;
    const lines = wrapText(ctx, text, contentWidth);
    return { kind: 'text', font, lineHeight, lines, heightPx: lines.length * lineHeight };
  }

  async function mathOp(tex, display) {
    const svg = texToSvg(tex, { display, fontSizePt: theme.math.fontSizePt, ink: theme.colors.text });
    const naturalWidth = svg.widthPt * theme.math.pxPerPt;
    const naturalHeight = svg.heightPt * theme.math.pxPerPt;
    const scale = Math.min(1, contentWidth / naturalWidth);
    const widthPx = naturalWidth * scale;
    const heightPx = naturalHeight * scale;
    const png = await rasterizeSvg({
      svgString: svg.svgString,
      widthPx: Math.round(widthPx * theme.math.rasterScale),
    });
    // heightPx is the drawn bitmap; totalHeightPx is what placement advances by.
    return { kind: 'math', png, widthPx, heightPx, totalHeightPx: heightPx + 2 * theme.math.padY };
  }

  function actionOp(ctx, block, tokens) {
    const code = tokens?.[block.action] ?? block.code ?? block.token ?? block.action;
    ctx.font = theme.fonts.label;
    const labelWidth = contentWidth - 2 * theme.action.padding - theme.action.codeAreaPx - theme.action.labelGap;
    const labelLines = wrapTight(ctx, block.label, labelWidth);
    ctx.font = theme.fonts.code;
    const codeLines = wrapTight(ctx, code, theme.action.codeAreaPx);
    const textHeight = labelLines.length * theme.text.bodyLineHeight;
    const codeBlockHeight = theme.action.codeAreaPx + theme.action.codeGap
      + codeLines.length * theme.text.codeLineHeight;
    return {
      kind: 'action',
      blockType: block.type,
      action: block.action,
      code,
      labelLines,
      codeLines,
      heightPx: Math.max(textHeight, codeBlockHeight) + 2 * theme.action.padding,
    };
  }

  /** One block → its draw ops. Refusals happen here, by name, before anything draws. */
  async function planBlock(ctx, block, { tokens, ops, codes }) {
    if (block.type === 'omr_response') {
      throw new ReceiptBlockError(
        'omr_response cannot be printed on receipt tape: the mark reader takes Letter sheets, '
        + 'so a bubble row here would be filled in and never gradeable',
        'omr_response',
      );
    }
    if (!SUPPORTED.has(block.type)) {
      throw new ReceiptBlockError(`block type '${block.type}' has no receipt rendering`, block.type);
    }

    switch (block.type) {
      case 'rich_text':
        for (const part of parseRichText(block.md)) {
          if (part.kind === 'math') ops.push(await mathOp(part.tex, true));
          else if (part.style === 'heading') ops.push(textOps(ctx, part.text, { font: theme.fonts.heading, lineHeight: theme.text.headingLineHeight }));
          else ops.push(textOps(ctx, part.text, { font: theme.fonts.body, lineHeight: theme.text.bodyLineHeight }));
        }
        break;

      case 'math':
        ops.push(await mathOp(block.tex, block.display !== false));
        break;

      case 'question':
        ops.push(textOps(ctx, `${block.number}.`, { font: theme.fonts.label, lineHeight: theme.text.bodyLineHeight }));
        for (const child of block.blocks) {
          // eslint-disable-next-line no-await-in-loop
          await planBlock(ctx, child, { tokens, ops, codes });
        }
        break;

      default: {
        const op = actionOp(ctx, block, tokens);
        ops.push(op);
        codes.push({ action: op.action, code: op.code, kind: op.blockType, lines: op.codeLines });
      }
    }
  }

  /**
   * Render a receipt-target document.
   *
   * @param {Object} document - a validated document
   * @param {Object} [options]
   * @param {Object<string,string>} [options.tokens] - action value → already-minted token
   * @returns {Promise<{canvas: Object, width: number, height: number, cutPoints: number[],
   *   codes: Array<{action: string, code: string, kind: string, lines: string[]}>, drawnMath: Array<{widthPx: number, heightPx: number}>}>}
   */
  async function createCanvas(document, { tokens = null } = {}) {
    const fontConfig = {
      fontDir, fontFile: theme.fonts.fontPath, fontFamily: theme.fonts.family,
    };
    const { ctx: scratch } = await initCanvas({ width: 1, height: 1, ...fontConfig });

    const ops = [];
    const codes = [];
    ops.push(textOps(scratch, document.title || document.id, {
      font: theme.fonts.heading, lineHeight: theme.text.headingLineHeight,
    }));
    for (const block of document.blocks) {
      // eslint-disable-next-line no-await-in-loop
      await planBlock(scratch, block, { tokens, ops, codes });
    }

    // Place ops, tearing the tape at the first block boundary past the segment
    // limit. A block is never split across a cut.
    const cutPoints = [];
    let y = theme.layout.margin;
    let segmentStart = 0;
    for (const op of ops) {
      const opHeight = op.kind === 'math' ? op.totalHeightPx : op.heightPx;
      if (y - segmentStart > theme.layout.maxSegmentPx) {
        cutPoints.push(y);
        y += theme.layout.cutGap;
        segmentStart = y;
      }
      op.yPx = y;
      y += opHeight + theme.layout.blockGap;
    }
    const height = Math.ceil(y - theme.layout.blockGap + theme.layout.margin);
    cutPoints.push(height);

    const { canvas, ctx } = await initCanvas({ width: theme.canvas.width, height, ...fontConfig });
    ctx.fillStyle = theme.colors.background;
    ctx.fillRect(0, 0, theme.canvas.width, height);
    ctx.fillStyle = theme.colors.text;

    const { loadImage } = await import('canvas');
    const drawnMath = [];
    const x = theme.layout.margin;

    for (const op of ops) {
      if (op.kind === 'text') {
        ctx.font = op.font;
        op.lines.forEach((line, index) => ctx.fillText(line, x, op.yPx + index * op.lineHeight));
        continue;
      }
      if (op.kind === 'math') {
        // eslint-disable-next-line no-await-in-loop
        const image = await loadImage(op.png);
        ctx.drawImage(image, x, op.yPx + theme.math.padY, op.widthPx, op.heightPx);
        drawnMath.push({ widthPx: op.widthPx, heightPx: op.heightPx });
        continue;
      }

      const boxHeight = op.heightPx;
      ctx.lineWidth = theme.action.borderWidth;
      ctx.strokeStyle = theme.colors.border;
      ctx.strokeRect(x, op.yPx, contentWidth, boxHeight);

      ctx.font = theme.fonts.label;
      op.labelLines.forEach((line, index) => ctx.fillText(
        line, x + theme.action.padding, op.yPx + theme.action.padding + index * theme.text.bodyLineHeight,
      ));

      const codeX = x + contentWidth - theme.action.padding - theme.action.codeAreaPx;
      const codeY = op.yPx + theme.action.padding;
      ctx.strokeRect(codeX, codeY, theme.action.codeAreaPx, theme.action.codeAreaPx);

      if (scanCodes === 'qr') {
        ctx.save();
        const qr = QRCode.create(op.code, { errorCorrectionLevel: 'M' });
        const count = qr.modules.size;
        const quiet = 2; // modules of quiet zone inside the box
        const cell = Math.floor(theme.action.codeAreaPx / (count + 2 * quiet));
        const offset = Math.floor((theme.action.codeAreaPx - cell * count) / 2);
        ctx.fillStyle = '#000';
        for (let r = 0; r < count; r += 1) {
          for (let c = 0; c < count; c += 1) {
            if (qr.modules.get(r, c)) {
              ctx.fillRect(codeX + offset + c * cell, codeY + offset + r * cell, cell, cell);
            }
          }
        }
        ctx.restore();
      }

      ctx.font = theme.fonts.code;
      op.codeLines.forEach((line, index) => ctx.fillText(
        line, codeX, codeY + theme.action.codeAreaPx + theme.action.codeGap + index * theme.text.codeLineHeight,
      ));
    }

    return { canvas, width: theme.canvas.width, height, cutPoints, codes, drawnMath };
  }

  return { createCanvas, rasterizeSvg };
}

export default { createDocumentReceiptRenderer };
