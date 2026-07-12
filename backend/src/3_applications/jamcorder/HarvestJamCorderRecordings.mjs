/**
 * Use case: enumerate JamCorder recordings, download the new ones, parse each
 * one's embedded timestamp, and archive it. Orchestration only — all I/O is via
 * the injected source/archive ports.
 *
 * Layer: APPLICATION (3_applications/jamcorder).
 * @module applications/jamcorder/HarvestJamCorderRecordings
 */
import { JamCorderStone } from '#domains/jamcorder/JamCorderStone.mjs';

export class HarvestJamCorderRecordings {
  #source; #archive; #logger;

  constructor({ source, archive, logger = console }) {
    if (!source) throw new Error('HarvestJamCorderRecordings requires source');
    if (!archive) throw new Error('HarvestJamCorderRecordings requires archive');
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

    const fresh = refs.filter((ref) => !this.#archive.has(ref));
    let saved = 0;
    for (const ref of fresh) {
      try {
        const buffer = await this.#source.download(ref);
        const relPath = JamCorderStone.fromMidiBuffer(buffer).archiveRelPath();
        await this.#archive.save(relPath, buffer);
        await this.#archive.markProcessed(ref, relPath);
        saved += 1;
        this.#logger.info?.('jamcorder.saved', { listPath: ref.listPath, relPath });
      } catch (err) {
        this.#logger.warn?.('jamcorder.file.failed', { listPath: ref.listPath, error: err.message });
      }
    }
    this.#logger.info?.('jamcorder.harvest.done', { found: refs.length, fresh: fresh.length, saved });
    return { count: saved, status: 'success' };
  }
}

export default HarvestJamCorderRecordings;
