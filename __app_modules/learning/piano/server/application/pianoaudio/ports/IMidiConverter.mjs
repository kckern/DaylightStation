/**
 * IMidiConverter — port: render one MIDI file to a normalized MP3.
 * Layer: APPLICATION (3_applications/pianoaudio/ports).
 * @module applications/pianoaudio/ports/IMidiConverter
 */
export class IMidiConverter {
  /** @param {{recordingId:string}} recording @returns {Promise<void>} */
  async convertRecording(recording) { throw new Error('IMidiConverter.convertRecording not implemented'); }
}

export default IMidiConverter;
