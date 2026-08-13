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

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initCanvas } from '#rendering/lib/CanvasFactory.mjs';
import { wrapText } from '#rendering/lib/TextRenderer.mjs';
import QRCode from 'qrcode';

import { parseRichText } from './measure.mjs';
import { documentReceiptTheme } from './documentReceiptTheme.mjs';
import { texToSvg as mathJaxTexToSvg } from './mathSvg.mjs';

/**
 * The subject shelf icons — the SAME nine SVG files the School home grid
 * renders, shared rather than copied so a swapped icon changes both surfaces
 * (frontend/src/modules/School/home/icons/MANIFEST.md documents the set). The
 * files are `currentColor` inline icons; tape has no CSS cascade, so the
 * loader pins the ink below.
 */
const DEFAULT_ICON_DIR = fileURLToPath(
  new URL('../../../../../frontend/src/modules/School/home/icons/svg', import.meta.url),
);

/** Blocks this target can print. Anything else is refused by name. */
const SUPPORTED = new Set(['rich_text', 'math', 'question', 'media_action', 'scan_action', 'result_summary']);

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
  iconDir = DEFAULT_ICON_DIR,
  scanCodes = 'box',
} = {}) {
  const contentWidth = theme.canvas.width - 2 * theme.layout.margin;

  /**
   * Icon id → rasterized PNG bytes, or null for an id with no file. Icons are
   * DECORATION: a missing or unreadable one degrades to the un-iconed box the
   * tape printed last week, never to a failed print. Cached because an agenda
   * repeats the same nine subjects forever.
   */
  const iconCache = new Map();
  async function iconPng(icon) {
    if (iconCache.has(icon)) return iconCache.get(icon);
    let png = null;
    // Slug ids only — `icon` comes from document data, and a path separator in
    // it must not turn a decoration into a directory-traversal read.
    if (/^[a-z0-9][a-z0-9-]*$/.test(icon)) {
      try {
        const svg = await readFile(`${iconDir}/${icon}.svg`, 'utf8');
        png = await rasterizeSvg({
          svgString: svg.replaceAll('currentColor', theme.colors.text),
          widthPx: theme.action.iconPx * 2,
        });
      } catch {
        png = null;
      }
    }
    iconCache.set(icon, png);
    return png;
  }

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

  function chunkCode(code) {
    const text = String(code ?? '');
    const m = /^([a-z0-9]+:)(.+)$/i.exec(text);
    if (!m) return text;
    const chunks = m[2].match(/.{1,4}/g) ?? [];
    return `${m[1]}${chunks.join('-')}`;
  }

  function actionOp(ctx, block, tokens, { icon = null } = {}) {
    const code = tokens?.[block.action] ?? block.code ?? block.token ?? block.action;
    const lesson = block.presentation === 'lesson';
    const iconSpan = icon ? theme.action.iconPx + theme.action.iconGap : 0;
    ctx.font = theme.fonts.label;
    const labelWidth = contentWidth - 2 * theme.action.padding - theme.action.codeAreaPx
      - (lesson ? theme.action.lessonTextGap : theme.action.labelGap) - iconSpan;
    const labelLines = wrapTight(ctx, lesson && block.taxonomy ? `Lesson · ${block.label}` : block.label, labelWidth);
    ctx.font = theme.fonts.eyebrow;
    const eyebrowLines = lesson && block.eyebrow ? wrapTight(ctx, block.eyebrow.toUpperCase(), labelWidth) : [];
    ctx.font = theme.fonts.description;
    const descriptionLines = lesson && block.description ? wrapTight(ctx, block.description, labelWidth) : [];
    ctx.font = theme.fonts.code;
    const metaLines = lesson && block.meta ? wrapTight(ctx, block.meta, labelWidth) : [];
    const taxonomyLines = lesson && block.taxonomy
      ? [`Course · ${block.taxonomy.course}`, `Unit · ${block.taxonomy.unit}`]
        .flatMap((line) => wrapTight(ctx, line, labelWidth))
      : [];
    ctx.font = theme.fonts.code;
    // The human-readable fallback code CHUNKS in fours past the scheme prefix
    // (design audit: 'sch:8V2QWGT4A / FXHHD4U' wrapped mid-token). A code a
    // person may have to type by hand deserves phone-number ergonomics.
    const codeLines = block.hideCode ? [] : wrapTight(ctx, chunkCode(code), theme.action.codeAreaPx);
    const textHeight = lesson
      ? eyebrowLines.length * theme.action.eyebrowLineHeight
        + labelLines.length * theme.text.bodyLineHeight
        + descriptionLines.length * theme.action.descriptionLineHeight
        + taxonomyLines.length * theme.text.codeLineHeight
        + metaLines.length * theme.text.codeLineHeight + 10
      : labelLines.length * theme.text.bodyLineHeight;
    const iconHeight = icon ? theme.action.iconPx : 0;
    const codeBlockHeight = theme.action.codeAreaPx + (codeLines.length ? theme.action.codeGap : 0)
      + codeLines.length * theme.text.codeLineHeight;
    return {
      kind: 'action',
      blockType: block.type,
      action: block.action,
      code,
      icon,
      lesson,
      eyebrowLines,
      labelLines,
      descriptionLines,
      metaLines,
      taxonomyLines,
      codeLines,
      heightPx: Math.max(textHeight, iconHeight, codeBlockHeight) + 2 * theme.action.padding,
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

      case 'result_summary': {
        const hasCounts = Number.isInteger(block.correctCount) && Number.isInteger(block.totalCount);
        const count = hasCounts ? block.totalCount : 0;
        const boxesWidth = count * theme.result.boxSize + Math.max(0, count - 1) * theme.result.boxGap;
        const summaryIcon = block.icon ? await iconPng(block.icon) : null;
        ctx.font = theme.fonts.code;
        const taxonomyLines = block.taxonomy
          ? [
            `Subject · ${block.taxonomy.subject}`,
            `Course · ${block.taxonomy.course}`,
            `Unit · ${block.taxonomy.unit}`,
          ].flatMap((line) => wrapTight(ctx, line, contentWidth))
          : [];
        ops.push({
          kind: 'result-summary', ...block, summaryIcon, taxonomyLines, boxesWidth,
          heightPx: theme.result.padY * 2 + theme.result.headlineLineHeight
            + theme.result.titleLineHeight + (hasCounts ? theme.result.boxSize + 42 : 38)
            + (block.progress ? 62 : 0) + (summaryIcon ? theme.action.iconPx + 8 : 0)
            + ((block.learnerName || block.date || block.studentNo) ? 36 : 0)
            + (typeof block.passingPercent === 'number' ? 27 : 0)
            + taxonomyLines.length * theme.text.codeLineHeight,
        });
        break;
      }

      default: {
        // The icon is fetched FIRST because a file that turns out to be
        // missing must plan the box without an icon gap, not leave a hole.
        const icon = typeof block.icon === 'string' && block.icon
          ? await iconPng(block.icon)
          : null;
        const op = actionOp(ctx, block, tokens, { icon });
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
    if (document.title) {
      // The standard header: the title on a full-bleed black band. Only a
      // title gets the banner — an untitled document keeps its id as the
      // plain heading below, which is a debug affordance, not a headline.
      scratch.font = theme.fonts.header;
      const lines = wrapText(scratch, String(document.title).toUpperCase(), contentWidth);
      ops.push({
        kind: 'header', lines,
        heightPx: lines.length * theme.header.lineHeight + 2 * theme.header.padY,
      });
    } else {
      ops.push(textOps(scratch, document.id, {
        font: theme.fonts.heading, lineHeight: theme.text.headingLineHeight,
      }));
    }
    for (const block of document.blocks) {
      // eslint-disable-next-line no-await-in-loop
      await planBlock(scratch, block, { tokens, ops, codes });
    }

    // Place ops, tearing the tape at the first block boundary past the segment
    // limit. A block is never split across a cut. A header band bleeds to the
    // physical top of the tape, so it alone starts at 0 instead of the margin.
    const cutPoints = [];
    let y = ops[0]?.kind === 'header' ? 0 : theme.layout.margin;
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
      if (op.kind === 'header') {
        ctx.fillStyle = theme.colors.text;
        ctx.fillRect(0, op.yPx, theme.canvas.width, op.heightPx);
        ctx.fillStyle = theme.colors.background;
        ctx.font = theme.fonts.header;
        op.lines.forEach((line, index) => ctx.fillText(
          line,
          Math.max(theme.layout.margin, (theme.canvas.width - ctx.measureText(line).width) / 2),
          op.yPx + theme.header.padY + index * theme.header.lineHeight,
        ));
        ctx.fillStyle = theme.colors.text;
        continue;
      }
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
      if (op.kind === 'result-summary') {
        let sy = op.yPx + theme.result.padY;
        ctx.textAlign = 'center';
        if (op.summaryIcon) {
          // eslint-disable-next-line no-await-in-loop
          const summaryIcon = await loadImage(op.summaryIcon);
          ctx.drawImage(summaryIcon, (theme.canvas.width - theme.action.iconPx) / 2, sy, theme.action.iconPx, theme.action.iconPx);
          sy += theme.action.iconPx + 8;
        }
        if (op.learnerName || op.date || op.studentNo) {
          ctx.font = theme.fonts.code;
          const identity = [op.learnerName && `Name: ${op.learnerName}`, op.date && `Date: ${op.date}`, op.studentNo && `Student No. ${op.studentNo}`]
            .filter(Boolean).join('  ·  ');
          ctx.fillText(identity, theme.canvas.width / 2, sy);
          sy += 36;
        }
        if (op.taxonomyLines.length) {
          ctx.font = theme.fonts.code;
          op.taxonomyLines.forEach((line, index) => ctx.fillText(
            line, theme.canvas.width / 2, sy + index * theme.text.codeLineHeight,
          ));
          sy += op.taxonomyLines.length * theme.text.codeLineHeight;
        }
        ctx.font = theme.fonts.heading;
        ctx.fillText(op.headline, theme.canvas.width / 2, sy);
        sy += theme.result.headlineLineHeight;
        ctx.font = theme.fonts.body;
        ctx.fillText(op.taxonomy ? `Lesson · ${op.title}` : op.title, theme.canvas.width / 2, sy);
        sy += theme.result.titleLineHeight;
        if (Number.isInteger(op.correctCount) && Number.isInteger(op.totalCount)) {
          const startX = (theme.canvas.width - op.boxesWidth) / 2;
          for (let index = 0; index < op.totalCount; index += 1) {
            const bx = startX + index * (theme.result.boxSize + theme.result.boxGap);
            ctx.lineWidth = theme.result.boxLineWidth;
            ctx.strokeRect(bx, sy, theme.result.boxSize, theme.result.boxSize);
            ctx.font = theme.fonts.eyebrow;
            ctx.fillText(index < op.correctCount ? '✓' : '×', bx + theme.result.boxSize / 2, sy + 3);
          }
          sy += theme.result.boxSize + 8;
          ctx.font = theme.fonts.label;
          ctx.fillText(`${op.correctCount} of ${op.totalCount} correct`, theme.canvas.width / 2, sy);
          sy += 34;
        } else if (typeof op.percent === 'number') {
          ctx.font = theme.fonts.label;
          ctx.fillText(`Score: ${Math.round(op.percent)}%`, theme.canvas.width / 2, sy);
          sy += 34;
        }
        if (typeof op.passingPercent === 'number') {
          ctx.font = theme.fonts.code;
          ctx.fillText(`Passing is ${Math.round(op.passingPercent)}%`, theme.canvas.width / 2, sy);
          sy += 27;
        }
        if (op.progress) {
          ctx.font = theme.fonts.body;
          ctx.fillText(`${op.progress.label} · ${op.progress.completed} of ${op.progress.total}`, theme.canvas.width / 2, sy);
          sy += 31;
          const segments = Math.min(theme.result.progressSegments, op.progress.total);
          const filled = Math.ceil((op.progress.completed / op.progress.total) * segments);
          const segmentWidth = (contentWidth - (segments - 1) * theme.result.progressGap) / segments;
          let px = x;
          for (let index = 0; index < segments; index += 1) {
            ctx.lineWidth = 2;
            ctx.strokeRect(px, sy, segmentWidth, theme.result.progressHeight);
            if (index < filled) ctx.fillRect(px + 3, sy + 3, segmentWidth - 6, theme.result.progressHeight - 6);
            px += segmentWidth + theme.result.progressGap;
          }
        }
        ctx.textAlign = 'left';
        continue;
      }

      const boxHeight = op.heightPx;
      ctx.lineWidth = theme.action.borderWidth;
      ctx.strokeStyle = theme.colors.border;
      ctx.strokeRect(x, op.yPx, contentWidth, boxHeight);

      const codeX = op.lesson
        ? x + theme.action.padding
        : x + contentWidth - theme.action.padding - theme.action.codeAreaPx;
      const codeY = op.yPx + theme.action.padding;
      let labelX = op.lesson
        ? codeX + theme.action.codeAreaPx + theme.action.lessonTextGap
        : x + theme.action.padding;
      if (op.icon) {
        // eslint-disable-next-line no-await-in-loop
        const iconImage = await loadImage(op.icon);
        ctx.drawImage(
          iconImage,
          labelX,
          op.yPx + (boxHeight - theme.action.iconPx) / 2,
          theme.action.iconPx,
          theme.action.iconPx,
        );
        labelX += theme.action.iconPx + theme.action.iconGap;
      }

      let labelY = op.yPx + theme.action.padding;
      if (op.lesson) {
        ctx.font = theme.fonts.eyebrow;
        op.eyebrowLines.forEach((line, index) => ctx.fillText(
          line, labelX, labelY + index * theme.action.eyebrowLineHeight,
        ));
        labelY += op.eyebrowLines.length * theme.action.eyebrowLineHeight + 3;
        ctx.font = theme.fonts.code;
        op.taxonomyLines.forEach((line, index) => ctx.fillText(
          line, labelX, labelY + index * theme.text.codeLineHeight,
        ));
        labelY += op.taxonomyLines.length * theme.text.codeLineHeight + (op.taxonomyLines.length ? 3 : 0);
      }
      ctx.font = theme.fonts.label;
      op.labelLines.forEach((line, index) => ctx.fillText(line, labelX, labelY + index * theme.text.bodyLineHeight));
      labelY += op.labelLines.length * theme.text.bodyLineHeight + (op.descriptionLines.length ? 5 : 0);
      if (op.lesson) {
        ctx.font = theme.fonts.description;
        op.descriptionLines.forEach((line, index) => ctx.fillText(
          line, labelX, labelY + index * theme.action.descriptionLineHeight,
        ));
        labelY += op.descriptionLines.length * theme.action.descriptionLineHeight + (op.metaLines.length ? 5 : 0);
        ctx.font = theme.fonts.code;
        op.metaLines.forEach((line, index) => ctx.fillText(
          line, labelX, labelY + index * theme.text.codeLineHeight,
        ));
      }

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
