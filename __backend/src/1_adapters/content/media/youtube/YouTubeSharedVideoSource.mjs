/**
 * YouTubeSharedVideoSource — the share router's YouTube source
 * (ISharedVideoSource): recognises a YouTube video link in shared text and
 * fetches the video with yt-dlp.
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
  #downloader;

  /** @param {{ downloader: { downloadOne(url: string, options: object): Promise<object> } }} deps - the yt-dlp adapter */
  constructor({ downloader }) {
    super();
    if (!downloader?.downloadOne) throw new Error('YouTubeSharedVideoSource requires a downloader');
    this.#downloader = downloader;
  }

  recognize(url) {
    const id = youtubeVideoIdFrom(url);
    return id ? { provider: YOUTUBE_PROVIDER, sourceId: id.value } : null;
  }

  async fetch(sourceId, options = {}) {
    const id = idOrNull(sourceId);
    if (!id) return { kind: 'failed', error: 'not a YouTube video id' };
    return this.#downloader.downloadOne(id.watchUrl, options);
  }
}

export default YouTubeSharedVideoSource;
