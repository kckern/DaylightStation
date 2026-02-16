// backend/src/1_adapters/feed/WebContentAdapter.mjs
/**
 * WebContentAdapter
 *
 * Adapter for fetching and parsing external web content:
 * - Favicon / subreddit icon resolution
 * - HTML article content extraction
 *
 * All external HTTP calls and HTML parsing live here.
 * The application layer consumes clean domain-relevant results.
 *
 * @module adapters/feed/WebContentAdapter
 */

const ICON_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_ICON_CACHE = 200;
const READABLE_TIMEOUT = 8000;
const MAX_WORDS = 500;
const USER_AGENT = 'Mozilla/5.0 (compatible; DaylightStation/1.0)';

export class WebContentAdapter {
  #iconCache = new Map();
  #logger;

  /**
   * @param {Object} [deps]
   * @param {Object} [deps.logger]
   */
  constructor({ logger = console } = {}) {
    this.#logger = logger;
  }

  // ===========================================================================
  // Icon resolution
  // ===========================================================================

  /**
   * Resolve a source icon (favicon or subreddit icon) for the given URL.
   *
   * @param {string} url - The source URL to resolve an icon for
   * @returns {Promise<{ data: Buffer, contentType: string } | null>}
   */
  async resolveIcon(url) {
    const cached = this.#iconCache.get(url);
    if (cached && Date.now() - cached.time < ICON_TTL) {
      return { data: cached.data, contentType: cached.contentType };
    }

    try {
      const iconUrl = await this.#resolveIconUrl(url);
      const iconRes = await fetch(iconUrl);
      if (!iconRes.ok) return null;

      const buffer = Buffer.from(await iconRes.arrayBuffer());
      const contentType = iconRes.headers.get('content-type') || 'image/png';

      this.#iconCache.set(url, { data: buffer, contentType, time: Date.now() });
      this.#evictStaleIcons();

      return { data: buffer, contentType };
    } catch (err) {
      this.#logger.warn?.('webcontent.icon.error', { url, error: err.message });
      return null;
    }
  }

  /**
   * Determine the icon URL for a source.
   * Reddit subreddits: fetch community_icon from about.json
   * Everything else: Google favicon API
   */
  async #resolveIconUrl(url) {
    if (url.includes('reddit.com/r/')) {
      const sub = url.match(/\/r\/([^/]+)/)?.[1];
      if (sub) {
        try {
          const aboutRes = await fetch(`https://www.reddit.com/r/${sub}/about.json`, {
            headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
          });
          if (aboutRes.ok) {
            const about = await aboutRes.json();
            const icon = about.data?.community_icon?.split('?')?.[0] || about.data?.icon_img || null;
            if (icon) return icon;
          }
        } catch {
          // fall through to Google favicon
        }
      }
    }

    return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(url)}&size=32`;
  }

  #evictStaleIcons() {
    if (this.#iconCache.size > MAX_ICON_CACHE) {
      const now = Date.now();
      for (const [key, val] of this.#iconCache) {
        if (now - val.time > ICON_TTL) this.#iconCache.delete(key);
      }
    }
  }

  // ===========================================================================
  // Readable content extraction
  // ===========================================================================

  /**
   * Fetch a web page and extract its readable content.
   *
   * @param {string} url - The article URL to extract content from
   * @returns {Promise<{ title: string|null, content: string, wordCount: number, ogImage: string|null }>}
   * @throws {Error} If the upstream page cannot be fetched
   */
  async extractReadableContent(url) {
    const pageRes = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
      signal: AbortSignal.timeout(READABLE_TIMEOUT),
    });

    if (!pageRes.ok) {
      const err = new Error(`Upstream returned ${pageRes.status}`);
      err.upstreamStatus = pageRes.status;
      throw err;
    }

    const html = await pageRes.text();
    return this.#parseHtml(html);
  }

  /**
   * Parse HTML into readable content.
   */
  #parseHtml(html) {
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()
      ?.replace(/&amp;/g, '&')?.replace(/&lt;/g, '<')?.replace(/&gt;/g, '>') || null;

    const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] || null;

    let bodyHtml = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1]
      || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1]
      || html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]
      || '';

    bodyHtml = bodyHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '');

    const text = bodyHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const words = text.split(/\s+/);
    const content = words.length > MAX_WORDS ? words.slice(0, MAX_WORDS).join(' ') + '...' : text;

    return { title, content, wordCount: words.length, ogImage };
  }
}
