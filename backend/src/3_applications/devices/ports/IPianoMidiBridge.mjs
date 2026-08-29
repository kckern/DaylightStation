/** Outbound bridge capability used by the piano MIDI wake workflow. */
export class IPianoMidiBridge {
  start(_onNoteOn) { throw new Error('IPianoMidiBridge.start must be implemented'); }
  stop() { throw new Error('IPianoMidiBridge.stop must be implemented'); }
  async suppressWakeUntil(_deadlineMs) {
    throw new Error('IPianoMidiBridge.suppressWakeUntil must be implemented');
  }
}
