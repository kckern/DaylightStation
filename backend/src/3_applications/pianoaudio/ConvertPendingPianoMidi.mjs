/**
 * Use case: convert every pending piano MIDI to MP3. Orchestration only — the
 * library lists what needs converting, the converter renders each one. A
 * per-file failure is logged and skipped, never fatal.
 *
 * Layer: APPLICATION (3_applications/pianoaudio).
 * @module applications/pianoaudio/ConvertPendingPianoMidi
 */
export class ConvertPendingPianoMidi {
  #library; #converter; #logger; #concurrency; #running = false;

  constructor({ library, converter, logger = console, concurrency = 1 }) {
    if (!library) throw new Error('ConvertPendingPianoMidi requires library');
    if (!converter) throw new Error('ConvertPendingPianoMidi requires converter');
    this.#library = library;
    this.#converter = converter;
    this.#logger = logger;
    this.#concurrency = Math.max(1, concurrency | 0);
  }

  /** @returns {Promise<{count:number, status:'success'|'skipped'|'error', reason?:string}>} */
  async execute() {
    if (this.#running) {
      this.#logger.warn?.('pianoaudio.skip.already_running', {});
      return { count: 0, status: 'skipped', reason: 'already-running' };
    }
    this.#running = true;
    try {
      let pending;
      try {
        pending = await this.#library.listPending();
      } catch (err) {
        this.#logger.warn?.('pianoaudio.list.failed', { error: err.message });
        return { count: 0, status: 'error', reason: err.message };
      }

      // Convert with bounded concurrency: N workers pull from a shared cursor.
      // Each file has its own unique scratch WAV and its own `<mp3>.tmp`, so
      // concurrent conversions never collide. `converted++` is safe (single JS
      // thread; awaits only interleave). A per-file failure is logged, not fatal.
      let converted = 0;
      let cursor = 0;
      const worker = async () => {
        for (;;) {
          const i = cursor++;
          if (i >= pending.length) return;
          const ref = pending[i];
          try {
            await this.#converter.convert(ref.midiPath, ref.mp3Path);
            converted += 1;
            this.#logger.info?.('pianoaudio.converted', { midiPath: ref.midiPath, mp3Path: ref.mp3Path });
          } catch (err) {
            this.#logger.warn?.('pianoaudio.convert.failed', { midiPath: ref.midiPath, error: err.message });
          }
        }
      };
      const workers = Math.min(this.#concurrency, pending.length) || 1;
      await Promise.all(Array.from({ length: workers }, () => worker()));

      this.#logger.info?.('pianoaudio.harvest.done', { pending: pending.length, converted, concurrency: this.#concurrency });
      return { count: converted, status: 'success' };
    } finally {
      this.#running = false;
    }
  }
}

export default ConvertPendingPianoMidi;
