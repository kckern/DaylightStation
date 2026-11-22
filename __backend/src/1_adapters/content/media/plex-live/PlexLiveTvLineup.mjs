/**
 * Plex free live TV lineup — the ~700 channels on watch.plex.tv/live-tv.
 *
 * Reads `GET /lineups/plex/channels` on the Plex provider host with the
 * account token in a header (never the query, so it stays out of request
 * logs) and keeps the result for a few hours: the lineup changes rarely and
 * every channel lookup would otherwise be a cloud round trip.
 *
 * Only plain-HLS, non-DRM channels are kept, since those are the ones the
 * Player can play.
 */

const DEFAULT_HOST = 'https://epg.provider.plex.tv';
const CACHE_MS = 6 * 60 * 60 * 1000;
const FAILURE_BACKOFF_MS = 60 * 1000;
const TIMEOUT_MS = 15000;

/**
 * @typedef {Object} LiveChannel
 * @property {string} slug        - Stable public name, e.g. `nfl-channel`
 * @property {string} title
 * @property {string|null} callSign
 * @property {string|null} summary
 * @property {string|null} thumb  - Channel logo (public provider-static URL)
 * @property {string|null} art    - Background art
 * @property {string|null} poster - Vertical poster
 * @property {string} partKey     - `/library/parts/<id>.m3u8` on the provider host
 * @property {string|null} gridKey
 */

export class PlexLiveTvLineup {
  #host;
  #token;
  #httpClient;
  #logger;
  #now;
  #cache = null;        // { at, channels: Map<slug, LiveChannel> }
  #inflight = null;
  #failedAt = null;

  /**
   * @param {Object} deps
   * @param {string} deps.token
   * @param {{ get: Function }} deps.httpClient - returns `{ ok, status, data }`
   * @param {string} [deps.host]
   * @param {Object} [deps.logger]
   * @param {() => number} [deps.now]
   */
  constructor({ token, httpClient, host = DEFAULT_HOST, logger = console, now = () => Date.now() }) {
    this.#token = token;
    this.#httpClient = httpClient;
    this.#host = host;
    this.#logger = logger;
    this.#now = now;
  }

  /** @returns {Promise<LiveChannel[]>} */
  async list() {
    const channels = await this.#load();
    return channels ? [...channels.values()] : [];
  }

  /** @returns {Promise<LiveChannel|null>} */
  async get(slug) {
    const channels = await this.#load();
    return channels?.get(String(slug || '').toLowerCase()) ?? null;
  }

  async #load() {
    const now = this.#now();
    if (this.#cache && now - this.#cache.at < CACHE_MS) return this.#cache.channels;
    // After a failure, serve the stale lineup (if any) instead of hammering.
    if (this.#failedAt !== null && now - this.#failedAt < FAILURE_BACKOFF_MS) return this.#cache?.channels ?? null;
    if (!this.#inflight) {
      this.#inflight = this.#fetch().finally(() => { this.#inflight = null; });
    }
    return this.#inflight;
  }

  async #fetch() {
    try {
      const res = await this.#httpClient.get(`${this.#host}/lineups/plex/channels`, {
        headers: { Accept: 'application/json', 'X-Plex-Token': this.#token },
        timeout: TIMEOUT_MS,
      });
      if (!res?.ok) throw new Error(`lineup HTTP ${res?.status}`);
      const raw = res.data?.MediaContainer?.Channel;
      if (!Array.isArray(raw)) throw new Error('lineup response has no MediaContainer.Channel');
      const channels = new Map();
      for (const entry of raw) {
        const channel = toChannel(entry);
        if (channel) channels.set(channel.slug, channel);
      }
      this.#cache = { at: this.#now(), channels };
      this.#failedAt = null;
      this.#logger.info?.('plex-live.lineup.loaded', { channels: channels.size, listed: raw.length });
      return channels;
    } catch (error) {
      this.#failedAt = this.#now();
      this.#logger.warn?.('plex-live.lineup.failed', { error: error.message, stale: Boolean(this.#cache) });
      return this.#cache?.channels ?? null;
    }
  }
}

/** Provider channel → LiveChannel, or null when the Player cannot play it. */
export function toChannel(entry) {
  if (!entry || entry.hidden) return null;
  const slug = typeof entry.slug === 'string' ? entry.slug.toLowerCase() : '';
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const media = (entry.Media || []).find((m) => m && !m.drm && m.protocol === 'hls');
  const partKey = media?.Part?.[0]?.key;
  if (typeof partKey !== 'string' || !/^\/library\/parts\/[A-Za-z0-9-]+\.m3u8$/.test(partKey)) return null;
  return {
    slug,
    title: entry.title || slug,
    callSign: entry.callSign || null,
    summary: entry.summary || null,
    thumb: entry.thumb || null,
    art: entry.art || null,
    poster: entry.coverPoster || null,
    partKey,
    gridKey: entry.gridKey || null,
  };
}

export default PlexLiveTvLineup;
