/**
 * Port: how the harvest use case persists recordings + tracks what's been saved.
 * @module applications/midi/ports/IMidiRecordingArchive
 */
export class IMidiRecordingArchive {
  /** @param {{listPath:string}} ref @returns {boolean} */
  has(_ref) { throw new Error('IMidiRecordingArchive.has must be implemented'); }
  /** @param {string} relPath @param {Buffer} buffer @returns {Promise<void>} */
  async save(_relPath, _buffer) { throw new Error('IMidiRecordingArchive.save must be implemented'); }
  /** @param {{listPath:string}} ref @param {string} relPath @returns {Promise<void>} */
  async markProcessed(_ref, _relPath) { throw new Error('IMidiRecordingArchive.markProcessed must be implemented'); }
}
export default IMidiRecordingArchive;
