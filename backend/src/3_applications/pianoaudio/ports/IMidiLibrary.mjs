/**
 * IMidiLibrary — port: enumerate MIDI files still needing an MP3.
 * Layer: APPLICATION (3_applications/pianoaudio/ports).
 * @module applications/pianoaudio/ports/IMidiLibrary
 */
export class IMidiLibrary {
  /** @returns {Promise<Array<{midiPath:string, mp3Path:string}>>} absolute paths, missing-mp3 only, newest-first */
  async listPending() { throw new Error('IMidiLibrary.listPending not implemented'); }
}

export default IMidiLibrary;
