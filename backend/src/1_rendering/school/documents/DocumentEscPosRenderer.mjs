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
const SUPPORTED = new Set(['rich_text', 'scan_action', 'media_action']);

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

      const code = tokens?.[block.action] ?? block.action;
      items.push({ type: 'text', content: block.label, align: 'left' });
      items.push({ type: 'barcode', content: code, label: block.label, format: symbology });
    }
    items.push({ type: 'line', content: '-', width });
    return { items, footer: { paddingLines: 3, autoCut: true } };
  }

  return { render };
}

export default { createDocumentEscPosRenderer };
