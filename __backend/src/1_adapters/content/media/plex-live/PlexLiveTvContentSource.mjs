import { PlayableItem } from "../../../../../../__capabilities/content-catalog/server/items.mjs";

/**
 * `plex-live:<slug>` content source — Plex's free live TV channels
 * (watch.plex.tv/live-tv/channel/<slug>) as playable items.
 *
 *   plex-live:nfl-channel  → the NFL Channel, as an `hls_video` item
 *   plex-live:             → every playable channel (for menus and pickers)
 *
 * The item's mediaUrl is the channel's master playlist through the
 * `plex-live` proxy (PlexLiveTvProxyAdapter), which adds the account token
 * upstream and removes it from every playlist on the way back.
 *
 * A channel is live: no duration, nothing to resume, never "watched".
 */
export class PlexLiveTvContentSource {
  #lineup;
  #proxyPrefix;
  #logger;

  /**
   * @param {Object} deps
   * @param {{ list: Function, get: Function }} deps.lineup - PlexLiveTvLineup
   * @param {string} [deps.proxyPrefix] - Public mount of the plex-live proxy
   * @param {Object} [deps.logger]
   */
  constructor({ lineup, proxyPrefix = '/api/v1/proxy/plex-live', logger = console }) {
    this.#lineup = lineup;
    this.#proxyPrefix = proxyPrefix.replace(/\/$/, '');
    this.#logger = logger;
  }

  get source() { return 'plex-live'; }
  get prefixes() { return [{ prefix: 'plex-live' }]; }
  getCapabilities() { return ['playable']; }

  async getItem(id) {
    const slug = localId(id);
    if (!slug) return null;
    const channel = await this.#lineup.get(slug);
    if (!channel) {
      this.#logger.warn?.('plex-live.channel.not-found', { slug });
      return null;
    }
    this.#logger.info?.('plex-live.channel.resolved', { slug, callSign: channel.callSign });
    return this.#toItem(channel);
  }

  async resolvePlayables(id) {
    const item = await this.getItem(id);
    return item ? [item] : [];
  }

  /** `plex-live:` (no slug) lists every playable channel. */
  async getList(id) {
    if (localId(id)) return [];
    const channels = await this.#lineup.list();
    return channels.map((channel) => this.#toItem(channel));
  }

  async resolveSiblings() { return null; }

  /**
   * Menu tile art: the channel's vertical poster (it sits with Plex show
   * posters), else its logo. Public provider-static URLs, no token.
   */
  async getThumbnailUrl(id) {
    const slug = localId(id);
    if (!slug) return null;
    const channel = await this.#lineup.get(slug);
    return channel ? (channel.poster || channel.thumb || null) : null;
  }

  #toItem(channel) {
    return new PlayableItem({
      id: `plex-live:${channel.slug}`,
      title: channel.title,
      type: 'live-channel',
      thumbnail: channel.thumb,
      imageUrl: channel.poster || channel.art || channel.thumb,
      description: channel.summary,
      mediaType: 'hls_video',
      mediaUrl: `${this.#proxyPrefix}${channel.partKey}`,
      duration: null,
      resumable: false,
      metadata: {
        contentFormat: 'hls_video',
        live: true,
        callSign: channel.callSign,
        art: channel.art,
        sourceUrl: `https://watch.plex.tv/live-tv/channel/${channel.slug}`,
      },
    });
  }
}

function localId(id) {
  const slug = String(id ?? '').replace(/^plex-live:/, '').trim().toLowerCase();
  return /^[a-z0-9-]+$/.test(slug) ? slug : '';
}

export default PlexLiveTvContentSource;
