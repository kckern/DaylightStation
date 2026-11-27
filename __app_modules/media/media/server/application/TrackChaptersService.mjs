import { folderKey, sameLength, normalizeChapters } from '../domain/trackChapters.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A found chapter list is kept a month; a miss a day (a book may gain chapters). */
export const CHAPTERS_HIT_TTL_MS = 30 * DAY_MS;
export const CHAPTERS_MISS_TTL_MS = 1 * DAY_MS;

/**
 * Chapters for one track (an audiobook file): the source's own markers first, then the
 * same book in Audiobookshelf, matched by folder, one audio file and length (never
 * guessed). Every answer, found or not, is cached; a failed lookup is not, so it is
 * tried again next time. See ops:docs/superpowers/specs/2026-11-26-phone-audiobook-chapters.md.
 */
export class TrackChaptersService {
  #registry;
  #books;
  #cache;
  #logger;
  #now;

  /**
   * @param {object} deps
   * @param {{ get(source: string): object|undefined }} deps.registry - content adapters by source
   * @param {{ find(title: string): Promise<Array<{id, path, durationMs, audioFiles}>>, chapters(id: string): Promise<Array> }|null} [deps.books]
   *   the Audiobookshelf side: candidate books by title, and one book's chapters
   * @param {{ get(source, id), set(source, id, value, at) }|null} [deps.cache]
   */
  constructor({ registry, books = null, cache = null, logger = console, now = () => Date.now() }) {
    this.#registry = registry;
    this.#books = books;
    this.#cache = cache;
    this.#logger = logger;
    this.#now = now;
  }

  /**
   * @returns {Promise<{kind:'ok', chapters:Array, durationMs:number, provider:string}|{kind:'none'}|{kind:'not_found'}>}
   */
  async chapters(source, localId) {
    const now = this.#now();
    const cached = await this.#cache?.get(source, localId);
    if (cached) {
      const ttl = cached.value ? CHAPTERS_HIT_TTL_MS : CHAPTERS_MISS_TTL_MS;
      if (now - cached.at < ttl) return cached.value ? { kind: 'ok', ...cached.value } : { kind: 'none' };
    }
    const adapter = this.#registry?.get?.(source);
    if (typeof adapter?.getTrackChapters !== 'function') return { kind: 'none' };
    const raw = await adapter.getTrackChapters(localId);
    if (!raw) return { kind: 'not_found' };
    const durationMs = raw.track?.durationMs;

    let value = null;
    let reason = null;
    if (raw.chapters?.length) {
      const own = normalizeChapters(raw.chapters, durationMs);
      if (own.chapters) value = { chapters: own.chapters, durationMs, provider: source };
      else reason = own.reason;
    }
    if (!value && this.#books) {
      let found;
      try {
        found = await this.#fromBooks(raw.track);
      } catch (err) {
        // Not cached: Audiobookshelf may be back next play.
        this.#logger.warn?.('media.trackChapters.lookup-failed', { source, localId, error: err.message, status: err.status ?? err.response?.status ?? null });
        return { kind: 'none' };
      }
      if (found.chapters) value = { chapters: found.chapters, durationMs, provider: 'audiobookshelf' };
      else reason = found.reason;
    }
    try {
      await this.#cache?.set(source, localId, value, now);
    } catch (err) {
      this.#logger.warn?.('media.trackChapters.cache-write-failed', { source, localId, error: err.message });
    }
    if (value) this.#logger.info?.('media.trackChapters.resolved', { source, localId, provider: value.provider, count: value.chapters.length });
    else this.#logger.debug?.('media.trackChapters.none', { source, localId, reason });
    return value ? { kind: 'ok', ...value } : { kind: 'none' };
  }

  /** The same book in Audiobookshelf: same folder, one audio file, the same length. */
  async #fromBooks(track) {
    const key = folderKey(track?.file, { isFile: true });
    if (!key) return { reason: 'no-file-path' };
    const titles = [...new Set([track.album, track.title].filter((t) => typeof t === 'string' && t.trim()))];
    for (const title of titles) {
      const candidates = await this.#books.find(title);
      const same = candidates.filter((b) => folderKey(b.path) === key);
      if (!same.length) continue;
      const book = same[0];
      if (book.audioFiles !== 1) return { reason: 'multi-file' };
      if (!sameLength(book.durationMs, track.durationMs)) {
        this.#logger.warn?.('media.trackChapters.duration-mismatch', { bookId: book.id, bookMs: book.durationMs, trackMs: track.durationMs });
        return { reason: 'duration-mismatch' };
      }
      const raw = await this.#books.chapters(book.id);
      const norm = normalizeChapters(raw, track.durationMs);
      if (norm.reason) this.#logger.warn?.('media.trackChapters.bad-chapters', { bookId: book.id, reason: norm.reason });
      return norm;
    }
    return { reason: 'no-folder-match' };
  }
}

export default TrackChaptersService;
