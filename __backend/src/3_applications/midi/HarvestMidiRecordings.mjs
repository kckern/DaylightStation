/**
 * Use case: enumerate a networked MIDI recorder's recordings, download the new
 * ones, parse each one's embedded timestamp, and archive it. Orchestration only
 * — all I/O is via the injected source/archive ports.
 *
 * The `jamcorder.*` log event names below deliberately keep the vendor name:
 * they are queryable history in the log store and saved queries reference them.
 * Do not rename them along with the class/module.
 *
 * Layer: APPLICATION (3_applications/midi).
 * @module applications/midi/HarvestMidiRecordings
 */
export class HarvestMidiRecordings {
  #source; #archive; #logger;

  constructor({ source, archive, logger = console }) {
    if (!source) throw new Error('HarvestMidiRecordings requires source');
    if (!archive) throw new Error('HarvestMidiRecordings requires archive');
    this.#source = source;
    this.#archive = archive;
    this.#logger = logger;
  }

  /** @returns {Promise<{count:number, status:'success'|'error', reason?:string}>} */
  async execute() {
    let refs;
    try {
      refs = await this.#source.listRecordings();
    } catch (err) {
      this.#logger.warn?.('jamcorder.list.failed', { error: err.message });
      return { count: 0, status: 'error', reason: err.message };
    }

    const fresh = refs.filter((ref) => !this.#archive.hasRecording(ref.recordingId));
    let saved = 0;
    for (const ref of fresh) {
      try {
        const artifact = await this.#source.fetchRecording(ref);
        const { archiveId } = await this.#archive.archiveRecording(ref, artifact);
        saved += 1;
        this.#logger.info?.('jamcorder.saved', { listPath: ref.recordingId, relPath: archiveId });
      } catch (err) {
        this.#logger.warn?.('jamcorder.file.failed', { listPath: ref.recordingId, error: err.message });
      }
    }
    this.#logger.info?.('jamcorder.harvest.done', { found: refs.length, fresh: fresh.length, saved });
    return { count: saved, status: 'success' };
  }
}

export default HarvestMidiRecordings;
