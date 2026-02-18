/**
 * RssHeadlineHarvester
 *
 * Fetches RSS feeds and extracts lightweight headline data.
 *
 * @module adapters/feed
 */

import { Headline } from '#domains/feed/entities/Headline.mjs';

/**
 * Known generic default/placeholder image URLs used by specific news sources.
 * These are publisher logos or site-wide defaults, not article-specific images.
 */
export const SOURCE_BLOCKED_IMAGE_URLS = new Set([
  'https://s.abcnews.com/images/US/abc_news_default_2000x2000_update_4x3t_384.jpg',
  'https://www.seattletimes.com/wp-content/themes/st_refresh/img/st-meta-facebook.png',
  'https://r.yna.co.kr/global/home/v01/img/yonhapnews_logo_1200x800_en01.jpg',
]);

export class RssHeadlineHarvester {
  #rssParser;
  #logger;

  constructor({ rssParser, logger = console }) {
    this.#rssParser = rssParser;
    this.#logger = logger;
  }

  async harvest(source) {
    const urls = source.urls || (source.url ? [source.url] : []);
    if (urls.length === 0) {
      return { source: source.id, label: source.label, lastHarvest: new Date().toISOString(), items: [], error: 'No URL configured' };
    }

    try {
      const allItems = [];
      const errors = [];

      for (const url of urls) {
        try {
          const feed = await this.#rssParser.parseURL(url);
          for (const item of feed.items) {
            if (!item.title?.trim() || !item.link?.trim()) continue;
            const headline = Headline.create({
              source: source.id,
              title: this.#stripHtml(item.title),
              desc: this.#extractDesc(item),
              link: item.link.trim(),
              timestamp: this.#parseDate(item),
            });
            const entry = headline.toJSON();
            const imageData = this.#extractImageWithDims(item);
            if (imageData) {
              entry.image = imageData.url;
              if (imageData.width) entry.imageWidth = imageData.width;
              if (imageData.height) entry.imageHeight = imageData.height;
            }
            allItems.push(entry);
          }
        } catch (err) {
          errors.push(`${url}: ${err.message}`);
          this.#logger.warn?.('headline.harvest.url.error', { source: source.id, url, error: err.message });
        }
      }

      // Sort compound feeds by timestamp descending
      if (urls.length > 1) {
        allItems.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      }

      this.#logger.debug?.('headline.harvest.success', { source: source.id, count: allItems.length, urls: urls.length });
      const result = { source: source.id, label: source.label, lastHarvest: new Date().toISOString(), items: allItems };
      if (errors.length > 0 && allItems.length === 0) result.error = errors.join('; ');
      return result;
    } catch (error) {
      this.#logger.error?.('headline.harvest.error', { source: source.id, error: error.message });
      return { source: source.id, label: source.label, lastHarvest: new Date().toISOString(), items: [], error: error.message };
    }
  }

  #parseDate(item) {
    // Prefer rss-parser's pre-parsed ISO date
    if (item.isoDate) return item.isoDate;
    // Try native Date parsing
    if (item.pubDate) {
      const d = new Date(item.pubDate);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    return new Date().toISOString();
  }

  #extractDesc(item) {
    const raw = item.contentSnippet || this.#stripHtml(item.content) || null;
    if (!raw) return null;
    const cleaned = this.#cleanDesc(raw);
    if (!cleaned) return null;
    if (cleaned.length <= 120) return cleaned;
    return cleaned.substring(0, 120) + '...';
  }

  #cleanDesc(text) {
    return text
      // Remove Tailwind bracket-notation class artifacts (e.g. [&>:first-child]:h-full)
      .replace(/\[&[^\]]*\]:\S*/g, '')
      // Remove stray HTML attribute fragments (e.g. closing "> from broken tag stripping)
      .replace(/\s*">\s*/g, ' ')
      // Remove Reddit boilerplate
      .replace(/submitted\s+by\s+\/u\/\S+/gi, '')
      .replace(/\[link\]\s*\[comments\]/gi, '')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  #extractImageWithDims(item) {
    const mediaContent = item['media:content'];
    if (Array.isArray(mediaContent)) {
      // Prefer explicit image type, then fall back to untyped URLs that look like images
      const img = mediaContent.find(m => m?.['$']?.type?.startsWith('image/'))
        || mediaContent.find(m => {
          const attrs = m?.['$'];
          if (!attrs?.url) return false;
          if (attrs.type) return false; // has non-image type, skip
          return !this.#isNonImageUrl(attrs.url);
        });
      if (img?.['$']?.url) {
        const w = parseInt(img['$'].width, 10);
        const h = parseInt(img['$'].height, 10);
        return {
          url: img['$'].url,
          ...(w > 0 && h > 0 ? { width: w, height: h } : {}),
        };
      }
    }
    const thumb = item['media:thumbnail'];
    if (thumb?.['$']?.url) {
      const w = parseInt(thumb['$'].width, 10);
      const h = parseInt(thumb['$'].height, 10);
      return {
        url: thumb['$'].url,
        ...(w > 0 && h > 0 ? { width: w, height: h } : {}),
      };
    }
    if (item.enclosure?.url && item.enclosure?.type?.startsWith('image/')) {
      return { url: item.enclosure.url };
    }
    return null;
  }

  #isNonImageUrl(url) {
    return /\.(?:m3u8|mp4|webm|ogg|mp3|m4a|wav|flac|mpd)(?:[?#]|$)/i.test(url);
  }

  #stripHtml(html) {
    if (!html) return null;
    // Handle > inside quoted attributes (e.g. Tailwind classes like [&>:first-child])
    return html
      .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

export default RssHeadlineHarvester;
