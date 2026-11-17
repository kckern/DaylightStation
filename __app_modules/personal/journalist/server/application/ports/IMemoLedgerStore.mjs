/**
 * IMemoLedgerStore Port
 * @module journalist/application/ports/IMemoLedgerStore
 *
 * Where a user's voice memo ledger is kept between requests and across
 * restarts: one document per user, read and written whole.
 */

export class IMemoLedgerStore {
  /**
   * @param {string} username
   * @returns {Object|null} The stored ledger, or null when there is none yet
   */
  read(_username) { throw new Error('IMemoLedgerStore.read not implemented'); }

  /**
   * @param {string} username
   * @param {Object} ledger
   * @returns {boolean} Whether the ledger was stored
   */
  write(_username, _ledger) { throw new Error('IMemoLedgerStore.write not implemented'); }
}

export default IMemoLedgerStore;
