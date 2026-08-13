/**
 * Receipt document → the ESC/POS job a thermal printer takes.
 *
 * This is the `IReceiptRenderer` the lifecycle needs: `render(document, opts)`
 * → `{ items, footer }`, the shape `ThermalPrinterAdapter.print()` accepts.
 *
 * WHY NOT THE CANVAS RENDERER. `DocumentReceiptRenderer` draws a receipt as a
 * PNG, and the composition root used to send that as a single `{type:'image'}`
 * item. Two things were wrong with it, and only one of them was cosmetic:
 *
 *  - **The PNG has no barcode in it.** The canvas draws an empty square where
 *    the code belongs and prints the token underneath as small text. A child
 *    handed that receipt has nothing to scan — the entire action loop runs on
 *    barcodes. Emitting a `barcode` item instead makes the printer generate a
 *    real, scannable Code128 in its own firmware.
 *  - **An image has no text.** `VirtualThermalPrinterAdapter` transcribes text
 *    and barcode items and records images by dimension only, so every receipt
 *    transcript — the thing the e2e suite is documented to assert on — was
 *    empty, and so was the operator's log of what a child was told.
 *
 * The canvas renderer keeps its job (it is what proves a document can be drawn
 * on 58mm tape at all, and the e2e suite still probes with it). It is simply
 * not what reaches paper for the three receipts this console actually prints,
 * none of which contain math.
 *
 * A `scan_action` prints its LABEL and then its code, in that order: a page of
 * unlabelled stripes is not something a child can act on.
 *
 * @module rendering/school/documents/DocumentEscPosRenderer
 */

/** Blocks that can go on tape. Anything else is refused BY NAME, never dropped. */
const SUPPORTED = new Set(['rich_text', 'scan_action', 'media_action', 'result_summary']);

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
          items.push({
            type: 'text', align: 'center',
            content: Array.from({ length: block.totalCount }, (_, index) => (index < block.correctCount ? '[✓]' : '[×]')).join(' '),
          });
          items.push({ type: 'text', content: `${block.correctCount} of ${block.totalCount} correct`, align: 'center', style: { bold: true } });
        } else if (typeof block.percent === 'number') {
          items.push({ type: 'text', content: `Score: ${Math.round(block.percent)}%`, align: 'center', style: { bold: true } });
        }
        if (typeof block.passingPercent === 'number') {
          items.push({ type: 'text', content: `Passing is ${Math.round(block.passingPercent)}%`, align: 'center' });
        }
        if (block.progress) {
          items.push({
            type: 'text', align: 'center',
            content: `${block.progress.label} · ${block.progress.completed} of ${block.progress.total}`,
          });
        }
        continue;
      }

      const code = tokens?.[block.action] ?? block.action;
      if (block.presentation === 'lesson') {
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
    }
    items.push({ type: 'line', content: '-', width });
    return { items, footer: { paddingLines: 3, autoCut: true } };
  }

  return { render };
}

export default { createDocumentEscPosRenderer };
