/**
 * Port: what the harvest use case needs from the networked MIDI recorder.
 * @module applications/midi/ports/IMidiRecordingSource
 */
export class IMidiRecordingSource {
  /** @returns {Promise<Array<{listPath:string, downloadPath:string}>>} */
  async listRecordings() { throw new Error('IMidiRecordingSource.listRecordings must be implemented'); }
  /** @param {{listPath:string, downloadPath:string}} ref @returns {Promise<Buffer>} */
  async download(_ref) { throw new Error('IMidiRecordingSource.download must be implemented'); }
}
export default IMidiRecordingSource;
