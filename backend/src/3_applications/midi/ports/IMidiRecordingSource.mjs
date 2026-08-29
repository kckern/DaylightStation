/**
 * Port: what the harvest use case needs from the networked MIDI recorder.
 * @module applications/midi/ports/IMidiRecordingSource
 */
export class IMidiRecordingSource {
  /** @returns {Promise<Array<{recordingId:string}>>} */
  async listRecordings() { throw new Error('IMidiRecordingSource.listRecordings must be implemented'); }
  /** @param {{recordingId:string}} recording @returns {Promise<unknown>} opaque MIDI artifact */
  async fetchRecording(_recording) { throw new Error('IMidiRecordingSource.fetchRecording must be implemented'); }
}
export default IMidiRecordingSource;
