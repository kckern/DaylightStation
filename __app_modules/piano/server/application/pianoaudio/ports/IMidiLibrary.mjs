/**
 * IMidiLibrary — port: enumerate MIDI files still needing an MP3.
 * Layer: APPLICATION (3_applications/pianoaudio/ports).
 * @module applications/pianoaudio/ports/IMidiLibrary
 */
export class IMidiLibrary {
  /** @returns {Promise<Array<{recordingId:string}>>} missing-output only, newest-first */
  async listPendingRecordings() { throw new Error('IMidiLibrary.listPendingRecordings not implemented'); }
}

export default IMidiLibrary;
