/**
 * CompositeNowPlayingReader — one "what is on each screen now" view from
 * several sources: fleet device-state (LivenessNowPlayingReader) first, then
 * play/log-reporting sessions (PlayLedgerRecorder.nowPlaying), which are the
 * only live signal for browsers and kiosks. The first reader to name a device
 * wins. A failing reader is skipped; only when all fail does list() throw, so
 * the caller can say it does not know.
 */
export class CompositeNowPlayingReader {
  #readers;

  /** @param {Array<{list: Function}>} readers */
  constructor(readers) {
    this.#readers = (readers || []).filter((r) => typeof r?.list === 'function');
  }

  async list() {
    const seen = new Set();
    const out = [];
    let failures = 0;
    for (const reader of this.#readers) {
      let rows;
      try {
        rows = (await reader.list()) || [];
      } catch {
        failures += 1;
        continue;
      }
      for (const row of rows) {
        if (!row?.deviceId || seen.has(row.deviceId)) continue;
        seen.add(row.deviceId);
        out.push(row);
      }
    }
    if (this.#readers.length && failures === this.#readers.length) {
      throw new Error('no now-playing source could be read');
    }
    return out;
  }
}

export default CompositeNowPlayingReader;
