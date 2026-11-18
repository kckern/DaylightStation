/**
 * IQuickInputLedgerStore Port
 * @module quick-input/application/ports/IQuickInputLedgerStore
 *
 * Where one bot's quick-input ledger for a user is kept between requests and
 * across restarts: one document per user, read and written whole.
 */

export class IQuickInputLedgerStore {
  /**
   * @param {string} username
   * @returns {Object|null} The stored ledger, or null when there is none yet
   */
  read(_username) { throw new Error('IQuickInputLedgerStore.read not implemented'); }

  /**
   * @param {string} username
   * @param {Object} ledger
   * @returns {boolean} Whether the ledger was stored
   */
  write(_username, _ledger) { throw new Error('IQuickInputLedgerStore.write not implemented'); }
}

export default IQuickInputLedgerStore;
