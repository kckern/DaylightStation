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

const PLACEHOLDER_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 225" fill="none">' +
  '<rect width="400" height="225" fill="#1a1b1e"/>' +
  '<circle cx="200" cy="100" r="18" stroke="#5c636a" stroke-width="3" fill="none"/>' +
  '<path d="M192 100l6-8 4 5 3-2 7 9h-24z" fill="#5c636a"/>' +
  '<circle cx="208" cy="94" r="3" fill="#5c636a"/>' +
  '</svg>'
);

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
   * YouTube channels: fetch channel avatar from og:image
   * Everything else: Google favicon API
   */
  async #resolveIconUrl(url) {
    if (url.includes('reddit.com/r/')) {
      const sub = url.match(/\/r\/(\w+)/)?.[1];
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

    // YouTube channel: fetch og:image (channel avatar) from channel page
    const ytMatch = url.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/);
    if (ytMatch) {
      try {
        const pageRes = await fetch(`https://www.youtube.com/channel/${ytMatch[1]}`, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(5000),
        });
        if (pageRes.ok) {
          const html = await pageRes.text();
          const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1];
          if (ogImage) return ogImage;
        }
      } catch {
        // fall through to Google favicon
      }
    }

    return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(url)}&size=32`;
  }

  /**
   * Return the client-facing icon URL for a feed, without fetching anything.
   * Vendor-specific feeds (YouTube, Reddit) route through the icon proxy;
   * everything else uses the Google favicon CDN directly.
   *
   * @param {string} feedUrl - The RSS feed URL
   * @param {string} [articleUrl] - A representative article URL (fallback for hostname)
   * @returns {string|null}
   */
  resolveIconPath(feedUrl, articleUrl) {
    if (!feedUrl) return null;

    // YouTube: channel feed → proxy for channel avatar
    const ytMatch = feedUrl.match(/youtube\.com\/feeds\/videos\.xml\?channel_id=(UC[a-zA-Z0-9_-]+)/);
    if (ytMatch) {
      const channelUrl = `https://www.youtube.com/channel/${ytMatch[1]}`;
      return `/api/v1/feed/icon?url=${encodeURIComponent(channelUrl)}`;
    }

    // Reddit: subreddit feed → proxy for community icon
    if (feedUrl.includes('reddit.com/r/')) {
      return `/api/v1/feed/icon?url=${encodeURIComponent(feedUrl)}`;
    }

    // Generic: Google favicon from article hostname (or feed origin)
    try {
      const hostname = new URL(articleUrl || feedUrl).hostname;
      return `https://www.google.com/s2/favicons?sz=16&domain=${hostname}`;
    } catch {
      return null;
    }
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
  // Image proxy (with SVG placeholder fallback)
  // ===========================================================================

  /**
   * Fetch an image by URL and return its bytes.
   * On any failure (network error, non-200), returns an SVG placeholder
   * so the frontend always gets a renderable response.
   *
   * @param {string} url
   * @returns {Promise<{ data: Buffer, contentType: string }>}
   */
  async proxyImage(url) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(READABLE_TIMEOUT),
      });
      if (!res.ok) return { data: PLACEHOLDER_SVG, contentType: 'image/svg+xml' };

      const contentType = res.headers.get('content-type') || 'image/png';
      const buffer = Buffer.from(await res.arrayBuffer());
      return { data: buffer, contentType };
    } catch (err) {
      this.#logger.warn?.('webcontent.proxyImage.error', { url, error: err.message });
      return { data: PLACEHOLDER_SVG, contentType: 'image/svg+xml' };
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
   * Parse HTML into readable content, preserving minimal formatting tags.
   */
  #parseHtml(html) {
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()
      ?.replace(/&amp;/g, '&')?.replace(/&lt;/g, '<')?.replace(/&gt;/g, '>') || null;

    const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] || null;
    const ogDescription = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1]
      || null;

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

    // Strip leading heading that duplicates the page title
    if (title) {
      const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      bodyHtml = bodyHtml.replace(new RegExp(`^\\s*<h[1-3][^>]*>\\s*${escaped}\\s*</h[1-3]>`, 'i'), '');
    }

    // Normalize h1 → h2 (article title already shown separately)
    bodyHtml = bodyHtml.replace(/<(\/?)h1[\s>]/gi, '<$1h2>');

    // Normalize self-closing void elements
    bodyHtml = bodyHtml.replace(/<(br|hr)\s*\/?>/gi, '<$1>');

    // Strip all attributes from remaining tags
    bodyHtml = bodyHtml.replace(/<(\/?\w+)\s+[^>]*>/gi, '<$1>');

    // Remove non-whitelisted tags (keep inner text content)
    const ALLOWED_TAG = /^(?:p|br|h[2-4]|b|strong|em|i|u|ul|ol|li|blockquote|hr)$/i;
    bodyHtml = bodyHtml.replace(/<(\/?)(\w+)>/gi, (full, _slash, tag) =>
      ALLOWED_TAG.test(tag) ? full : ''
    );

    // Decode HTML entities
    bodyHtml = bodyHtml
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // Clean up whitespace
    bodyHtml = bodyHtml
      .replace(/<p>\s*<\/p>/gi, '')
      .replace(/(<br>){3,}/gi, '<br><br>')
      .replace(/\s*\n\s*/g, ' ')
      .trim();

    // Word count from text-only version
    const textOnly = bodyHtml.replace(/<[^>]*>/g, '').trim();
    const wordCount = textOnly.split(/\s+/).filter(Boolean).length;

    const content = wordCount > MAX_WORDS
      ? WebContentAdapter.#truncateHtml(bodyHtml, MAX_WORDS)
      : bodyHtml;

    return { title, content, wordCount, ogImage, ogDescription };
  }

  /**
   * Truncate HTML to a max word count, closing any open tags.
   */
  static #truncateHtml(html, maxWords) {
    let words = 0;
    let inTag = false;
    let inWord = false;
    let cutPos = html.length;

    for (let i = 0; i < html.length; i++) {
      if (html[i] === '<') { inTag = true; inWord = false; continue; }
      if (html[i] === '>') { inTag = false; continue; }
      if (inTag) continue;

      const isSpace = /\s/.test(html[i]);
      if (!isSpace && !inWord) {
        words++;
        if (words > maxWords) { cutPos = i; break; }
        inWord = true;
      } else if (isSpace) {
        inWord = false;
      }
    }

    let truncated = html.slice(0, cutPos).replace(/\s+$/, '') + '\u2026';

    // Close any open tags in reverse order
    const openTags = [];
    for (const m of truncated.matchAll(/<(\/?)([\w]+)>/g)) {
      const [, slash, tag] = m;
      const lower = tag.toLowerCase();
      if (lower === 'br' || lower === 'hr') continue;
      if (slash) {
        const idx = openTags.lastIndexOf(lower);
        if (idx !== -1) openTags.splice(idx, 1);
      } else {
        openTags.push(lower);
      }
    }
    for (let i = openTags.length - 1; i >= 0; i--) {
      truncated += `</${openTags[i]}>`;
    }

    return truncated;
  }
}
