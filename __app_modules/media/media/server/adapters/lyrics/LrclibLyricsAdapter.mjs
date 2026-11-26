/**
 * LRCLIB (https://lrclib.net), a free public database of time-synced lyrics.
 * The fallback when the media server holds no lyrics for a track.
 *
 * Sends only the song's identity (artist, title, album, length) and a generic
 * client name: nothing about the household or who is listening.
 */
export const LRCLIB_USER_AGENT = 'DaylightStation (https://github.com/kckern/DaylightStation)';

export class LrclibLyricsAdapter {
  #fetch;
  #base;
  #timeoutMs;

  /**
   * @param {{ fetchImpl?: typeof fetch, baseUrl?: string, timeoutMs?: number }} [deps]
   */
  constructor({ fetchImpl = globalThis.fetch, baseUrl = 'https://lrclib.net', timeoutMs = 4000 } = {}) {
    this.#fetch = fetchImpl;
    this.#base = baseUrl.replace(/\/$/, '');
    this.#timeoutMs = timeoutMs;
  }

  /**
   * @param {{ artist: string, title: string, album?: string, durationMs?: number|null }} track
   * @returns {Promise<{format: 'lrc'|'txt', text: string}|null>} null when LRCLIB has none
   * @throws on network failure, timeout or an unexpected status
   */
  async find({ artist, title, album, durationMs }) {
    if (!artist || !title) return null;
    const params = new URLSearchParams({ artist_name: artist, track_name: title });
    if (album) params.set('album_name', album);
    if (Number.isFinite(durationMs) && durationMs > 0) params.set('duration', String(Math.round(durationMs / 1000)));
    const response = await this.#fetch(`${this.#base}/api/get?${params}`, {
      headers: { 'User-Agent': LRCLIB_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      const err = new Error(`lrclib answered ${response.status}`);
      err.status = response.status;
      throw err;
    }
    const body = await response.json();
    if (body?.instrumental) return null;
    if (typeof body?.syncedLyrics === 'string' && body.syncedLyrics.trim()) return { format: 'lrc', text: body.syncedLyrics };
    if (typeof body?.plainLyrics === 'string' && body.plainLyrics.trim()) return { format: 'txt', text: body.plainLyrics };
    return null;
  }
}

export default LrclibLyricsAdapter;
