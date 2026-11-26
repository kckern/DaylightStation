/**
 * FailoverVideoFetcher — tries its fetchers in order until one fetches the
 * video. A fetcher that cannot be reached (it throws) or fails is passed over
 * for the next; a video that is too large to fetch, or a cancelled fetch, is
 * not tried again (the caller streams it instead, or stops).
 *
 * Each fetcher: { name, fetch(url, options), stored(name), cancel(name) }.
 *
 * Reference: __docs/reference/core/share.md
 */
const FINAL = new Set(['too_large', 'cancelled']);

export class FailoverVideoFetcher {
  #fetchers; #logger;

  constructor({ fetchers, logger = console }) {
    const list = (fetchers || []).filter(Boolean);
    if (!list.length) throw new Error('FailoverVideoFetcher needs at least one fetcher');
    this.#fetchers = list;
    this.#logger = logger;
  }

  get names() { return this.#fetchers.map((f) => f.name); }

  async fetch(url, options = {}) {
    let last = { kind: 'failed', error: 'no fetcher', reason: 'error' };
    for (let i = 0; i < this.#fetchers.length; i += 1) {
      if (options.signal?.aborted) return { kind: 'failed', error: 'cancelled', reason: 'cancelled' };
      const fetcher = this.#fetchers[i];
      options.onAttempt?.({ fetcher: fetcher.name, n: i + 1 });
      try {
        const result = await fetcher.fetch(url, options);
        if (result?.kind === 'downloaded') return { ...result, fetcher: fetcher.name };
        last = result || last;
        if (options.signal?.aborted) return { kind: 'failed', error: 'cancelled', reason: 'cancelled' };
        this.#logger.warn?.('share.fetch.failed', { name: options.name, fetcher: fetcher.name, reason: last.reason, error: String(last.error).slice(0, 200) });
        if (FINAL.has(last.reason)) return last;
      } catch (error) {
        last = { kind: 'failed', error: error.message, reason: 'error' };
        this.#logger.warn?.('share.fetch.unreachable', { name: options.name, fetcher: fetcher.name, error: error.message });
      }
    }
    return last;
  }

  async stored(name) {
    for (const fetcher of this.#fetchers) {
      try {
        const held = await fetcher.stored?.(name);
        if (held) return held;
      } catch { /* the next may hold it */ }
    }
    return null;
  }

  async cancel(name) {
    await Promise.all(this.#fetchers.map((f) => Promise.resolve(f.cancel?.(name)).catch(() => {})));
  }
}

export default FailoverVideoFetcher;
