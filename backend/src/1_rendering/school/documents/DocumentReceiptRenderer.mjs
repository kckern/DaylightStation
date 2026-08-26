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
import { activeProgressPosition } from '#domains/school/progressRows.mjs';

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

  /**
   * Offset (from a `textBaseline:'top'` draw-y) down to a text run's own
   * visual center — the midpoint of its actual measured ink, not the font's
   * nominal line-box center. Line-box centering is what made the TODAY sun
   * and the SCAN TO PRINT corner marks read as footnotes hanging below their
   * text on the printed copy: a font's 'top' reference sits well above where
   * capital letters actually start, so a glyph box-centered against it lands
   * too low. Re-measuring per call (rather than a hand-picked constant) keeps
   * this correct if the font or size ever changes.
   */
  function textOpticalCenter(ctx, font, text) {
    ctx.font = font;
    const { actualBoundingBoxAscent: ascent, actualBoundingBoxDescent: descent } = ctx.measureText(text || ' ');
    return (descent - ascent) / 2;
  }

  /**
   * Shared Subject›Course / Unit taxonomy presentation (agenda lesson card AND
   * the result-summary receipt). Fixed sizes that WRAP rather than the old
   * shrink-to-fit single line: 58mm tape has vertical room to spare and none
   * to spare sideways, so a long breadcrumb should grow to more lines, not
   * shrink to fit one (design feedback on the printed agenda).
   *
   * The gutter icon (when present) is sized and optically centered against
   * the TOP line's first line only — same fix as the TODAY sun, applied here
   * because box-centering it across both taxonomy rows is exactly what made
   * it read as belonging to neither ("Unit 0" line has no icon of its own;
   * see `drawTaxonomy`).
   */
  function taxonomyOp(ctx, taxonomy, maxWidth, {
    icon = null, includeLesson = true, includeUnit = true,
  } = {}) {
    if (!taxonomy) return null;
    const iconSize = icon ? theme.action.subjectIconPx : 0;
    const textOffset = icon ? iconSize + theme.action.iconGap : 0;
    const textWidth = maxWidth - textOffset;
    const top = `${taxonomy.subject}  ›  ${taxonomy.course}`;

    ctx.font = theme.fonts.taxonomyTop;
    const topLines = wrapTight(ctx, top, textWidth);
    const iconCenterOffset = icon
      ? textOpticalCenter(ctx, theme.fonts.taxonomyTop, topLines[0] ?? '') - iconSize / 2
      : 0;

    ctx.font = theme.fonts.taxonomyBottom;
    const unitLines = includeUnit
      ? wrapTight(ctx, taxonomy.unit, textWidth - theme.action.taxonomyBottomIndent)
      : [];
    const lessonLines = includeLesson && taxonomy.lesson
      ? wrapTight(ctx, `›  ${taxonomy.lesson}`, textWidth - theme.action.taxonomyLessonIndent)
      : [];
    const bottomRows = [
      ...unitLines.map((line) => ({ line, indent: theme.action.taxonomyBottomIndent })),
      ...lessonLines.map((line) => ({ line, indent: theme.action.taxonomyLessonIndent })),
    ];

    return {
      icon,
      iconSize,
      iconCenterOffset,
      textOffset,
      topLines,
      bottomRows,
      topLineHeight: theme.action.taxonomyTopLineHeight,
      bottomLineHeight: theme.action.taxonomyBottomLineHeight,
      heightPx: topLines.length * theme.action.taxonomyTopLineHeight
        + (bottomRows.length ? theme.action.taxonomyGap + bottomRows.length * theme.action.taxonomyBottomLineHeight : 0),
    };
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
    const iconSpan = icon && !lesson ? theme.action.iconPx + theme.action.iconGap : 0;
    // The lesson card's title gets its own (larger) font — see fonts.lessonTitle.
    const titleFont = lesson ? theme.fonts.lessonTitle : theme.fonts.label;
    const titleLineHeight = lesson ? theme.action.titleLineHeight : theme.text.bodyLineHeight;
    ctx.font = titleFont;
    const labelWidth = contentWidth - 2 * theme.action.padding - theme.action.codeAreaPx
      - (lesson ? theme.action.lessonTextGap : theme.action.labelGap) - iconSpan;
    // FULL CARD WIDTH, not the title column. The breadcrumb is the longest
    // string on the card, and giving it the narrow column beside the QR is what
    // made it wrap to two and three lines while the wide half of the card sat
    // empty. It is a header band across the top now, with the QR and the title
    // sharing the band beneath it.
    const fullWidth = contentWidth - 2 * theme.action.padding;
    const taxonomy = lesson && block.taxonomy
      ? taxonomyOp(ctx, block.taxonomy, fullWidth, {
        icon, includeLesson: false,
        // Subject > Course ONLY. The unit used to trail the breadcrumb as a
        // second, bolder line, which made the header band two lines deep and
        // filed the unit with the course path rather than with the lesson it
        // actually introduces. It is drawn above the title instead.
        includeUnit: !lesson,
      })
      : null;
    // taxonomyOp leaves ctx.font on whatever it last measured with — reset to
    // the title font before wrapping the title, so its line breaks are
    // computed against the font it is actually drawn in.
    ctx.font = theme.fonts.unitLabel;
    const unitIndent = theme.action.unitMarkerSize + theme.action.unitMarkerGap;
    const unitLines = lesson && typeof block.unit === 'string' && block.unit.trim()
      ? wrapTight(ctx, block.unit.trim(), labelWidth - unitIndent)
      : [];
    ctx.font = titleFont;
    const labelLines = wrapTight(ctx, block.label, labelWidth);
    ctx.font = theme.fonts.eyebrow;
    const eyebrow = lesson && block.eyebrow
      ? block.eyebrow.replace(/\s*·.*$/, '').toUpperCase()
      : null;
    const eyebrowLines = eyebrow ? wrapTight(ctx, eyebrow, labelWidth) : [];
    ctx.font = theme.fonts.description;
    const descriptionIndent = 12;
    const descriptionLines = lesson && block.description
      ? wrapTight(ctx, block.description, labelWidth - descriptionIndent)
      : [];
    ctx.font = theme.fonts.code;
    const metaParts = lesson && block.meta ? String(block.meta).split(' · ').filter(Boolean) : [];
    // THE FOOTER ROW HAS TO BE MEASURED, NOT ASSUMED.
    //
    // This used to be `metaParts.length ? ['footer'] : []` — a single
    // placeholder line whatever the content was — while the draw loop put
    // `metaParts[0]` left-aligned and the remainder RIGHT-aligned on that same
    // row with no width check at all. Two texts advancing toward each other
    // from opposite edges collide as soon as they are long enough, and the
    // remainder then runs on past the left edge of its own box. A real agenda
    // hit it immediately: "WATCH ON THE PORTAL" beside "34/366 · next: Rhythm
    // Improvisation with Chords" printed as overlapping mush spilling out of
    // the card.
    //
    // So: measure both halves, and when they cannot share a row, stack the
    // remainder underneath on as many wrapped rows as it needs. `metaRowCount`
    // is what the box height is grown by, which is what keeps the invariant
    // this file already claimed — the measured box never runs short of what
    // gets drawn into it.
    const META_ICON_SPAN = 25; // scan brackets (17) + gap (8); matches the draw
    const META_MIN_GAP = 12;   // smallest readable gutter between the two halves
    const metaLead = metaParts[0] ?? '';
    const metaRest = metaParts.slice(1).join(' · ');
    let metaLayout = null;
    if (metaParts.length) {
      if (!metaRest) {
        metaLayout = { mode: 'single', lead: metaLead, restLines: [] };
      } else {
        const leadWidth = META_ICON_SPAN + ctx.measureText(metaLead).width;
        const restWidth = ctx.measureText(metaRest).width;
        // Measured against the FULL card width: the footer is a full-width
        // band under the QR/title row, not part of the title column.
        metaLayout = leadWidth + META_MIN_GAP + restWidth <= fullWidth
          ? { mode: 'inline', lead: metaLead, restLines: [metaRest] }
          : { mode: 'stacked', lead: metaLead, restLines: wrapTight(ctx, metaRest, fullWidth) };
      }
    }
    const metaRowCount = metaLayout
      ? (metaLayout.mode === 'stacked' ? 1 + metaLayout.restLines.length : 1)
      : 0;
    const metaLines = metaParts.length ? new Array(metaRowCount).fill('footer') : [];
    ctx.font = theme.fonts.code;
    // The human-readable fallback code CHUNKS in fours past the scheme prefix
    // (design audit: 'sch:8V2QWGT4A / FXHHD4U' wrapped mid-token). A code a
    // person may have to type by hand deserves phone-number ergonomics.
    // WHAT GOES UNDER THE QR. A `panelCode` is the six-digit alias a child
    // types when they cannot scan; it belongs directly beneath the QR it
    // aliases, INSIDE this card, and nowhere else on the receipt. It used to
    // be emitted as loose text blocks AFTER the card, which put a bare number
    // and the sentence "Type it on the school screen." adrift below the box —
    // the exact placement this rule exists to forbid.
    //
    // Falls back to the raw scan token (chunked in fours for typing
    // ergonomics) when there is no panel code and the caller did not
    // `hideCode` — unchanged behaviour for every non-aliased action.
    // Marks a card as something other than ordinary today-work. The scheduler
    // deliberately keeps moving when a day is missed, so a lesson from a past
    // day can be offered today — correct behaviour that, unlabelled, is
    // indistinguishable on paper from today's own work. A child reading the
    // page cannot tell "you are backfilling Monday" from "this is today's".
    const rail = lesson && typeof block.rail === 'string' && block.rail.trim()
      ? block.rail.trim().toUpperCase()
      : null;
    // Course/unit progress, drawn as bars inside the card. Same row shape the
    // result receipt consumes, so the two surfaces cannot disagree about what
    // "how far along" looks like.
    const progressRows = lesson && Array.isArray(block.progress)
      ? block.progress.filter((row) => row && Number.isInteger(row.total) && row.total > 0)
      : [];
    const progressHeight = progressRows.length
      * (theme.action.progressLabelHeight + theme.action.progressBarHeight + theme.action.progressRowGap);
    const panelCode = typeof block.panelCode === 'string' && block.panelCode.trim()
      ? block.panelCode.trim()
      : null;
    const codeLines = panelCode
      ? [panelCode]
      : (block.hideCode ? [] : wrapTight(ctx, chunkCode(code), theme.action.codeAreaPx));
    // Row gaps mirror the draw loop's spacing exactly (rowGap between each
    // populated row-group) so the measured box height never runs short of
    // what actually gets drawn into it.
    const iconHeight = icon ? theme.action.iconPx : 0;
    // A panel code is a CELL hung off the QR box (shared border, no gap); a raw
    // token is loose lines under it. Different shapes, so different heights.
    const codeBlockHeight = theme.action.codeAreaPx + (panelCode
      ? theme.action.codeCellHeight
      : (codeLines.length ? theme.action.codeGap + codeLines.length * theme.text.codeLineHeight : 0));
    // A LESSON CARD IS STACKED BANDS, not one tall text column beside a QR:
    //
    //   [ breadcrumb — full width                    ]
    //   [ QR + code cell | title + description       ]
    //   [ progress bars — full width                 ]
    //   [ footer rule + action label                 ]
    //
    // Measuring band by band is what lets the breadcrumb have the whole width
    // without colliding with the title, and guarantees the QR column is never
    // clipped by the code cell hanging off it — the old model took a single
    // `max(text, icon, code)` and any band that grew past it printed through
    // the floor.
    const headerBand = (eyebrowLines.length
      ? eyebrowLines.length * theme.action.eyebrowLineHeight + theme.action.rowGap
      : 0)
      + (taxonomy ? taxonomy.heightPx + theme.action.rowGap : 0);
    const titleColumn = unitLines.length * theme.action.unitLineHeight
      + labelLines.length * titleLineHeight
      + (descriptionLines.length ? theme.action.rowGap : 0)
      + descriptionLines.length * theme.action.descriptionLineHeight;
    const mainBand = Math.max(codeBlockHeight, titleColumn);
    const progressBand = progressRows.length ? theme.action.rowGap + progressHeight : 0;
    // 14 is the footer rule and its breathing room, matching the draw.
    const footerBand = metaRowCount
      ? theme.action.rowGap + 14 + metaRowCount * theme.text.codeLineHeight
      : 0;

    return {
      kind: 'action',
      blockType: block.type,
      action: block.action,
      code,
      icon,
      lesson,
      eyebrowLines,
      labelLines,
      unitLines,
      unitIndent,
      descriptionLines,
      descriptionIndent,
      metaLines,
      metaParts,
      metaLayout,
      metaRowCount,
      rail,
      taxonomy,
      progressRows,
      headerBand,
      mainBand,
      progressBand,
      footerBand,
      codeLines,
      panelCode,
      heightPx: (lesson
        ? headerBand + mainBand + progressBand + footerBand
        : Math.max(labelLines.length * titleLineHeight, iconHeight, codeBlockHeight))
        + 2 * theme.action.padding
        + (rail ? theme.action.railHeight : 0),
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
          else ops.push({
            ...textOps(ctx, part.text, { font: theme.fonts.body, lineHeight: theme.text.bodyLineHeight }),
            compactReview: /^-\s+\d+:/.test(block.md),
            align: block.align ?? null,
          });
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
        const scoreMode = count > 10 ? 'aggregate' : 'items';
        const displayBoxCount = scoreMode === 'aggregate' ? theme.result.progressSegments : count;
        const boxSize = displayBoxCount
          ? Math.min(theme.result.boxSize, (contentWidth * 0.58 - Math.max(0, displayBoxCount - 1) * theme.result.boxGap) / displayBoxCount)
          : theme.result.boxSize;
        const boxesWidth = displayBoxCount * boxSize + Math.max(0, displayBoxCount - 1) * theme.result.boxGap;
        const summaryIcon = block.icon ? await iconPng(block.icon) : null;
        const taxonomy = taxonomyOp(ctx, block.taxonomy, contentWidth, { icon: summaryIcon });
        const progressRows = Array.isArray(block.progress) ? block.progress : (block.progress ? [block.progress] : []);
        const progressHeight = progressRows.length * 54;
        ctx.font = theme.fonts.code;
        // Wrapped against the PANEL's inner width, not the page's: these
        // rows now live inside the result panel's border.
        const reviewTextWidth = contentWidth - 2 * theme.result.reviewPadX - 40;
        const reviewRows = (block.reviewHints ?? []).map((hint) => {
          const match = /^(\d+):\s*(.+)$/.exec(hint);
          const number = match?.[1] ?? '';
          const text = match?.[2] ?? hint;
          return { number, lines: wrapTight(ctx, text, reviewTextWidth) };
        });
        // Height the review ADDS TO THE PANEL — the rule, the heading, the
        // rows, and the padding under the last one.
        const reviewInsetHeight = reviewRows.length
          ? theme.result.reviewGap + theme.result.reviewHeadingHeight
            + reviewRows.reduce((sum, row) => sum + row.lines.length * theme.result.reviewLineHeight
              + theme.result.reviewRowGap, 0)
            + theme.result.reviewPadBottom
          : 0;
        ops.push({
          kind: 'result-summary', ...block, taxonomy, progressRows, reviewRows, reviewInsetHeight,
          boxesWidth, boxSize, scoreMode, displayBoxCount,
          heightPx: theme.result.padY * 2
            + ((block.learnerName || block.date || block.time || block.studentNo) ? theme.result.identityHeight + 14 : 0)
            + (taxonomy?.heightPx ?? 0) + 16
            + (hasCounts ? theme.result.scorePanelHeight + reviewInsetHeight + 2 * theme.result.scorePanelGap : 42)
            + progressHeight,
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
      extraFonts: [
        // Same family, bold weight — this is what makes every `bold` in the
        // theme actually bold rather than silently resolving to the Regular.
        ...(theme.fonts.boldFontPath
          ? [{ file: theme.fonts.boldFontPath, family: theme.fonts.family, weight: 'bold' }]
          : []),
        ...(theme.fonts.codeFontPath
          ? [{ file: theme.fonts.codeFontPath, family: theme.fonts.codeFamily }]
          : []),
      ],
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
    ops.forEach((op, index) => {
      const opHeight = op.kind === 'math' ? op.totalHeightPx : op.heightPx;
      if (y - segmentStart > theme.layout.maxSegmentPx) {
        cutPoints.push(y);
        y += theme.layout.cutGap;
        segmentStart = y;
      }
      op.yPx = y;
      const next = ops[index + 1];
      const gap = op.compactReview && next?.compactReview ? 6 : theme.layout.blockGap;
      y += opHeight + gap;
    });
    const height = Math.ceil(y - theme.layout.blockGap + theme.layout.margin);
    cutPoints.push(height);

    const { canvas, ctx } = await initCanvas({ width: theme.canvas.width, height, ...fontConfig });
    ctx.fillStyle = theme.colors.background;
    ctx.fillRect(0, 0, theme.canvas.width, height);
    ctx.fillStyle = theme.colors.text;

    const { loadImage } = await import('canvas');
    const drawnMath = [];
    const x = theme.layout.margin;

    async function drawTaxonomy(taxonomy, tx, ty) {
      if (!taxonomy) return;
      const textX = tx + taxonomy.textOffset;
      ctx.textAlign = 'left';
      ctx.font = theme.fonts.taxonomyTop;
      taxonomy.topLines.forEach((line, index) => ctx.fillText(line, textX, ty + index * taxonomy.topLineHeight));
      if (taxonomy.icon) {
        // Centered on the TOP line's own ink (iconCenterOffset, computed in
        // taxonomyOp) — not box-centered across both taxonomy rows, which is
        // what made it read as a caption belonging to neither line.
        const image = await loadImage(taxonomy.icon);
        ctx.drawImage(image, tx, ty + taxonomy.iconCenterOffset, taxonomy.iconSize, taxonomy.iconSize);
      }
      const bottomY = ty + taxonomy.topLines.length * taxonomy.topLineHeight + theme.action.taxonomyGap;
      ctx.font = theme.fonts.taxonomyBottom;
      taxonomy.bottomRows.forEach((row, index) => ctx.fillText(
        row.line, textX + row.indent, bottomY + index * taxonomy.bottomLineHeight,
      ));
    }

    // Local geometric centers for the two hand-drawn glyphs below, in the
    // same (ix, iy)-relative coordinate space their path math uses. Both
    // shapes are built symmetric around these points (verified against their
    // own coordinate lists), so — unlike text — no per-call measurement is
    // needed to find their visual middle.
    const TODAY_ICON_CENTER_Y = 10; // sun: arc centered at local (9, 10)
    const SCAN_ICON_CENTER_Y = 8.5; // scan brackets: 17px square, corners at 0 and 17

    function drawActionIndicator(kind, ix, iy) {
      ctx.save();
      ctx.strokeStyle = theme.colors.text;
      ctx.fillStyle = theme.colors.text;
      ctx.lineWidth = 3;
      if (/next/i.test(kind)) {
        ctx.beginPath();
        ctx.moveTo(ix, iy + 3);
        ctx.lineTo(ix + 14, iy + 10);
        ctx.lineTo(ix, iy + 17);
        ctx.closePath();
        ctx.fill();
      } else if (/try/i.test(kind)) {
        ctx.beginPath();
        ctx.arc(ix + 9, iy + 10, 7, Math.PI * 0.35, Math.PI * 1.9);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ix + 15, iy + 2);
        ctx.lineTo(ix + 17, iy + 9);
        ctx.lineTo(ix + 10, iy + 7);
        ctx.closePath();
        ctx.fill();
      } else {
        // TODAY: a compact sun survives thermal rasterization better than a
        // tiny calendar, which reads as an accidental checkbox at this size.
        ctx.beginPath();
        ctx.arc(ix + 9, iy + 10, 5, 0, Math.PI * 2);
        ctx.stroke();
        [[9, 0, 9, 3], [9, 17, 9, 20], [0, 10, 3, 10], [15, 10, 18, 10],
          [2, 3, 4, 5], [14, 15, 16, 17], [14, 5, 16, 3], [2, 17, 4, 15]]
          .forEach(([x1, y1, x2, y2]) => {
            ctx.beginPath();
            ctx.moveTo(ix + x1, iy + y1);
            ctx.lineTo(ix + x2, iy + y2);
            ctx.stroke();
          });
      }
      ctx.restore();
    }

    function drawScanIndicator(ix, iy) {
      ctx.save();
      ctx.strokeStyle = theme.colors.text;
      ctx.lineWidth = 2;
      const s = 17;
      const arm = 5;
      [[0, 0, 1, 1], [s, 0, -1, 1], [0, s, 1, -1], [s, s, -1, -1]].forEach(([dx, dy, hx, vy]) => {
        ctx.beginPath();
        ctx.moveTo(ix + dx + hx * arm, iy + dy);
        ctx.lineTo(ix + dx, iy + dy);
        ctx.lineTo(ix + dx, iy + dy + vy * arm);
        ctx.stroke();
      });
      ctx.restore();
    }

    // Per-question CORRECT/INCORRECT marks on the result-summary score panel —
    // vector strokes, never a font glyph. Roboto Condensed has no U+2713
    // (checkmark), so drawing it with `fillText` renders tofu for every
    // CORRECT question; `×` (U+00D7) happened to render, which is why only
    // the check silently broke. Drawing BOTH as paths means a font swap can
    // never take either one down again. The fill inversion stays as it was:
    // wrong is the solid knockout box, correct is the plain outline.
    function drawCorrectMark(bx, by, size) {
      const inset = theme.result.markInset;
      ctx.save();
      ctx.strokeStyle = theme.colors.text;
      ctx.lineWidth = theme.result.markStrokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(bx + inset, by + size * 0.55);
      ctx.lineTo(bx + size * 0.42, by + size - inset);
      ctx.lineTo(bx + size - inset, by + inset);
      ctx.stroke();
      ctx.restore();
    }

    function drawIncorrectMark(bx, by, size) {
      const inset = theme.result.markInset;
      ctx.fillStyle = theme.colors.text;
      ctx.fillRect(bx, by, size, size);
      ctx.save();
      ctx.strokeStyle = theme.colors.headerText;
      ctx.lineWidth = theme.result.markStrokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(bx + inset, by + inset);
      ctx.lineTo(bx + size - inset, by + size - inset);
      ctx.moveTo(bx + size - inset, by + inset);
      ctx.lineTo(bx + inset, by + size - inset);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = theme.colors.text;
    }

    for (const op of ops) {
      if (op.kind === 'header') {
        ctx.fillStyle = theme.colors.text;
        ctx.fillRect(0, op.yPx, theme.canvas.width, op.heightPx);
        ctx.fillStyle = theme.colors.headerText;
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
        if (op.align === 'center') {
          ctx.textAlign = 'center';
          op.lines.forEach((line, index) => ctx.fillText(
            line, x + contentWidth / 2, op.yPx + index * op.lineHeight,
          ));
          ctx.textAlign = 'left';
        } else {
          op.lines.forEach((line, index) => ctx.fillText(line, x, op.yPx + index * op.lineHeight));
        }
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
        if (op.learnerName || op.date || op.time || op.studentNo) {
          const columns = [
            { label: 'NAME', value: op.learnerName ?? '—', width: contentWidth * 0.24 },
            { label: 'DATE', value: op.date ?? '—', width: contentWidth * 0.27 },
            { label: 'TIME', value: op.time ?? '—', width: contentWidth * 0.18 },
            { label: 'STUDENT NO.', value: op.studentNo ?? '—', width: contentWidth * 0.31 },
          ];
          ctx.lineWidth = 2;
          ctx.strokeRect(x, sy, contentWidth, theme.result.identityHeight);
          let cx = x;
          columns.forEach((column, index) => {
            if (index) {
              ctx.beginPath();
              ctx.moveTo(cx, sy);
              ctx.lineTo(cx, sy + theme.result.identityHeight);
              ctx.stroke();
            }
            ctx.textAlign = 'center';
            ctx.font = theme.fonts.identityLabel;
            ctx.fillText(column.label, cx + column.width / 2, sy + 10);
            ctx.font = theme.fonts.identityValue;
            ctx.fillText(column.value, cx + column.width / 2, sy + 38);
            cx += column.width;
          });
          sy += theme.result.identityHeight + 14;
        }
        await drawTaxonomy(op.taxonomy, x, sy);
        sy += (op.taxonomy?.heightPx ?? 0) + 16;
        ctx.textAlign = 'left';
        if (Number.isInteger(op.correctCount) && Number.isInteger(op.totalCount)) {
          const panelY = sy + theme.result.scorePanelGap;
          // The review rides INSIDE the panel, under the pass/fail line.
          // It used to print below the progress bars, which read as an
          // afterthought bolted onto the bottom of the receipt — but which
          // question was missed, and what to go read about it, IS the
          // substance of a result. It belongs with the verdict, above the
          // progress context, inside the same border.
          const scoreBandHeight = theme.result.scorePanelHeight;
          const panelHeight = scoreBandHeight + op.reviewInsetHeight;
          const panelPad = theme.result.scorePanelPad;
          ctx.lineWidth = 3;
          ctx.strokeRect(x, panelY, contentWidth, panelHeight);
          const scoreColumnWidth = contentWidth * 0.38;
          const marksX = x + scoreColumnWidth + panelPad;
          const marksWidth = contentWidth - scoreColumnWidth - 2 * panelPad;
          const markGap = op.displayBoxCount > 1 ? Math.min(theme.result.boxGap, 6) : 0;
          const markSize = Math.min(op.boxSize, (marksWidth - (op.displayBoxCount - 1) * markGap) / op.displayBoxCount);
          const startX = marksX + Math.max(0, (marksWidth - (op.displayBoxCount * markSize + (op.displayBoxCount - 1) * markGap)) / 2);
          const marksY = panelY + (scoreBandHeight - markSize) / 2;
          const filledBoxes = op.scoreMode === 'aggregate'
            ? Math.round((op.correctCount / op.totalCount) * op.displayBoxCount)
            : op.correctCount;
          for (let index = 0; index < op.displayBoxCount; index += 1) {
            const bx = startX + index * (markSize + markGap);
            if (op.scoreMode === 'items' && Number.isInteger(op.questionStart)) {
              ctx.font = theme.fonts.breadcrumb;
              ctx.textAlign = 'center';
              ctx.fillText(String(op.questionStart + index), bx + markSize / 2, marksY - 20);
            }
            ctx.lineWidth = theme.result.boxLineWidth;
            ctx.strokeRect(bx, marksY, markSize, markSize);
            if (op.scoreMode === 'aggregate') {
              if (index < filledBoxes) ctx.fillRect(bx + 4, marksY + 4, markSize - 8, markSize - 8);
            } else {
              // Per-question marks, from the SESSION'S OWN per-item result
              // when the caller threaded one (`op.marks`, one entry per
              // displayed box) — never a positional fill. A positional
              // `index < correctCount` fill claims "the LAST N questions were
              // wrong" regardless of which ones actually were, and these
              // boxes are NUMBERED (the line above), so that claim is read
              // and acted on. `op.marks` is only trusted when it covers every
              // displayed box; anything short of that falls back to the
              // positional count rather than mis-index a partial array.
              const hasMarks = Array.isArray(op.marks) && op.marks.length === op.displayBoxCount;
              const isCorrect = hasMarks ? op.marks[index] === true : index < op.correctCount;
              if (isCorrect) drawCorrectMark(bx, marksY, markSize);
              else drawIncorrectMark(bx, marksY, markSize);
            }
          }
          const scoreX = x + scoreColumnWidth / 2 + 2;
          const scoreTop = panelY + 15;
          const earnedPercent = typeof op.percent === 'number'
            ? Math.round(op.percent)
            : Math.round((op.correctCount / op.totalCount) * 100);
          ctx.textAlign = 'center';
          ctx.font = theme.fonts.summary;
          ctx.fillText(`${op.correctCount}/${op.totalCount} · ${earnedPercent}%`, scoreX, scoreTop);
          ctx.font = theme.fonts.label;
          const outcomeText = op.headline;
          const outcomeWidth = ctx.measureText(outcomeText).width;
          const outcomeIconX = scoreX - outcomeWidth / 2 - 25;
          const outcomeY = scoreTop + 43;
          const outcomeIconY = outcomeY + 6;
          ctx.lineWidth = 3;
          ctx.strokeRect(outcomeIconX, outcomeIconY, 18, 18);
          ctx.beginPath();
          if (/^pass/i.test(outcomeText)) {
            ctx.moveTo(outcomeIconX + 4, outcomeIconY + 10);
            ctx.lineTo(outcomeIconX + 8, outcomeIconY + 14);
            ctx.lineTo(outcomeIconX + 15, outcomeIconY + 5);
          } else {
            ctx.moveTo(outcomeIconX + 5, outcomeIconY + 5);
            ctx.lineTo(outcomeIconX + 13, outcomeIconY + 13);
            ctx.moveTo(outcomeIconX + 13, outcomeIconY + 5);
            ctx.lineTo(outcomeIconX + 5, outcomeIconY + 13);
          }
          ctx.stroke();
          ctx.font = theme.fonts.label;
          ctx.fillText(outcomeText, scoreX + 8, outcomeY - 1);
          if (typeof op.passingPercent === 'number') {
            ctx.font = theme.fonts.breadcrumb;
            ctx.fillText(`${Math.round(op.passingPercent)}% to pass`, scoreX, scoreTop + 82);
          }
          if (op.reviewRows.length) {
            // A hairline across the panel separates verdict from advice
            // without a second border competing with the panel's own.
            const ruleY = panelY + scoreBandHeight;
            ctx.save();
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + theme.result.reviewPadX, ruleY);
            ctx.lineTo(x + contentWidth - theme.result.reviewPadX, ruleY);
            ctx.stroke();
            ctx.restore();

            let ry = ruleY + theme.result.reviewGap;
            ctx.textAlign = 'left';
            ctx.font = theme.fonts.eyebrow;
            // The heading is the block's, because the same hint list means
            // two different things: on a fail it is the work to do before
            // retrying, on a pass it is a note about the one question that
            // got away. Defaulted so a caller predating `reviewHeading` is
            // unchanged.
            ctx.fillText(op.reviewHeading || 'REVIEW BEFORE YOU RETRY', x + theme.result.reviewPadX, ry);
            ry += theme.result.reviewHeadingHeight;
            op.reviewRows.forEach((row) => {
              ctx.font = theme.fonts.label;
              ctx.textAlign = 'right';
              ctx.fillText(row.number, x + theme.result.reviewPadX + 26, ry);
              ctx.font = theme.fonts.code;
              ctx.textAlign = 'left';
              row.lines.forEach((line, index) => ctx.fillText(
                line, x + theme.result.reviewPadX + 40, ry + index * theme.result.reviewLineHeight,
              ));
              ry += row.lines.length * theme.result.reviewLineHeight + theme.result.reviewRowGap;
            });
            ctx.textAlign = 'left';
          }
          sy = panelY + panelHeight + theme.result.scorePanelGap;
        } else if (typeof op.percent === 'number') {
          ctx.font = theme.fonts.label;
          ctx.fillText(`Score: ${Math.round(op.percent)}%`, theme.canvas.width / 2, sy);
          sy += 34;
        }
        for (const progress of op.progressRows) {
          ctx.textAlign = 'left';
          ctx.font = theme.fonts.eyebrow;
          const complete = progress.completed === progress.total;
          ctx.fillText(`${progress.label.toUpperCase()} ${complete ? 'COMPLETE' : 'PROGRESS'}`, x, sy);
          ctx.textAlign = 'right';
          ctx.font = theme.fonts.code;
          ctx.fillText(`${activeProgressPosition(progress)} of ${progress.total}`, x + contentWidth, sy);
          sy += 31;
          // ONE TICK PER LESSON. This used to be
          // `Math.min(progressSegments, total)` with `progressSegments: 10`,
          // which silently disagreed with the bar beside it: the FILL is
          // `completed / total`, so on a 13-lesson unit the track was divided
          // into 10 and the filled edge landed nowhere near a tick. A child
          // counting ticks to see how much is left was counting the wrong
          // thing, and "1 of 13" sat above ten marks. Course progress looked
          // correct only by luck — 7 units is under the old cap.
          //
          // With `segments === total` the filled edge lands EXACTLY on the
          // `completed`-th tick, by construction rather than coincidence.
          const segments = Math.max(1, progress.total);
          const trackY = sy + theme.result.progressHeight / 2;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(x, trackY);
          ctx.lineTo(x + contentWidth, trackY);
          ctx.stroke();
          const filledWidth = (progress.completed / progress.total) * contentWidth;
          if (filledWidth > 0) ctx.fillRect(x, sy, filledWidth, theme.result.progressHeight);
          // THE PRESENT TENSE. Solid means done and empty means untouched;
          // the unit a child is actually working through is neither, and
          // filing it with "never opened" is the state this hatch adds.
          // Vertical stripes rather than an outline: the empty track is
          // already an outline, so an outlined segment would read as future,
          // which is the exact confusion being fixed. A hatch reads as
          // "partly there" at a glance and survives 203 dpi, where a
          // proportional part-fill of one narrow segment would not.
          const inProgress = Number.isInteger(progress.inProgress) ? progress.inProgress : 0;
          if (inProgress > 0 && progress.completed + inProgress <= progress.total) {
            const hatchStart = x + filledWidth;
            const hatchEnd = x + ((progress.completed + inProgress) / progress.total) * contentWidth;
            ctx.save();
            ctx.lineWidth = theme.result.progressHatchWidth;
            for (let hx = hatchStart + theme.result.progressHatchPitch / 2; hx < hatchEnd; hx += theme.result.progressHatchPitch) {
              ctx.beginPath();
              ctx.moveTo(hx, sy);
              ctx.lineTo(hx, sy + theme.result.progressHeight);
              ctx.stroke();
            }
            ctx.restore();
          }
          // Below a legible gap the ticks stop being countable and read as a
          // hatch, so they are DROPPED rather than thinned to a wrong count —
          // a tick that does not mean one lesson is the bug this replaced.
          // The bar, its end caps and the "n of m" label still carry the
          // whole story.
          if (contentWidth / segments >= theme.result.progressMinTickGap) {
            for (let index = 0; index < segments; index += 1) {
              ctx.lineWidth = 2;
              const tickX = x + (index / segments) * contentWidth;
              ctx.beginPath();
              ctx.moveTo(tickX, sy - 2);
              ctx.lineTo(tickX, sy + theme.result.progressHeight + 2);
              ctx.stroke();
            }
          }
          ctx.beginPath();
          ctx.moveTo(x + contentWidth, sy - 2);
          ctx.lineTo(x + contentWidth, sy + theme.result.progressHeight + 2);
          ctx.stroke();
          sy += 23;
        }
        ctx.textAlign = 'left';
        continue;
      }

      // A railed card is a rail ON TOP OF a box, not a taller box: everything
      // below measures from `boxTop`, so the rail cannot push content through
      // the floor the way a bottom-pinned footer would.
      const railHeight = op.rail ? theme.action.railHeight : 0;
      const boxTop = op.yPx + railHeight;
      const boxHeight = op.heightPx - railHeight;
      if (op.rail) {
        ctx.save();
        ctx.fillStyle = theme.colors.text;
        // Flush with the box's OUTER edge, not its path. `strokeRect` straddles
        // the path it is given, so a `borderWidth: 3` box actually reaches half
        // a stroke beyond `x` on each side — a rail filled at exactly `x` sits
        // visibly inset from the border it is supposed to cap.
        const halfBorder = theme.action.borderWidth / 2;
        ctx.fillRect(x - halfBorder, op.yPx, contentWidth + 2 * halfBorder, railHeight);
        ctx.fillStyle = theme.colors.headerText;
        ctx.font = theme.fonts.rail;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(op.rail, x + theme.action.railPadX, op.yPx + railHeight / 2);
        ctx.restore();
      }
      ctx.lineWidth = theme.action.borderWidth;
      ctx.strokeStyle = theme.colors.border;
      ctx.strokeRect(x, boxTop, contentWidth, boxHeight);

      // Band cursor. Every lesson band advances this; nothing is positioned
      // from a running text baseline any more, which is what let the old layout
      // drift when one band grew.
      let bandY = boxTop + theme.action.padding;
      const innerX = x + theme.action.padding;
      const innerRight = x + contentWidth - theme.action.padding;

      if (op.lesson) {
        if (op.eyebrowLines.length) {
          const eyebrowText = op.eyebrowLines[0];
          const eyebrowCenterY = bandY + textOpticalCenter(ctx, theme.fonts.eyebrow, eyebrowText);
          drawActionIndicator(eyebrowText, innerX, eyebrowCenterY - TODAY_ICON_CENTER_Y);
          ctx.font = theme.fonts.eyebrow;
          op.eyebrowLines.forEach((line, index) => ctx.fillText(
            line, innerX + 24, bandY + index * theme.action.eyebrowLineHeight,
          ));
          bandY += op.eyebrowLines.length * theme.action.eyebrowLineHeight + theme.action.rowGap;
        }
        if (op.taxonomy) {
          // eslint-disable-next-line no-await-in-loop
          await drawTaxonomy(op.taxonomy, innerX, bandY);
          bandY += op.taxonomy.heightPx + theme.action.rowGap;
        }
      }

      const codeX = op.lesson ? innerX : innerRight - theme.action.codeAreaPx;
      const codeY = op.lesson ? bandY : boxTop + theme.action.padding;
      let labelX = op.lesson
        ? codeX + theme.action.codeAreaPx + theme.action.lessonTextGap
        : innerX;
      if (op.icon && !op.lesson) {
        // eslint-disable-next-line no-await-in-loop
        const iconImage = await loadImage(op.icon);
        ctx.drawImage(
          iconImage,
          labelX,
          boxTop + (boxHeight - theme.action.iconPx) / 2,
          theme.action.iconPx,
          theme.action.iconPx,
        );
        labelX += theme.action.iconPx + theme.action.iconGap;
      }
      let labelY = op.lesson ? bandY : boxTop + theme.action.padding;
      if (op.unitLines?.length) {
        // Marker on the first line only — it labels the run, and repeating it
        // per wrapped line would read as a bulleted list of units.
        ctx.fillStyle = theme.colors.text;
        const markerY = labelY + textOpticalCenter(ctx, theme.fonts.unitLabel, op.unitLines[0])
          - theme.action.unitMarkerSize / 2;
        ctx.fillRect(labelX, markerY, theme.action.unitMarkerSize, theme.action.unitMarkerSize);
        ctx.font = theme.fonts.unitLabel;
        op.unitLines.forEach((line, index) => ctx.fillText(
          line, labelX + op.unitIndent, labelY + index * theme.action.unitLineHeight,
        ));
        labelY += op.unitLines.length * theme.action.unitLineHeight;
      }
      const titleFont = op.lesson ? theme.fonts.lessonTitle : theme.fonts.label;
      const titleLineHeight = op.lesson ? theme.action.titleLineHeight : theme.text.bodyLineHeight;
      ctx.font = titleFont;
      op.labelLines.forEach((line, index) => ctx.fillText(line, labelX, labelY + index * titleLineHeight));
      labelY += op.labelLines.length * titleLineHeight + (op.descriptionLines.length ? theme.action.rowGap : 0);
      if (op.lesson) {
        ctx.font = theme.fonts.description;
        op.descriptionLines.forEach((line, index) => ctx.fillText(
          line, labelX + op.descriptionIndent, labelY + index * theme.action.descriptionLineHeight,
        ));
        // Past the whole QR/title band — the taller of the two columns, not
        // whichever one this code path happened to walk down.
        bandY += op.mainBand;

        if (op.progressRows.length) {
          bandY += theme.action.rowGap;
          for (const row of op.progressRows) {
            const complete = row.completed >= row.total;
            ctx.fillStyle = theme.colors.text;
            ctx.font = theme.fonts.eyebrow;
            ctx.textAlign = 'left';
            ctx.fillText(`${String(row.label).toUpperCase()}${complete ? ' COMPLETE' : ''}`, innerX, bandY);
            ctx.textAlign = 'right';
            ctx.font = theme.fonts.code;
            // POSITION, not a tally: "35 of 366" is where the child IS. The
            // agenda used to print `34/366` — how many are behind them, which
            // is not the thing they act on.
            ctx.fillText(`${activeProgressPosition(row)} of ${row.total}`, innerRight, bandY);
            ctx.textAlign = 'left';
            const barY = bandY + theme.action.progressLabelHeight;
            const barW = innerRight - innerX;
            ctx.lineWidth = 3;
            ctx.strokeRect(innerX, barY, barW, theme.action.progressBarHeight);
            const filled = Math.max(0, Math.min(1, row.completed / row.total)) * barW;
            if (filled > 0) ctx.fillRect(innerX, barY, filled, theme.action.progressBarHeight);
            // THE PRESENT TENSE. Solid is finished and empty is untouched; the
            // unit a child is actually inside is neither, and filing it with
            // "never opened" is what this hatch fixes. Vertical stripes, not an
            // outline — the empty track is already an outline.
            const active = Number.isInteger(row.inProgress) ? row.inProgress : 0;
            if (active > 0 && row.completed + active <= row.total) {
              const hatchEnd = innerX + ((row.completed + active) / row.total) * barW;
              ctx.save();
              ctx.lineWidth = theme.result.progressHatchWidth;
              for (let hx = innerX + filled + theme.result.progressHatchPitch / 2; hx < hatchEnd;
                hx += theme.result.progressHatchPitch) {
                ctx.beginPath();
                ctx.moveTo(hx, barY);
                ctx.lineTo(hx, barY + theme.action.progressBarHeight);
                ctx.stroke();
              }
              ctx.restore();
            }
            // Ticks only while they can still be told apart — see
            // `progressTickMax`. At 366 lessons each tick is a third of a pixel
            // and the bar prints as a smudge.
            if (row.total <= theme.action.progressTickMax) {
              ctx.lineWidth = 2;
              for (let i = 1; i < row.total; i += 1) {
                const tx = innerX + (i / row.total) * barW;
                ctx.beginPath();
                ctx.moveTo(tx, barY);
                ctx.lineTo(tx, barY + theme.action.progressBarHeight);
                ctx.stroke();
              }
            }
            bandY += theme.action.progressLabelHeight + theme.action.progressBarHeight
              + theme.action.progressRowGap;
          }
        }

        if (op.metaParts.length) {
          // Bottom-pinned, but pinned by the WHOLE footer group rather than by
          // one assumed row — a stacked footer that only reserved one row would
          // start below the box floor and print over whatever follows.
          const footerY = boxTop + boxHeight - theme.action.padding
            - op.metaRowCount * theme.text.codeLineHeight;
          ctx.beginPath();
          ctx.lineWidth = 2;
          ctx.moveTo(innerX, footerY - 7);
          ctx.lineTo(innerRight, footerY - 7);
          ctx.stroke();
          ctx.font = theme.fonts.code;
          ctx.textAlign = 'left';
          // SCAN TO PRINT's corner marks, optically centered the same way as
          // the TODAY sun — was a flat "+7" that sat the icon low enough to
          // look detached from its label (printed-copy feedback: "that icon
          // should be scooting up").
          const scanCenterY = footerY + textOpticalCenter(ctx, theme.fonts.code, op.metaParts[0]);
          const scanIconY = scanCenterY - SCAN_ICON_CENTER_Y;
          const layout = op.metaLayout;
          if (layout.mode === 'single') {
            const footerRight = innerRight;
            const groupWidth = 17 + 8 + ctx.measureText(layout.lead).width;
            const groupX = innerX + (footerRight - innerX - groupWidth) / 2;
            drawScanIndicator(groupX, scanIconY);
            ctx.fillText(layout.lead, groupX + 25, footerY);
          } else if (layout.mode === 'inline') {
            // Both halves measured as fitting — the original two-ends layout.
            drawScanIndicator(innerX, scanIconY);
            ctx.fillText(layout.lead, innerX + 25, footerY);
            ctx.textAlign = 'right';
            ctx.fillText(layout.restLines[0], innerRight, footerY);
          } else {
            // Too long to share a row. The action label keeps the icon row; the
            // progress text drops underneath, left-aligned to the same column
            // rather than right-aligned, so a wrapped second line does not read
            // as a separate ragged column.
            drawScanIndicator(innerX, scanIconY);
            ctx.fillText(layout.lead, innerX + 25, footerY);
            layout.restLines.forEach((line, index) => ctx.fillText(
              line, innerX, footerY + (index + 1) * theme.text.codeLineHeight,
            ));
          }
          ctx.textAlign = 'left';
        }
      }

      // Same stroke as the code cell hanging beneath it — these two share an
      // edge, and a 2px box above a 3px cell reads as a misprint.
      ctx.lineWidth = theme.action.borderWidth;
      ctx.strokeStyle = theme.colors.border;
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

      if (op.panelCode) {
        // The code is the QR's FALLBACK, so it is drawn as the QR's second
        // row: a cell hung directly off the box, sharing its bottom border, so
        // the pair reads as one stacked control. It used to float in open space
        // below the box, which on a multi-offer agenda made it a bare number
        // with no visible referent — a child could not tell which card's code
        // it was.
        const cellY = codeY + theme.action.codeAreaPx;
        ctx.lineWidth = theme.action.borderWidth;
        ctx.strokeStyle = theme.colors.border;
        ctx.strokeRect(codeX, cellY, theme.action.codeAreaPx, theme.action.codeCellHeight);
        ctx.fillStyle = theme.colors.text;
        ctx.font = theme.fonts.panelCode;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(op.panelCode, codeX + theme.action.codeAreaPx / 2, cellY + theme.action.codeCellHeight / 2);
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
      } else {
        // A chunked raw token is not a thing anyone types — it is there so a
        // grown-up can read the ticket off the tape. Small and left-aligned,
        // exactly as before.
        ctx.font = theme.fonts.code;
        ctx.textAlign = 'left';
        op.codeLines.forEach((line, index) => ctx.fillText(
          line, codeX, codeY + theme.action.codeAreaPx + theme.action.codeGap + index * theme.text.codeLineHeight,
        ));
      }
    }

    return { canvas, width: theme.canvas.width, height, cutPoints, codes, drawnMath };
  }

  return { createCanvas, rasterizeSvg };
}

export default { createDocumentReceiptRenderer };
