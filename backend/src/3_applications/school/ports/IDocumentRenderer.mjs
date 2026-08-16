/**
 * IDocumentRenderer / IReceiptRenderer — the two rendering contracts the
 * lifecycle depends on.
 * @module applications/school/ports/IDocumentRenderer
 *
 * Rendering lives in `1_rendering/school/` and the application layer may not
 * import it (D1), so both targets arrive by constructor injection through these
 * interfaces. That is not only a layer rule: measurement, pagination and
 * typography change on a completely different schedule from "what a child is
 * allowed to do next", and a use case that could name a concrete renderer would
 * eventually start caring which fonts exist.
 *
 * TOKEN VALUES ARE PASSED IN, NEVER MINTED HERE (spec §2). `IssueDocument` mints
 * through `ITokenRegistry` and hands the opaque strings over in `opts.tokens`;
 * the renderer's only job is to draw them as a barcode/QR next to their label.
 */

/**
 * Letter-size PDF target.
 *
 * @typedef {{ pdf: Buffer, pageCount: number, formMap: object|null }} RenderedDocument
 */
export class IDocumentRenderer {
  /**
   * @param {object} document - a validated document (`validateDocument().document`)
   * @param {object} [opts]
   * @param {Record<string,string>} [opts.tokens] - `scan_action` action value → opaque token
   * @param {number} [opts.variant] - retry variant; drives the equivalent-problem seed
   * @param {string} [opts.artifactId] - stable id for the printed artifact
   * @param {string} [opts.learnerId]
   * @param {object} [opts.bank] - the question bank, when the document poses its items
   * @param {boolean} [opts.answerKey] - render the grown-up's copy instead
   * @returns {Promise<RenderedDocument>} `formMap` is non-null only for a document
   *   carrying `omr_response` blocks
   */
  async render(document, opts) {
    throw new Error('IDocumentRenderer.render must be implemented');
  }
}

/**
 * Thermal receipt target. Returns a print job in the shape
 * `ThermalPrinterAdapter.print()` accepts — `{ items, footer }` — because the
 * ESC/POS item list IS the receipt's rendered form for a text renderer; there
 * is no intermediate bitmap for the application layer to care about.
 *
 * A RASTER renderer (`1_rendering/school/documents/
 * DocumentReceiptRasterRenderer.mjs`) is the other legitimate shape: its
 * `items` is a single `{type:'image'}`, and the three optional fields below
 * exist because a bitmap cannot carry them itself — `transcript` is the
 * words a text renderer would have printed (an image has no decodable text
 * for the printer capture/log to read back), `codes` is what a text renderer
 * would have put in scannable `barcode`/`qrcode` items (a raster's QR is
 * pixels), and `cleanup` releases whatever scratch resource (a temp PNG file)
 * the renderer needed to produce the image item. `ReceiptPrinting` treats all
 * three as optional and calls `cleanup` after the print attempt regardless of
 * outcome; a text renderer that sets none of them is unaffected.
 *
 * @typedef {{ items: object[], footer?: object, transcript?: string,
 *   codes?: Array<{token: string, label: string}>, cleanup?: () => Promise<void>|void }} RenderedReceipt
 */
export class IReceiptRenderer {
  /**
   * @param {object} document - a validated `target: ['receipt']` document
   * @param {object} [opts]
   * @returns {Promise<RenderedReceipt>|RenderedReceipt}
   */
  render(document, opts) {
    throw new Error('IReceiptRenderer.render must be implemented');
  }
}

export default IDocumentRenderer;
