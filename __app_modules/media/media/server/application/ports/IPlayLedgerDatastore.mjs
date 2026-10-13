/**
 * IPlayLedgerDatastore — append-only household play ledger (one row per
 * playback start per screen; see #domains/media/playLedger.mjs).
 */
export class IPlayLedgerDatastore {
  /** @param {Object} row @returns {Promise<void>} */
  async append(row) {
    throw new Error('IPlayLedgerDatastore.append must be implemented');
  }

  /**
   * Rows in local-day order, oldest first.
   * @param {{fromDay?:string, toDay?:string}} [range] - local `YYYY-MM-DD`, inclusive
   * @returns {Promise<Object[]>}
   */
  async list(range) {
    throw new Error('IPlayLedgerDatastore.list must be implemented');
  }
}

export default IPlayLedgerDatastore;
