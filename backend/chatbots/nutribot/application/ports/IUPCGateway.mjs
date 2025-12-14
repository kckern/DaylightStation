/**
 * IUPCGateway Port
 * @module nutribot/application/ports/IUPCGateway
 * 
 * Port interface for UPC barcode lookups.
 */

/**
 * @typedef {Object} UPCProduct
 * @property {string} upc
 * @property {string} name
 * @property {string} [brand]
 * @property {string} [imageUrl]
 * @property {Object} nutrition - { calories, protein, carbs, fat, sodium, sugar, fiber }
 * @property {Object} serving - { size, unit }
 */

/**
 * UPC gateway interface
 * @interface IUPCGateway
 */
export class IUPCGateway {
  /**
   * Look up product by UPC code
   * @param {string} upc - UPC barcode
   * @returns {Promise<UPCProduct|null>}
   */
  async lookup(upc) {
    throw new Error('IUPCGateway.lookup must be implemented');
  }

  /**
   * Search products by name
   * @param {string} query - Search query
   * @returns {Promise<UPCProduct[]>}
   */
  async search(query) {
    throw new Error('IUPCGateway.search must be implemented');
  }
}

export default IUPCGateway;
