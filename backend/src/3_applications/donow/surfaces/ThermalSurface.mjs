/**
 * ThermalSurface — the DoNow adapter for the school console's thermal
 * receipt printer (spec §5, surface id `thermal`).
 *
 * Dispatch delegates straight to the existing `ReceiptPrinting.print`
 * use case (`backend/src/3_applications/school/ReceiptPrinting.mjs`) — this
 * adapter adds no printing logic of its own; it only translates the DoNow
 * `{action, learnerId}` call shape into that use case's `(document)` call.
 *
 * Occupancy is always `idle`: a thermal printer is a queue, not a stage —
 * there is no notion of "someone is using it right now" that would ever
 * make dispatching a second receipt wrong.
 */
export class ThermalSurface {
  #receipts;

  /**
   * @param {Object} config
   * @param {{print: Function}} [config.receipts] - ReceiptPrinting-shaped; optional
   */
  constructor({ receipts = null } = {}) {
    this.#receipts = receipts;
  }

  get id() { return 'thermal'; }

  /** @param {{document: object}} raw */
  validateAction(raw) {
    if (!raw || typeof raw !== 'object') return ['action must be an object'];
    if (!raw.document || typeof raw.document !== 'object') return ['action.document is required'];
    return [];
  }

  /** @returns {Promise<{state: 'idle', occupantId: null}>} */
  async occupancy() {
    return { state: 'idle', occupantId: null };
  }

  /** @returns {Promise<{dispatched: boolean, detail?: *}>} */
  async dispatch({ action }) {
    if (!this.#receipts) return { dispatched: false };
    const result = await this.#receipts.print(action.document);
    return { dispatched: Boolean(result?.printed), detail: result };
  }

  // Article-free, lowercase noun phrase — `DoNowService`'s own templates own
  // the leading article (spec review finding: a self-capitalized label
  // doubled up to "The A receipt on the printer is busy right now.").
  label() { return 'receipt on the printer'; }
}

export default ThermalSurface;
