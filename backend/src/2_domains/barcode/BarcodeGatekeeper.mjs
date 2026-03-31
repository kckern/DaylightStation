/**
 * BarcodeGatekeeper - Evaluates barcode scans against an ordered list of strategies.
 *
 * Each strategy is an async function: (scanContext) => { approved: boolean, reason?: string }
 * Strategies run in order. First denial wins. If all approve (or list is empty), scan is approved.
 *
 * @module domains/barcode/BarcodeGatekeeper
 */
export class BarcodeGatekeeper {
  #strategies;

  /**
   * @param {Array<Function>} strategies - Ordered list of async strategy functions
   */
  constructor(strategies = []) {
    this.#strategies = strategies;
  }

  /**
   * Evaluate a scan context against all strategies.
   * @param {Object} scanContext
   * @returns {Promise<{approved: boolean, reason?: string}>}
   */
  async evaluate(scanContext) {
    for (const strategy of this.#strategies) {
      const result = await strategy(scanContext);
      if (!result.approved) {
        return result;
      }
    }
    return { approved: true };
  }
}
