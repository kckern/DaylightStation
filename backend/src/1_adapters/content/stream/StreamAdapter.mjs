import { Item } from '#domains/content/entities/Item.mjs';
import { decodeStreamUrl } from './streamUrlCodec.mjs';

const STREAM_PROXY_PATH = '/api/v1/proxy/stream';

/**
 * Vendor-blind content source for arbitrary online URLs.
 * Holds an ordered IStreamResolver[] keyed by strategy and a StreamProfile[].
 *
 * NOTE: Item's constructor does not whitelist mediaUrl/mediaType/duration,
 * so they are assigned as own props after construction (read downstream by
 * PlayResponseService).
 */
export class StreamAdapter {
  #resolvers;
  #profiles;
  #fallbackStrategy;
  #logger;

  constructor({ resolvers = [], profiles = [], fallbackStrategy = 'ytdlp', logger = console } = {}) {
    this.#resolvers = new Map(resolvers.map((r) => [r.strategy, r]));
    this.#profiles = profiles;
    this.#fallbackStrategy = fallbackStrategy;
    this.#logger = logger;
  }

  get source() { return 'stream'; }
  get prefixes() { return [{ prefix: 'stream' }]; }
  getCapabilities() { return ['playable']; }

  async getItem(id) {
    const token = String(id).replace(/^stream:/, '');
    const url = decodeStreamUrl(token);
    const profile = this.#profiles.find((p) => p.matches(url)) || null;
    const strategy = profile?.strategy || this.#fallbackStrategy;

    let result = await this.#tryStrategy(strategy, url, profile);
    if (!result && strategy !== 'iframe') result = await this.#tryStrategy('iframe', url, profile);
    if (!result) return null;

    const mediaUrl = result.format === 'webview'
      ? result.mediaUrl
      : this.#proxify(result.mediaUrl, profile?.name);

    const item = new Item({
      id: `stream:${token}`,
      title: result.title || profile?.name || url,
      thumbnail: result.poster || null,
      metadata: { contentFormat: result.format, sourceUrl: url },
    });
    // Item does not whitelist these — assign as own props (read by PlayResponseService):
    item.mediaUrl = mediaUrl;
    item.mediaType = result.format;
    item.duration = result.duration ?? null;
    return item;
  }

  async #tryStrategy(strategy, url, profile) {
    const resolver = this.#resolvers.get(strategy);
    if (!resolver) return null;
    try {
      return await resolver.resolve(url, profile);
    } catch (e) {
      this.#logger.warn?.('stream.resolver.threw', { strategy, url, error: e.message });
      return null;
    }
  }

  #proxify(mediaUrl, profileName) {
    const q = new URLSearchParams({ src: mediaUrl });
    if (profileName) q.set('profile', profileName);
    return `${STREAM_PROXY_PATH}?${q.toString()}`;
  }

  async resolvePlayables(id) {
    const item = await this.getItem(id);
    return item ? [item] : [];
  }

  async getList() { return []; }
  async resolveSiblings() { return null; }
}

export default StreamAdapter;
