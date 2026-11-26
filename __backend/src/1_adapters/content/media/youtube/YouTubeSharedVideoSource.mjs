/**
 * YouTubeSharedVideoSource — the share router's YouTube source
 * (ISharedVideoSource): recognises a YouTube video link in shared text and
 * fetches the video through the fetch chain (the VPN fetch service, then the
 * app's own yt-dlp). When it cannot be fetched, it streams from `youtube:<id>`.
 *
 * Only the 11-character video id is kept from a shared link. The fetch URL is
 * rebuilt from that id (`YouTubeVideoId.watchUrl`), so the shared text never
 * reaches yt-dlp.
 *
 *   https://www.youtube.com/watch?v=<id>     (also m., music.; any extra params)
 *   https://youtu.be/<id>
 *   https://www.youtube.com/shorts/<id> | /live/<id> | /embed/<id> | /v/<id>
 *
 * Reference: __docs/reference/core/share.md
 */
import { YouTubeVideoId } from "../../../../../../__capabilities/content-catalog/server/domain/value-objects/YouTubeVideoId.mjs";
import { ISharedVideoSource } from "../../../../../../__app_modules/media/media/server/application/share/ports/ISharedVideoSource.mjs";

/** The provider id the scene's logo and accent are looked up by (provenance config). */
export const YOUTUBE_PROVIDER = 'youtube';

const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const PATH_KINDS = new Set(['shorts', 'live', 'embed', 'v']);

function idOrNull(raw) {
  try { return new YouTubeVideoId(String(raw ?? '')); } catch { return null; }
}

/** @param {string} url @returns {YouTubeVideoId|null} */
export function youtubeVideoIdFrom(url) {
  let parsed;
  try { parsed = new URL(String(url ?? '')); } catch { return null; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') return parts.length >= 1 ? idOrNull(parts[0]) : null;
  if (!HOSTS.has(host)) return null;
  if (parts[0] === 'watch') return idOrNull(parsed.searchParams.get('v'));
  if (PATH_KINDS.has(parts[0]) && parts[1]) return idOrNull(parts[1]);
  return null;
}

export class YouTubeSharedVideoSource extends ISharedVideoSource {
  #fetcher;
  #running = new Map();

  /**
   * @param {object} deps
   * @param {{ fetch(url, options), stored(name), cancel(name) }} deps.fetcher - the fetch chain
   *   (FailoverVideoFetcher: the VPN fetch service, then the app's own yt-dlp)
   */
  constructor({ fetcher }) {
    super();
    if (!fetcher?.fetch) throw new Error('YouTubeSharedVideoSource requires a fetcher');
    this.#fetcher = fetcher;
  }

  recognize(url) {
    const id = youtubeVideoIdFrom(url);
    return id ? { provider: YOUTUBE_PROVIDER, sourceId: id.value } : null;
  }

  async fetch(sourceId, options = {}) {
    const id = idOrNull(sourceId);
    if (!id) return { kind: 'failed', error: 'not a YouTube video id', reason: 'error' };
    const ctrl = new AbortController();
    this.#running.set(options.name, ctrl);
    try {
      return await this.#fetcher.fetch(id.watchUrl, { ...options, signal: ctrl.signal });
    } finally {
      this.#running.delete(options.name);
    }
  }

  async stored(name) {
    const held = await this.#fetcher.stored?.(name);
    return held ? { provider: YOUTUBE_PROVIDER, ...held } : null;
  }

  async cancel(name) {
    this.#running.get(name)?.abort();
    await this.#fetcher.cancel?.(name);
  }

  /** The last fallback: the `youtube:` content source streams the same video (Piped, yt-dlp stream, embed). */
  streamContentId(sourceId) {
    const id = idOrNull(sourceId);
    return id ? `youtube:${id.value}` : null;
  }
}

export default YouTubeSharedVideoSource;
