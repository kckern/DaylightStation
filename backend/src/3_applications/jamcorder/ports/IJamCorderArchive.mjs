/**
 * Port: how the harvest use case persists recordings + tracks what's been saved.
 * @module applications/jamcorder/ports/IJamCorderArchive
 */
export class IJamCorderArchive {
  /** @param {{listPath:string}} ref @returns {boolean} */
  has(_ref) { throw new Error('IJamCorderArchive.has must be implemented'); }
  /** @param {string} relPath @param {Buffer} buffer @returns {Promise<void>} */
  async save(_relPath, _buffer) { throw new Error('IJamCorderArchive.save must be implemented'); }
  /** @param {{listPath:string}} ref @param {string} relPath @returns {Promise<void>} */
  async markProcessed(_ref, _relPath) { throw new Error('IJamCorderArchive.markProcessed must be implemented'); }
}
export default IJamCorderArchive;
