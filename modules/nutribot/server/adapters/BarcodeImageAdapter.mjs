/**
 * BarcodeImageAdapter
 * @module adapters/nutribot/BarcodeImageAdapter
 *
 * Generates barcode images as PNG buffers using bwip-js.
 */

import bwipjs from 'bwip-js';

export class BarcodeImageAdapter {
  #logger;

  constructor(deps = {}) {
    this.#logger = deps.logger || console;
  }

  /**
   * Generate a barcode PNG image buffer
   * @param {string} upc - UPC/EAN barcode string
   * @returns {Promise<Buffer>} PNG image buffer
   */
  async generate(upc) {
    const normalized = String(upc).replace(/\D/g, '');

    // Pick barcode type based on digit count
    const bcid = normalized.length === 13 ? 'ean13'
      : normalized.length === 12 ? 'upca'
      : normalized.length === 8 ? 'ean8'
      : 'code128';

    try {
      const png = await bwipjs.toBuffer({
        bcid,
        text: normalized,
        scale: 3,
        height: 10,
        includetext: true,
        textxalign: 'center',
      });
      return png;
    } catch (error) {
      this.#logger.warn?.('barcode.generate.failed', { upc: normalized, bcid, error: error.message });
      throw error;
    }
  }
}

export default BarcodeImageAdapter;
