/**
 * Port: how the harvest use case persists recordings + tracks what's been saved.
 * @module applications/midi/ports/IMidiRecordingArchive
 */
export class IMidiRecordingArchive {
  /** @param {string} recordingId @returns {boolean} */
  hasRecording(_recordingId) { throw new Error('IMidiRecordingArchive.hasRecording must be implemented'); }
  /** @param {{recordingId:string}} recording @param {unknown} artifact @returns {Promise<{archiveId:string}>} */
  async archiveRecording(_recording, _artifact) { throw new Error('IMidiRecordingArchive.archiveRecording must be implemented'); }
}
export default IMidiRecordingArchive;
