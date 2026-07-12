/**
 * IMidiConverter — port: render one MIDI file to a normalized MP3.
 * Layer: APPLICATION (3_applications/pianoaudio/ports).
 * @module applications/pianoaudio/ports/IMidiConverter
 */
export class IMidiConverter {
  /** @param {string} midiPath @param {string} mp3Path @returns {Promise<void>} */
  async convert(midiPath, mp3Path) { throw new Error('IMidiConverter.convert not implemented'); }
}

export default IMidiConverter;
