import { imageSize } from '../../../domain/content-filter/imageSize.mjs';

export const MIN_LOGO_WIDTH = 300;
const PROXY = '/api/v1/proxy/plex';

/**
 * Art for a title's cards: { logo, background, poster, source }. The logo is chosen by cascade:
 *   1. Plex's selected clear logo, if >= 300 px wide;
 *   2. else the best alternative (PNG first, >= 300 px, then widest, English first when stated),
 *      which is also selected in Plex, best-effort;
 *   3. else none (the card falls back to the poster layout, or to the title text).
 * Widths come from the image header only. The decision is cached per ratingKey.
 *
 * @param {{ plex: { getMetadata, getClearLogos, selectClearLogo, imageHead }, logger?: object, ttlMs?: number, now?: () => number }} deps
 */
export class ContentFilterArt {
  #plex; #logger; #ttl; #now; #cache = new Map();

  constructor({ plex, logger = console, ttlMs = 6 * 3600_000, now = Date.now } = {}) {
    if (!plex) throw new Error('ContentFilterArt requires plex');
    this.#plex = plex; this.#logger = logger; this.#ttl = ttlMs; this.#now = now;
  }

  async execute({ ratingKey }) {
    const hit = this.#cache.get(ratingKey);
    if (hit && this.#now() - hit.at < this.#ttl) return hit.art;
    const art = await this.#resolve(ratingKey);
    this.#cache.set(ratingKey, { art, at: this.#now() });
    return art;
  }

  async #width(keyOrUrl) {
    try { return imageSize(await this.#plex.imageHead(keyOrUrl))?.width ?? null; } catch { return null; }
  }

  async #resolve(rk) {
    const base = `${PROXY}/library/metadata/${rk}`;
    let images = null;
    try {
      const meta = await this.#plex.getMetadata(rk);
      images = meta?.MediaContainer?.Metadata?.[0]?.Image || null;
    } catch (error) {
      this.#logger.warn?.('content-filter.art.metadata-failed', { rk, error: error?.message });
    }
    const has = (type) => !images || images.some((i) => i.type === type);
    const poster = has('coverPoster') ? `${base}/thumb` : null;
    const background = has('background') ? `${base}/art` : null;
    const done = (logo, source, width) => {
      this.#logger.info?.('content-filter.art.logo', { rk, source, width: width ?? null });
      return { logo, background, poster, source };
    };

    // 1. Plex's selected clear logo.
    const selected = images?.find((i) => i.type === 'clearLogo');
    let selectedWidth = null;
    if (selected?.url) {
      selectedWidth = await this.#width(selected.url);
      if (selectedWidth != null && selectedWidth >= MIN_LOGO_WIDTH) return done(`${base}/clearLogo`, 'selected', selectedWidth);
    }

    // 2. The best alternative.
    let alternatives = [];
    try {
      alternatives = (await this.#plex.getClearLogos(rk))?.MediaContainer?.Metadata || [];
    } catch (error) {
      this.#logger.warn?.('content-filter.art.alternatives-failed', { rk, error: error?.message });
    }
    const measured = [];
    for (const alt of alternatives) {
      if (alt.selected || !alt.key) continue;
      const width = await this.#width(alt.key);
      if (width != null && width >= MIN_LOGO_WIDTH) measured.push({ alt, width, png: /\.png(\?|$)/i.test(alt.key) });
    }
    const english = (m) => (m.alt.language ? (/^en/i.test(m.alt.language) ? 1 : 0) : 0.5);
    measured.sort((a, b) => (b.png - a.png) || (english(b) - english(a)) || (b.width - a.width));
    const best = measured[0];
    if (best) {
      const key = best.alt.key;
      this.#select(rk, best.alt.ratingKey || key);
      return done(/^https?:\/\//i.test(key) ? key : `${PROXY}${key}`, 'alternative', best.width);
    }
    return done(null, 'none', selectedWidth);
  }

  async #select(rk, choice) {
    try {
      await this.#plex.selectClearLogo(rk, choice);
      this.#logger.info?.('content-filter.art.logo-selected', { rk });
    } catch (error) {
      this.#logger.warn?.('content-filter.art.select-failed', { rk, error: error?.message });
    }
  }
}
