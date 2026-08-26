/**
 * Receipt document → the ESC/POS TEXT job a thermal printer takes.
 *
 * This is one of two `IReceiptRenderer`s the lifecycle builds: `render(document,
 * opts)` → `{ items, footer }`, the shape `ThermalPrinterAdapter.print()`
 * accepts. The other is the raster path (`DocumentReceiptRasterRenderer.mjs`,
 * wrapping this module's sibling `DocumentReceiptRenderer.mjs`), which is what
 * actually reaches paper for the three receipts this console prints today
 * (spec §6.2) — see `5_composition/modules/schoolLifecycle.mjs` for why, and
 * for the stale "the canvas draws an empty square" reasoning this module used
 * to be built to route around (`scanCodes:'qr'` has drawn a real, scannable QR
 * for a while now; that was never the objection that survived).
 *
 * THIS RENDERER'S JOB DIDN'T GO AWAY. It does two things for the raster path
 * that a bitmap cannot do for itself:
 *
 *  - **Operator transcript.** ESC/POS has no channel for embedding decodable
 *    text inside a raster image, so `DocumentReceiptRasterRenderer` runs this
 *    renderer on the side (never printed) and reads its `items` back as plain
 *    words via `transcribeEscPosItems` — the same transcript
 *    `VirtualThermalPrinterAdapter`'s capture and the e2e suite have always
 *    asserted on, and the same operator record of what a child was told the
 *    real printer's log line now carries too.
 *  - **Fallback receipt.** If rasterizing throws — font registration, canvas
 *    allocation, the `qrcode` encoder, a scratch-disk write — this renderer IS
 *    the fallback: a text receipt with a real Code128/QR item beats a child
 *    standing at a printer with nothing, which is the one failure this whole
 *    subsystem exists to prevent (spec §6.2, "a scan never succeeds silently").
 *
 * A `scan_action` prints its LABEL and then its code, in that order: a page of
 * unlabelled stripes is not something a child can act on.
 *
 * @module rendering/school/documents/DocumentEscPosRenderer
 */

import { activeProgressPosition } from '#domains/school/progressRows.mjs';

/** Blocks that can go on tape. Anything else is refused BY NAME, never dropped. */
const SUPPORTED = new Set(['rich_text', 'scan_action', 'media_action', 'result_summary', 'done_summary']);

export class ReceiptBlockError extends Error {
  constructor(message, blockType) {
    super(message);
    this.name = 'ReceiptBlockError';
    this.blockType = blockType;
  }
}

/**
 * @param {object} [options]
 * @param {number} [options.width=32] - characters across, for rule lines
 * @param {string} [options.symbology='CODE128']
 * @returns {{render: (document: object, opts?: object) => {items: Array, footer: object}}}
 */
