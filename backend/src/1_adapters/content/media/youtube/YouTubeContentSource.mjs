import { Item } from '#domains/content/entities/Item.mjs';
import { YouTubeVideoId } from '#domains/content/value-objects/YouTubeVideoId.mjs';
import { encodeStreamUrl } from '#adapters/content/stream/streamUrlCodec.mjs';
import { proxifyStreamUrl } from '#adapters/content/stream/streamProxyPath.mjs';

/**
 * `youtube:<videoId>` content source — an anti-corruption layer that turns a
 * YouTube video id into a playable Item via a strategy cascade:
 *
 *   1. Piped   — fast, cached, circuit-broken direct stream URL (proxied)
 *   2. stream  — delegate to StreamAdapter (yt-dlp) for the canonical watch URL
 *   3. iframe  — embed fallback (webview)
 *
 * The id is a YouTubeVideoId value object (opaque, slash/query-free) so it
 * survives Express path routing where a raw `stream:https://…?v=…` cannot.
 */
export class YouTubeContentSource {
  #piped;
  #stream;
  #logger;

  constructor({ pipedAdapter = null, streamAdapter = null, logger = console } = {}) {
    this.#piped = pipedAdapter;
    this.#stream = streamAdapter;
    this.#logger = logger;
  }

  get source() { return 'youtube'; }
  get prefixes() { return [{ prefix: 'youtube' }]; }
  getCapabilities() { return ['playable']; }

  async getItem(id) {
    const raw = String(id ?? '').replace(/^youtube:/, '').trim();
    let videoId;
    try {
      videoId = new YouTubeVideoId(raw);
    } catch (e) {
      this.#logger.warn?.('youtube.id.invalid', { id, error: e.message });
      return null;
    }

    return (
      (await this.#fromPiped(videoId)) ||
      (await this.#fromStream(videoId)) ||
      this.#fromEmbed(videoId)
    );
  }

  async #fromPiped(videoId) {
    if (!this.#piped?.getStreamInfo) return null;
    let info;
    try {
      info = await this.#piped.getStreamInfo(videoId.value, { quality: '360p' });
    } catch (e) {
      this.#logger.warn?.('youtube.piped.threw', { videoId: videoId.value, error: e.message });
      return null;
    }
    // Only the combined (single-URL) stream is directly playable; split
    // video/audio needs MSE muxing the player doesn't do for arbitrary URLs.
    if (!info?.url) return null;

    this.#logger.info?.('stream.resolve.selected', { source: 'youtube', strategy: 'piped', videoId: videoId.value });
    return this.#buildItem(videoId, {
      mediaUrl: proxifyStreamUrl(info.url),
      mediaType: 'video',
      contentFormat: 'video',
      title: info.title || null,
      thumbnail: info.thumbnailUrl || null,
      duration: info.duration ?? null,
    });
  }

  async #fromStream(videoId) {
    if (!this.#stream?.getItem) return null;
    const compoundId = `stream:${encodeStreamUrl(videoId.watchUrl)}`;
    const streamItem = await this.#stream.getItem(compoundId);
    if (!streamItem?.mediaUrl) return null;

    this.#logger.info?.('stream.resolve.selected', { source: 'youtube', strategy: 'stream', videoId: videoId.value });
    return this.#buildItem(videoId, {
      mediaUrl: streamItem.mediaUrl,
      mediaType: streamItem.mediaType || 'video',
      contentFormat: streamItem.metadata?.contentFormat || streamItem.mediaType || 'video',
      title: streamItem.title || null,
      thumbnail: streamItem.thumbnail || null,
      duration: streamItem.duration ?? null,
    });
  }

  #fromEmbed(videoId) {
    this.#logger.info?.('stream.resolve.selected', { source: 'youtube', strategy: 'iframe', videoId: videoId.value });
    return this.#buildItem(videoId, {
      mediaUrl: videoId.embedUrl,
      mediaType: 'webview',
      contentFormat: 'webview',
      title: null,
      thumbnail: null,
      duration: null,
    });
  }

  #buildItem(videoId, { mediaUrl, mediaType, contentFormat, title, thumbnail, duration }) {
    const item = new Item({
      id: `youtube:${videoId.value}`,
      title: title || videoId.value,
      thumbnail: thumbnail || null,
      metadata: { contentFormat, sourceUrl: videoId.watchUrl },
    });
    // Item does not whitelist these — assign as own props (read by PlayResponseService):
    item.mediaUrl = mediaUrl;
    item.mediaType = mediaType;
    item.duration = duration ?? null;
    return item;
  }

  async resolvePlayables(id) {
    const item = await this.getItem(id);
    return item ? [item] : [];
  }

  async getList() { return []; }
  async resolveSiblings() { return null; }
}

export default YouTubeContentSource;
