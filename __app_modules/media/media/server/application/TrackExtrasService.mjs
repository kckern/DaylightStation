import { audioQuality, levelsFromDecibels, parseLyrics } from '../domain/trackExtras.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A found lyric is kept a month (the media server may gain its own later); a miss a week. */
export const LYRICS_HIT_TTL_MS = 30 * DAY_MS;
export const LYRICS_MISS_TTL_MS = 7 * DAY_MS;

/**
 * What a player shows beside the transport for one track: its loudness
 * waveform and audio quality, and its lyrics.
 *
 * Levels and quality come from the track's own source (Plex only today; any
 * adapter with getTrackLevels/getTrackLyrics would do). Lyrics come from the
 * source first, then LRCLIB unless the household turned it off
 * (`lyrics.lrclib: false` in the media config). Every lyrics answer, found or
 * not, is cached; a failed lookup is not, so it is tried again next time.
 */
export class TrackExtrasService {
  #registry;
  #lrclib;
  #cache;
  #lrclibEnabled;
  #logger;
  #now;

  /**
   * @param {object} deps
   * @param {{ get(source: string): object|undefined }} deps.registry - content adapters by source
   * @param {{ find(track): Promise<{format, text}|null> }|null} [deps.lrclib]
   * @param {{ get(source, id), set(source, id, value, at) }|null} [deps.cache]
   * @param {() => boolean} [deps.lrclibEnabled]
   */
  constructor({ registry, lrclib = null, cache = null, lrclibEnabled = () => true, logger = console, now = () => Date.now() }) {
    this.#registry = registry;
    this.#lrclib = lrclib;
    this.#cache = cache;
    this.#lrclibEnabled = lrclibEnabled;
    this.#logger = logger;
    this.#now = now;
  }

  #adapter(source, method) {
    const adapter = this.#registry?.get?.(source);
    return typeof adapter?.[method] === 'function' ? adapter : null;
  }

  /**
   * @returns {Promise<{kind: 'ok', samples: number[], quality: object|null}|{kind: 'none'}|{kind: 'not_found'}>}
   *   none: a source without levels, or a track with neither levels nor quality
   */
  async levels(source, localId, samples) {
    const adapter = this.#adapter(source, 'getTrackLevels');
    if (!adapter) return { kind: 'none' };
    const raw = await adapter.getTrackLevels(localId, samples);
    if (!raw) return { kind: 'not_found' };
    const quality = audioQuality(raw.media, raw.stream);
    const levels = raw.decibels ? levelsFromDecibels(raw.decibels) : [];
    if (!levels.length && !quality) return { kind: 'none' };
    return { kind: 'ok', samples: levels, quality };
  }

  /**
   * @returns {Promise<{kind: 'ok', synced: boolean, lines: Array, provider: string}|{kind: 'none'}|{kind: 'not_found'}>}
   */
  async lyrics(source, localId) {
    const now = this.#now();
    const cached = await this.#cache?.get(source, localId);
    if (cached) {
      const ttl = cached.value ? LYRICS_HIT_TTL_MS : LYRICS_MISS_TTL_MS;
      if (now - cached.at < ttl) return cached.value ? { kind: 'ok', ...cached.value } : { kind: 'none' };
    }

    const adapter = this.#adapter(source, 'getTrackLyrics');
    if (!adapter) return { kind: 'none' };
    const raw = await adapter.getTrackLyrics(localId);
    if (!raw) return { kind: 'not_found' };

    let value = null;
    if (raw.lyrics) {
      const parsed = parseLyrics(raw.lyrics.text, raw.lyrics.format);
      if (parsed) value = { ...parsed, provider: source };
    }
    if (!value && this.#lrclib && this.#lrclibEnabled()) {
      try {
        const found = await this.#lrclib.find(raw.track);
        const parsed = found ? parseLyrics(found.text, found.format) : null;
        if (parsed) value = { ...parsed, provider: 'lrclib' };
      } catch (err) {
        // Not cached: the next play asks again.
        this.#logger.warn?.('media.trackLyrics.lrclib-failed', { source, localId, error: err.message, status: err.status ?? null });
        return { kind: 'none' };
      }
    }
    try {
      await this.#cache?.set(source, localId, value, now);
    } catch (err) {
      this.#logger.warn?.('media.trackLyrics.cache-write-failed', { source, localId, error: err.message });
    }
    this.#logger.debug?.('media.trackLyrics.resolved', { source, localId, provider: value?.provider ?? null, synced: value?.synced ?? null });
    return value ? { kind: 'ok', ...value } : { kind: 'none' };
  }
}

export default TrackExtrasService;