export function createDocumentEscPosRenderer({ width = 32, symbology = 'CODE128' } = {}) {
  /**
   * @param {object} document - a validated `target: ['receipt']` document
   * @param {object} [opts]
   * @param {Object<string,string>} [opts.tokens] - action value → minted token.
   *   Receipt documents built by `domains/school/documents/receipts.mjs` already
   *   carry the opaque token in `action`, so this is the curriculum-document
   *   case (an action naming a token class) and is optional.
   */
  function render(document, { tokens = null } = {}) {
    const items = [];
    if (typeof document?.title === 'string' && document.title.trim()) {
      // The standard header (same treatment as the canvas renderer's black
      // band): the title inverted — white on black, double size, centred. The
      // padding spaces widen the band past the glyphs; a full-width band would
      // need raster mode, which this text path deliberately is not.
      items.push({
        type: 'text',
        content: ` ${document.title.trim().toUpperCase()} `,
        align: 'center',
        style: { bold: true, invert: true },
        size: { width: 2, height: 2 },
      });
      items.push({ type: 'space', lines: 1 });
    }
    for (const block of document?.blocks ?? []) {
      if (!SUPPORTED.has(block?.type)) {
        // A block that silently vanished would be a receipt that silently lost
        // the child's next move.
        throw new ReceiptBlockError(
          `block type '${block?.type}' has no receipt rendering`, block?.type,
        );
      }

      if (block.type === 'rich_text') {
        for (const raw of String(block.md ?? '').split('\n')) {
          const line = raw.trim();
          if (!line) { items.push({ type: 'space', lines: 1 }); continue; }
          // `## ` (a subject section header, spec §6.3 v2) prints BOLD, LEFT,
          // NORMAL size — distinct from a bare `#` (the learner-name banner),
          // which keeps the original centred/double-size treatment. Checked
          // before the generic heading branch so `## ` never falls into it.
          if (line.startsWith('## ')) {
            items.push({
              type: 'text',
              content: line.replace(/^##\s*/, ''),
              align: 'left',
              style: { bold: true },
            });
            continue;
          }
          const heading = line.startsWith('#');
          items.push({
            type: 'text',
            content: heading ? line.replace(/^#+\s*/, '') : line,
            align: heading ? 'center' : 'left',
            ...(heading ? { style: { bold: true }, size: { width: 2, height: 2 } } : {}),
          });
        }
        continue;
      }

      if (block.type === 'done_summary') {
        // The canvas receipt draws a checked strip; here the same truth is
        // words, for the same reason the result summary's marks are words —
        // a ✓ is whatever codepage the printer happens to be in, and tofu
        // where a tick should be is worse than no tick at all.
        items.push({ type: 'space', lines: 1 });
        items.push({ type: 'text', content: block.label, align: 'left', style: { bold: true } });
        for (const entry of block.entries) {
          const percent = Number.isFinite(entry.percent) ? ` — ${Math.round(entry.percent)}%` : '';
          items.push({
            type: 'text', align: 'left', style: { bold: true },
            content: `${String(entry.subject).toUpperCase()}${percent}`,
          });
          // The lesson itself, indented under its subject. The canvas receipt
          // hangs these off a subject icon; here the indent is the outline.
          for (const title of entry.titles ?? []) {
            items.push({ type: 'text', align: 'left', content: `  ${title}` });
          }
        }
        continue;
      }

      if (block.type === 'result_summary') {
        if (block.learnerName || block.date || block.studentNo) {
          items.push({
            type: 'text', align: 'center',
            content: [block.learnerName && `Name: ${block.learnerName}`, block.date && `Date: ${block.date}`, block.studentNo && `Student No. ${block.studentNo}`].filter(Boolean).join(' · '),
          });
        }
        if (block.taxonomy) {
          items.push({ type: 'text', content: `Subject · ${block.taxonomy.subject}`, align: 'center' });
          items.push({ type: 'text', content: `Course · ${block.taxonomy.course}`, align: 'center' });
          items.push({ type: 'text', content: `Unit · ${block.taxonomy.unit}`, align: 'center' });
        }
        items.push({ type: 'text', content: block.headline, align: 'center', style: { bold: true }, size: { width: 2, height: 2 } });
        items.push({ type: 'text', content: block.taxonomy ? `Lesson · ${block.title}` : block.title, align: 'center' });
        if (Number.isInteger(block.correctCount) && Number.isInteger(block.totalCount)) {
          items.push({ type: 'text', content: `${block.correctCount} of ${block.totalCount} correct`, align: 'center', style: { bold: true } });
          // WHICH questions were missed — named, not implied by position.
          // This used to print one box per question, filled left-to-right
          // from `correctCount` alone, which says "the first N are right":
          // a positional LIE the moment question 1 is the miss, sending a
          // child to re-check a question they got right. `block.marks` is
          // the session's own per-item verdict (one entry per box, the same
          // contract `DocumentReceiptRenderer.mjs` reads) and is the only
          // thing that can name a miss; it is trusted only when it covers
          // every box. Without it this line is simply omitted — the count
          // above already says how many, and silence beats a made-up list.
          //
          // A row of boxes is the CANVAS receipt's job (it has numbers above
          // each box and room to draw them). Here the same truth is carried
          // as words, because a box row in plain text has to answer "does a
          // marked box mean right or wrong?" with no legend, and because
          // ✓/× depend on whichever codepage the thermal printer happens to
          // be in — the same class of failure that put tofu in the canvas
          // receipt's score boxes. Question numbers use the sheet's own
          // numbering when the caller threaded a `questionStart`.
          if (Array.isArray(block.marks) && block.marks.length === block.totalCount) {
            const first = Number.isInteger(block.questionStart) ? block.questionStart : 1;
            const missed = block.marks
              .map((mark, index) => (mark === true ? null : first + index))
              .filter((number) => number !== null);
            if (missed.length) {
              items.push({
                type: 'text', align: 'center',
                content: `Check again: ${missed.join(', ')}`,
              });
            }
          }
        } else if (typeof block.percent === 'number') {
          items.push({ type: 'text', content: `Score: ${Math.round(block.percent)}%`, align: 'center', style: { bold: true } });
        }
        if (typeof block.passingPercent === 'number') {
          items.push({ type: 'text', content: `Passing is ${Math.round(block.passingPercent)}%`, align: 'center' });
        }
        // `block.progress` is an ARRAY of rows (`CloseSessionOutcome#learningProgress`
        // returns `[{label, completed, total}, ...]`, e.g. one row for the
        // course and one for the unit) — never a bare object. The old
        // `if (block.progress)` guard tested object/array TRUTHINESS, which
        // an array always is, then read `.label`/`.completed`/`.total`
        // straight off the array itself rather than an element of it —
        // always `undefined`, printing the literal "undefined · undefined of
        // undefined" onto Learner-Three's receipt. A single-object shape is still
        // accepted defensively (matching `DocumentReceiptRenderer.mjs`'s own
        // array/object normalisation), and a row missing any of its three
        // fields prints NOTHING rather than a garbled line — a guard on the
        // actual fields used, not on truthiness.
        (Array.isArray(block.progress) ? block.progress : (block.progress ? [block.progress] : []))
          .forEach((row) => {
            if (!row || typeof row.label !== 'string' || !row.label.trim()
                || !Number.isFinite(row.completed) || !Number.isFinite(row.total)) return;
            items.push({
              type: 'text', align: 'center',
              content: `${row.label} · ${activeProgressPosition(row)} of ${row.total}`,
            });
          });
        continue;
      }

      const code = tokens?.[block.action] ?? block.action;
      if (block.presentation === 'bulk_print') {
        items.push({ type: 'space', lines: 1 });
        items.push({ type: 'text', content: '─'.repeat(width), align: 'center' });
        items.push({ type: 'text', content: 'PRINT ALL SHEETS', align: 'left', style: { bold: true } });
        for (const subj of (block.subjects ?? [])) {
          items.push({ type: 'text', content: `• ${subj}`, align: 'left' });
        }
      } else if (block.presentation === 'lesson') {
        if (block.eyebrow) items.push({ type: 'text', content: block.eyebrow.toUpperCase(), align: 'left', style: { bold: true } });
        if (block.taxonomy) {
          items.push({ type: 'text', content: `Course · ${block.taxonomy.course}`, align: 'left' });
          items.push({ type: 'text', content: `Unit · ${block.taxonomy.unit}`, align: 'left' });
        }
        items.push({ type: 'text', content: block.taxonomy ? `Lesson · ${block.label}` : block.label, align: 'left', style: { bold: true } });
        if (block.description) items.push({ type: 'text', content: block.description, align: 'left' });
        if (block.meta) items.push({ type: 'text', content: block.meta, align: 'left' });
      } else items.push({ type: 'text', content: block.label, align: 'left' });
      // QR (symbology:'QR') is a distinct item type from a linear barcode: the
      // adapter needs a different ESC/POS command family (GS ( k model-2 QR)
      // to draw one, and printing no label of its own either — the text item
      // just above IS the label, same convention as a barcode.
      items.push(symbology === 'QR'
        ? { type: 'qrcode', content: code, label: block.label }
        : { type: 'barcode', content: code, label: block.label, format: symbology });
      // The six-digit panel alias, immediately after the code it aliases and
      // nowhere else. It moved from loose `rich_text` blocks (which the canvas
      // renderer drew adrift BELOW the card) onto the block itself, so this
      // renderer has to read the field or the operator transcript silently
      // loses the only typable way in.
      if (typeof block.panelCode === 'string' && block.panelCode.trim()) {
        items.push({ type: 'text', content: `PANEL CODE ${block.panelCode.trim()}`, align: 'center' });
      }
    }
    items.push({ type: 'line', content: '-', width });
    return { items, footer: { paddingLines: 3, autoCut: true } };
  }

  return { render };
}

export default { createDocumentEscPosRenderer };
