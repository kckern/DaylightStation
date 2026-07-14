/**
 * IMidiLibrary — port: enumerate MIDI files still needing an MP3.
 * Layer: APPLICATION (3_applications/pianoaudio/ports).
 * @module applications/pianoaudio/ports/IMidiLibrary
 */
export class IMidiLibrary {
  /** @returns {Promise<Array<{midiPath:string, outputPath:string}>>} absolute paths, missing-output only, newest-first */
  async listPending() { throw new Error('IMidiLibrary.listPending not implemented'); }
}

export default IMidiLibrary;
