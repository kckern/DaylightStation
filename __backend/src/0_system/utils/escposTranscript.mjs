/**
 * Decode an ESC/POS `PrintItem[]` list into the plain text a human would read
 * off the paper.
 *
 * ONE function, shared by two callers that each need the same answer for a
 * different reason:
 *
 *  - `VirtualThermalPrinterAdapter` derives a capture's `.txt` transcript from
 *    the items it actually put on the wire — the double-only audit trail
 *    tests assert on.
 *  - `1_adapters/school/documents/DocumentReceiptRasterAdapter.mjs` derives
 *    the SAME transcript for a raster job, whose only wire item is a single
 *    `{type:'image'}` that (by ESC/POS's own nature — a bitmap, not glyphs)
 *    carries no decodable text of its own. It gets there by handing an
 *    ESC/POS-shaped item list — the one `DocumentEscPosRenderer` would have
 *    printed for the same document — through this function instead of onto
 *    the wire, so the operator's record of what a child was told survives a
 *    receipt that no longer contains a single printable text item.
 *
 * Duplicating this instead of sharing it was how the transcript would have
 * quietly drifted between "what the capture says happened" and "what the
 * raster renderer claims happened" the first time either one changed the
 * item shapes it walks.
 *
 * @module system/utils/escposTranscript
 */

/**
 * @param {Array<{type: string, content?: string, width?: number, lines?: number}>} items
 * @returns {string}
 */
export function transcribeEscPosItems(items) {
  const lines = [];
  for (const item of items ?? []) {
    switch (item.type) {
      case 'text':
        if (item.content !== undefined && item.content !== null) lines.push(String(item.content));
        break;
      case 'barcode':
      case 'qrcode':
        if (item.content) lines.push(String(item.content));
        break;
      case 'line':
        lines.push(String(item.content || '-').repeat(item.width || 48));
        break;
      case 'space':
        for (let i = 0; i < (item.lines || 1); i += 1) lines.push('');
        break;
      default:
        // image / cut / feedButton / unknown — nothing printable.
        break;
    }
  }
  return lines.join('\n');
}

export default { transcribeEscPosItems };
